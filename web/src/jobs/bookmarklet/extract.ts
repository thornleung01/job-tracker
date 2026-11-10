// The code that runs ON THE JOB PAGE, inside the user's own browser. Both functions are turned into the bookmarklet with
// Function.prototype.toString(), so the rules are:
//   - Self-contained: no imports, no module-level helpers, no globals of ours.
//   - Lean: the whole bookmarklet stays under 6 KB minified (browsers accept far more in a javascript: URL, but it is
//     pasted by hand). That budget is measured on the minified text: the production build runs esbuild, which renames every
//     local, so descriptive names here cost nothing in what ships. tests/jobs-bookmarklet/source.test.ts checks both sizes.
//   - Safe: every step is inside try/catch, because a bookmarklet must never throw into the host page.
//   - No network calls, no eval or Function (checked by tests).
// Do not worry about "#", "%" or non-ASCII characters: index.ts escapes them in the final source (browsers treat "#" and
// "%" specially in javascript: URLs).
//
// The output field names (c, r, l, u, g) are short on purpose: they are the parameter names in the URL hash that
// draftFromHash reads, so they are a contract with the app, not local names.

export interface Extracted {
  c: string;
  r: string;
  l: string;
  u: string;
  /** Bit flags: 1 = the company is a guess, 2 = the role is a guess. 0 = read from structured data or a known site layout. */
  g: number;
}

/**
 * Reads the posting out of a document. Layers, per field, first hit wins:
 *   1. JobPosting JSON-LD (reliable)
 *   2. structural signals that rarely change: the h1, the /company/ or /cmp/ link near it, a location-looking line (reliable on LinkedIn and Indeed)
 *   3. the sites' own class names and test ids (a bonus: they change often, so nothing depends on them)
 *   4. guesses from the title, og tags, a company link's slug, flagged in `g`
 */
export function extract(doc: Document, pageUrl: string): Extracted {
  let company = "", role = "", place = "", url = "", guessed = 0, companySlug = "";
  // clean: clean and cap. Strips control characters, decodes the one HTML entity JSON-LD often carries, collapses whitespace.
  // (draftFromHash cleans again, more strictly, when it receives the result.)
  const clean = (v: unknown, n = 200): string =>
    String(v == null ? "" : v).replace(/[\0-\b\x0e-\x1f\x7f-\x9f]/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, n);
  // isHidden: hidden by markup we can see without layout (the hidden attribute, aria-hidden, inline display:none) or by computed style when there is a window.
  // isVisible: the element and all its ancestors are visible.
  const isHidden = (e: Element): boolean => {
    try {
      const w = doc.defaultView;
      return e.hasAttribute("hidden") || e.getAttribute("aria-hidden") === "true" || /display:\s*none/i.test(e.getAttribute("style") || "") || !!(w && w.getComputedStyle(e).display === "none");
    } catch (x) { return false; }
  };
  const isVisible = (e: Element | null): boolean => { for (; e; e = e.parentElement) if (isHidden(e)) return false; return true; };
  // collectText: the visible text nodes under a node, skipping hidden elements, scripts, svg and anything `skip` rejects. visibleText: the same, joined and cleaned.
  const collectText = (e: Node, o: string[], skip?: (e: Element) => boolean): string[] => {
    for (let n = e.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) o.push(n.nodeValue || "");
      else if (n.nodeType === 1 && !/^(script|style|svg|noscript|template|select)$/i.test(n.nodeName) && !isHidden(n as Element) && !(skip && skip(n as Element))) collectText(n, o, skip);
    }
    return o;
  };
  const visibleText = (e: Element): string => clean(collectText(e, []).join(" "), 300);
  // firstText: text of the first visible element matching a selector, or one of its attributes.
  const firstText = (q: string, a?: string): string => {
    try {
      for (const e of Array.from(doc.querySelectorAll(q))) { const t = a ? clean(e.getAttribute(a), 300) : isVisible(e) ? visibleText(e) : ""; if (t) return t; }
    } catch (e) { /* no match */ }
    return "";
  };
  // stripSite: drops the site suffixes a title or heading may carry. looksLikeLocation: does this look like a location ("City, Region" or Remote/Hybrid/On-site)?
  const stripSite = (t: string): string => t.replace(/(\s*[-|–—]\s*(job post|linkedin|indeed(\.com)?|glassdoor))+$/i, "").trim();
  const looksLikeLocation = (p: string): boolean =>
    /^[^\d:!?]{3,79}[^.\d:!?]$/.test(p) && /^\p{Lu}/u.test(p) && ((p.indexOf(",") > 0 && p.split(" ").length < 9) || /^(remote|hybrid|on-?site)( ?\(.*\))?$/i.test(p));
  // firstLocation: the first location-looking piece among some text (pieces are separated by middots and pipes).
  const firstLocation = (t: string[]): string => {
    for (const x of t) for (const p of x.split(/[·•|]/)) { const v = clean(p, 80); if (looksLikeLocation(v)) return v; }
    return "";
  };
  const hostname = ((): string => { try { return new URL(pageUrl).hostname; } catch (e) { return ""; } })();
  const onLinkedin = /(^|\.)linkedin\./.test(hostname), onIndeed = /(^|\.)indeed\./.test(hostname), onJobBoard = onLinkedin || onIndeed, onKnownSite = onJobBoard || /(^|\.)(glassdoor|wellfound)\./.test(hostname);
  let heading: Element | null = null;

  try {
    // 1. JobPosting JSON-LD, found anywhere in the object (arrays, @graph, nesting).
    const findPosting = (node: any, depth: number): any => {
      if (!node || typeof node !== "object" || depth > 6) return null;
      if (String(node["@type"]).indexOf("JobPosting") >= 0) return node;
      for (const i in node) { const x = findPosting(node[i], depth + 1); if (x) return x; }
      return null;
    };
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    let posting: any = null;
    for (let i = 0; i < scripts.length && !posting; i++) { try { posting = findPosting(JSON.parse(scripts[i].textContent || ""), 0); } catch (e) { /* not JSON */ } }
    if (posting) {
      const org = posting.hiringOrganization;
      const jobLoc = Array.isArray(posting.jobLocation) ? posting.jobLocation[0] : posting.jobLocation;
      const address = (jobLoc && jobLoc.address) || {};
      company = clean(typeof org === "string" ? org : org && org.name);
      role = clean(posting.title);
      place = posting.jobLocationType === "TELECOMMUTE" ? "Remote" : clean(typeof address === "string" ? address : [address.addressLocality, address.addressRegion].filter(Boolean).join(", "));
    }
  } catch (e) { /* fall through to the page layout */ }

  try {
    // 2. Structure. The job heading is the first visible h1 (inside main when there is one).
    const headings = Array.from(doc.querySelectorAll("h1")).filter(isVisible);
    heading = headings.find((e) => !!e.closest("main,[role=main]")) || headings[0] || null;
    if (onJobBoard && !role && heading) role = stripSite(visibleText(heading));
    // The company is the link to a company page nearest the heading: look in the heading's container, then each container above it
    // (stopping after a few levels), then anywhere on the page outside navigation, footers, side panels and lists.
    const COMPANY_LINK = /\/(?:company|companies|cmp)\/([^/?#]+)/i, NAVIGATION = "nav,footer,aside,[role=navigation],[role=complementary],[role=contentinfo]";
    if (onKnownSite && !company) {
      const companyNear = (root: ParentNode, extraSkip: string): string => {
        for (const a of Array.from(root.querySelectorAll("a[href]"))) {
          const linkMatch = COMPANY_LINK.exec(a.getAttribute("href") || "");
          if (!linkMatch || !isVisible(a) || a.closest(NAVIGATION + extraSkip)) continue;
          companySlug = companySlug || linkMatch[1];
          const linkText = visibleText(a).replace(/\s*\b(follow(ing)?|show (more|less))\s*$/i, "");
          if (linkText && linkText.length < 81) return linkText;
        }
        return "";
      };
      for (let n: Element | null = heading, k = 0; n && k < 7 && !company; n = n.parentElement, k++) company = companyNear(n, "");
      company = company || companyNear(doc, ",li");
    }
    if (onJobBoard && !place) {
      if (onIndeed) place = firstLocation(Array.from(doc.querySelectorAll("[data-testid*=location i],[aria-label*=location i],[id*=location i]")).filter((e) => isVisible(e) && !e.closest(NAVIGATION + ",form")).map((e) => visibleText(e).replace(/^(?:job )?locations?:?\s*/i, ""))).trim();
      // Otherwise the first location-looking line near the heading, not counting the heading or company links themselves.
      const skip = (e: Element): boolean => e === heading || (e.nodeName === "A" && COMPANY_LINK.test(e.getAttribute("href") || ""));
      for (let n: Element | null = heading, k = 0; n && k < 5 && !place; n = n.parentElement, k++) place = firstLocation(collectText(n, [], skip));
    }
  } catch (e) { /* keep what we have */ }

  try {
    // 3. The sites' own class names and test ids. They change often, so this is only a bonus on top of the layers above.
    role = role || stripSite(firstText(".job-details-jobs-unified-top-card__job-title") || firstText("[data-testid=jobsearch-JobInfoHeader-title]") || firstText("[data-automation-id=jobPostingHeader]"));
    company = company || firstText(".job-details-jobs-unified-top-card__company-name") || firstText("[data-testid=inlineHeader-companyName]");
    place = place || clean(firstText(".job-details-jobs-unified-top-card__primary-description-container").split("·")[0]) || firstText("[data-testid=inlineHeader-companyLocation]") || firstText("[data-automation-id=locations]");
  } catch (e) { /* keep what we have */ }

  try {
    // 4. Guesses, each flagged so the app can ask the user to check them. A company link whose text could not be read gives its slug.
    if (!company && companySlug) {
      try { companySlug = decodeURIComponent(companySlug); } catch (e) { /* use as is */ }
      company = /^[\d\s_+-]*$/.test(companySlug) ? "" : companySlug.replace(/[-_+]+/g, " ").trim().replace(/\b[a-z]/g, (x) => x.toUpperCase());
      if (company) guessed |= 1;
    }
    if (!role || !company || !place) {
      const generic = /^(linkedin|indeed(\.com)?|glassdoor|careers?|jobs?|job post)$/i;
      const titleParts = (t: string): string[] => t.replace(/^\(\d+\)\s*/, "").split(/\s[|–—-]\s|\sat\s/).map((x) => clean(x, 90)).filter((x) => x && !generic.test(x));
      const ogTitle = firstText('meta[property="og:title"]', "content");
      const fromOg = titleParts(ogTitle), fromTitle = titleParts(doc.title);
      let parts = fromOg.length > 1 ? fromOg : fromTitle.length ? fromTitle : fromOg;
      // LinkedIn: "{Company} hiring {Role} in {Location} | LinkedIn".
      const m = /^(?:\(\d+\)\s*)?(.+?) hiring (.+?)\s*(?:\|\s*LinkedIn)?$/i.exec(ogTitle) || /^(?:\(\d+\)\s*)?(.+?) hiring (.+?)\s*(?:\|\s*LinkedIn)?$/i.exec(clean(doc.title, 300));
      if (m) {
        const i = m[2].lastIndexOf(" in "), w = i > 0 ? m[2].slice(i + 4) : "";
        parts = looksLikeLocation(w) ? [m[2].slice(0, i), m[1], w] : [m[2], m[1]];
      }
      if (!role) { role = (heading && stripSite(visibleText(heading))) || parts[0] || ""; if (role) guessed |= 2; }
      if (!company) {
        const n = firstText('meta[property="og:site_name"]', "content");
        company = parts[1] || (generic.test(n) ? "" : n);
        if (company) guessed |= 1;
      }
      if (!place && parts[2] && looksLikeLocation(parts[2])) place = parts[2];
    }
  } catch (e) { /* keep what we have */ }

  try {
    // 5. The posting's own address. A LinkedIn or Indeed job pane in a search is addressed by id, so rebuild the direct link.
    // Otherwise the page's canonical link or og:url, but only on the same host (a page can claim any canonical it likes).
    const parsed = new URL(pageUrl), params = parsed.searchParams;
    if (onLinkedin) {
      const j = params.get("currentJobId") || (/\/jobs\/view\/(?:[^/?]*-)?(\d+)/.exec(parsed.pathname) || [])[1];
      if (j && /^\w+$/.test(j)) url = parsed.origin.replace(/(\/\/)(?:[\w-]+\.)?(linkedin)/, "$1www.$2") + "/jobs/view/" + j;
    } else if (onIndeed) {
      const j = params.get("vjk") || params.get("jk");
      if (j && /^\w+$/.test(j)) url = parsed.origin + "/viewjob?jk=" + j;
    }
    for (const a of [firstText("link[rel=canonical]", "href"), firstText('meta[property="og:url"]', "content")]) {
      if (url || !a) continue;
      try { const v = new URL(a, pageUrl); if (v.host === parsed.host) url = v.href; } catch (e) { /* not a URL */ }
    }
  } catch (e) { /* use the address bar */ }
  url = clean(url || pageUrl, 2000);
  // Keep a job-id parameter, drop the rest of the query and the fragment: they can carry a session or a token.
  try {
    const u = new URL(url), kept = new URLSearchParams();
    u.searchParams.forEach((v, k) => { if (/^(?:gh_jid|jk|vjk|currentjobid|jobid|job_id)$/i.test(k) && /^[\w-]{1,40}$/.test(v)) kept.append(k, v); });
    const q = kept.toString();
    url = u.origin + u.pathname + (q ? "?" + q : "");
  } catch (e) { /* leave it as it is */ }
  if (url.length > 500) url = url.split("?")[0];
  return { c: clean(company, 60), r: clean(role, 90), l: clean(place, 80), u: url.slice(0, 500), g: guessed };
}

/**
 * Runs the extractor and opens the app in a new tab with the details in the hash. `ex` is the extractor, passed in so
 * this function stays self-contained. `app` is the app's address followed by "#/?". Nothing is sent anywhere except
 * the URL the user's own browser opens.
 */
export function launch(ex: (d: Document, h: string) => Extracted, d: Document, w: Window, h: string, app: string): void {
  try {
    const e = ex(d, h);
    // Empty fields travel as empty parameters; draftFromHash treats them as missing.
    const q = new URLSearchParams({ add: "1", ...e, s: "bm" } as unknown as Record<string, string>);
    // Not "noopener": that always returns null, so a blocked pop-up could not be told apart from a success.
    // Cut the link back to this page by hand instead.
    const t = w.open(app + q.toString(), "_blank");
    if (t) { try { t.opener = null; } catch (x) { /* cross-origin already */ } }
    // Say so when nothing could be read (the app still opens, with the link) or the pop-up was blocked.
    const m = t ? (e.c || e.r ? "" : "Couldn't read this page. Add the details by hand.") : "Allow pop-ups to save this job.";
    if (!m) return;
    const n = d.createElement("div");
    n.textContent = m;
    n.style.cssText = "position:fixed;top:9px;right:9px;z-index:9e9;padding:9px;background:black;color:white";
    (d.body || d.documentElement).appendChild(n);
    w.setTimeout(() => n.remove(), 4000);
  } catch (e) { /* never throw into the page */ }
}

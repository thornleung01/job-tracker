// The code that runs ON THE JOB PAGE, inside the user's own browser. Both functions are turned into the bookmarklet with
// Function.prototype.toString(), so each must be completely self-contained: no imports, no module-level helpers, no
// globals of ours. Keep them lean (the whole bookmarklet has to stay under 6 KB minified; browsers accept far more in a javascript: URL, but it is pasted by hand) and keep every step inside try/catch,
// because a bookmarklet must never throw into the host page.
//
// Hard rules for this file, checked by tests: no network calls, no eval or Function. Do not worry about "#", "%" or
// non-ASCII characters: index.ts escapes them in the final source (browsers treat "#" and "%" specially in javascript: URLs).

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
export function extract(d: Document, h: string): Extracted {
  let c = "", r = "", l = "", u = "", g = 0, sg = "";
  // z: clean and cap. Strips control characters, decodes the one HTML entity JSON-LD often carries, collapses whitespace.
  // (draftFromHash cleans again, more strictly, when it receives the result.)
  const z = (v: unknown, n = 200): string =>
    String(v == null ? "" : v).replace(/[\0-\b\x0e-\x1f\x7f-\x9f]/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, n);
  // H: hidden by markup we can see without layout (the hidden attribute, aria-hidden, inline display:none) or by computed style when there is a window.
  // V: the element and all its ancestors are visible.
  const H = (e: Element): boolean => {
    try {
      const w = d.defaultView;
      return e.hasAttribute("hidden") || e.getAttribute("aria-hidden") === "true" || /display:\s*none/i.test(e.getAttribute("style") || "") || !!(w && w.getComputedStyle(e).display === "none");
    } catch (x) { return false; }
  };
  const V = (e: Element | null): boolean => { for (; e; e = e.parentElement) if (H(e)) return false; return true; };
  // wk: the visible text nodes under a node, skipping hidden elements, scripts, svg and anything `sk` rejects. tx: the same, joined and cleaned.
  const wk = (e: Node, o: string[], sk?: (e: Element) => boolean): string[] => {
    for (let n = e.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) o.push(n.nodeValue || "");
      else if (n.nodeType === 1 && !/^(script|style|svg|noscript|template|select)$/i.test(n.nodeName) && !H(n as Element) && !(sk && sk(n as Element))) wk(n, o, sk);
    }
    return o;
  };
  const tx = (e: Element): string => z(wk(e, []).join(" "), 300);
  // s: text of the first visible element matching a selector, or one of its attributes.
  const s = (q: string, a?: string): string => {
    try {
      for (const e of Array.from(d.querySelectorAll(q))) { const t = a ? z(e.getAttribute(a), 300) : V(e) ? tx(e) : ""; if (t) return t; }
    } catch (e) { /* no match */ }
    return "";
  };
  // rs: drops the site suffixes a title or heading may carry. lp: does this look like a location ("City, Region" or Remote/Hybrid/On-site)?
  const rs = (t: string): string => t.replace(/(\s*[-|–—]\s*(job post|linkedin|indeed(\.com)?|glassdoor))+$/i, "").trim();
  const lp = (p: string): boolean =>
    /^[^\d:!?]{3,79}[^.\d:!?]$/.test(p) && /^\p{Lu}/u.test(p) && ((p.indexOf(",") > 0 && p.split(" ").length < 9) || /^(remote|hybrid|on-?site)( ?\(.*\))?$/i.test(p));
  // fl: the first location-looking piece among some text (pieces are separated by middots and pipes).
  const fl = (t: string[]): string => {
    for (const x of t) for (const p of x.split(/[·•|]/)) { const v = z(p, 80); if (lp(v)) return v; }
    return "";
  };
  const hn = ((): string => { try { return new URL(h).hostname; } catch (e) { return ""; } })();
  const li = /(^|\.)linkedin\./.test(hn), ind = /(^|\.)indeed\./.test(hn), jb = li || ind, kn = jb || /(^|\.)(glassdoor|wellfound)\./.test(hn);
  let hd: Element | null = null;

  try {
    // 1. JobPosting JSON-LD, found anywhere in the object (arrays, @graph, nesting).
    const f = (n: any, k: number): any => {
      if (!n || typeof n !== "object" || k > 6) return null;
      if (String(n["@type"]).indexOf("JobPosting") >= 0) return n;
      for (const i in n) { const x = f(n[i], k + 1); if (x) return x; }
      return null;
    };
    const a = d.querySelectorAll('script[type="application/ld+json"]');
    let p: any = null;
    for (let i = 0; i < a.length && !p; i++) { try { p = f(JSON.parse(a[i].textContent || ""), 0); } catch (e) { /* not JSON */ } }
    if (p) {
      const o = p.hiringOrganization;
      const j = Array.isArray(p.jobLocation) ? p.jobLocation[0] : p.jobLocation;
      const x = (j && j.address) || {};
      c = z(typeof o === "string" ? o : o && o.name);
      r = z(p.title);
      l = p.jobLocationType === "TELECOMMUTE" ? "Remote" : z(typeof x === "string" ? x : [x.addressLocality, x.addressRegion].filter(Boolean).join(", "));
    }
  } catch (e) { /* fall through to the page layout */ }

  try {
    // 2. Structure. The job heading is the first visible h1 (inside main when there is one).
    const hs = Array.from(d.querySelectorAll("h1")).filter(V);
    hd = hs.find((e) => !!e.closest("main,[role=main]")) || hs[0] || null;
    if (jb && !r && hd) r = rs(tx(hd));
    // The company is the link to a company page nearest the heading: look in the heading's container, then each container above it
    // (stopping after a few levels), then anywhere on the page outside navigation, footers, side panels and lists.
    const CA = /\/(?:company|companies|cmp)\/([^/?#]+)/i, NV = "nav,footer,aside,[role=navigation],[role=complementary],[role=contentinfo]";
    if (kn && !c) {
      const pick = (n: ParentNode, x: string): string => {
        for (const a of Array.from(n.querySelectorAll("a[href]"))) {
          const m = CA.exec(a.getAttribute("href") || "");
          if (!m || !V(a) || a.closest(NV + x)) continue;
          sg = sg || m[1];
          const t = tx(a).replace(/\s*\b(follow(ing)?|show (more|less))\s*$/i, "");
          if (t && t.length < 81) return t;
        }
        return "";
      };
      for (let n: Element | null = hd, k = 0; n && k < 7 && !c; n = n.parentElement, k++) c = pick(n, "");
      c = c || pick(d, ",li");
    }
    if (jb && !l) {
      if (ind) l = fl(Array.from(d.querySelectorAll("[data-testid*=location i],[aria-label*=location i],[id*=location i]")).filter((e) => V(e) && !e.closest(NV + ",form")).map((e) => tx(e).replace(/^(?:job )?locations?:?\s*/i, ""))).trim();
      // Otherwise the first location-looking line near the heading, not counting the heading or company links themselves.
      const sk = (e: Element): boolean => e === hd || (e.nodeName === "A" && CA.test(e.getAttribute("href") || ""));
      for (let n: Element | null = hd, k = 0; n && k < 5 && !l; n = n.parentElement, k++) l = fl(wk(n, [], sk));
    }
  } catch (e) { /* keep what we have */ }

  try {
    // 3. The sites' own class names and test ids. They change often, so this is only a bonus on top of the layers above.
    r = r || rs(s(".job-details-jobs-unified-top-card__job-title") || s("[data-testid=jobsearch-JobInfoHeader-title]") || s("[data-automation-id=jobPostingHeader]"));
    c = c || s(".job-details-jobs-unified-top-card__company-name") || s("[data-testid=inlineHeader-companyName]");
    l = l || z(s(".job-details-jobs-unified-top-card__primary-description-container").split("·")[0]) || s("[data-testid=inlineHeader-companyLocation]") || s("[data-automation-id=locations]");
  } catch (e) { /* keep what we have */ }

  try {
    // 4. Guesses, each flagged so the app can ask the user to check them. A company link whose text could not be read gives its slug.
    if (!c && sg) {
      try { sg = decodeURIComponent(sg); } catch (e) { /* use as is */ }
      c = /^[\d\s_+-]*$/.test(sg) ? "" : sg.replace(/[-_+]+/g, " ").trim().replace(/\b[a-z]/g, (x) => x.toUpperCase());
      if (c) g |= 1;
    }
    if (!r || !c || !l) {
      const bad = /^(linkedin|indeed(\.com)?|glassdoor|careers?|jobs?|job post)$/i;
      const pp = (t: string): string[] => t.replace(/^\(\d+\)\s*/, "").split(/\s[|–—-]\s|\sat\s/).map((x) => z(x, 90)).filter((x) => x && !bad.test(x));
      const og = s('meta[property="og:title"]', "content");
      const P = pp(og), Q = pp(d.title);
      let T = P.length > 1 ? P : Q.length ? Q : P;
      // LinkedIn: "{Company} hiring {Role} in {Location} | LinkedIn".
      const m = /^(?:\(\d+\)\s*)?(.+?) hiring (.+?)\s*(?:\|\s*LinkedIn)?$/i.exec(og) || /^(?:\(\d+\)\s*)?(.+?) hiring (.+?)\s*(?:\|\s*LinkedIn)?$/i.exec(z(d.title, 300));
      if (m) {
        const i = m[2].lastIndexOf(" in "), w = i > 0 ? m[2].slice(i + 4) : "";
        T = lp(w) ? [m[2].slice(0, i), m[1], w] : [m[2], m[1]];
      }
      if (!r) { r = (hd && rs(tx(hd))) || T[0] || ""; if (r) g |= 2; }
      if (!c) {
        const n = s('meta[property="og:site_name"]', "content");
        c = T[1] || (bad.test(n) ? "" : n);
        if (c) g |= 1;
      }
      if (!l && T[2] && lp(T[2])) l = T[2];
    }
  } catch (e) { /* keep what we have */ }

  try {
    // 5. The posting's own address. A LinkedIn or Indeed job pane in a search is addressed by id, so rebuild the direct link.
    // Otherwise the page's canonical link or og:url, but only on the same host (a page can claim any canonical it likes).
    const L = new URL(h), q = L.searchParams;
    if (li) {
      const j = q.get("currentJobId") || (/\/jobs\/view\/(?:[^/?]*-)?(\d+)/.exec(L.pathname) || [])[1];
      if (j && /^\w+$/.test(j)) u = L.origin.replace(/(\/\/)(?:[\w-]+\.)?(linkedin)/, "$1www.$2") + "/jobs/view/" + j;
    } else if (ind) {
      const j = q.get("vjk") || q.get("jk");
      if (j && /^\w+$/.test(j)) u = L.origin + "/viewjob?jk=" + j;
    }
    for (const a of [s("link[rel=canonical]", "href"), s('meta[property="og:url"]', "content")]) {
      if (u || !a) continue;
      try { const v = new URL(a, h); if (v.host === L.host) u = v.href; } catch (e) { /* not a URL */ }
    }
  } catch (e) { /* use the address bar */ }
  u = z(u || h, 2000);
  if (u.length > 500) u = u.split("?")[0];
  return { c: z(c, 60), r: z(r, 90), l: z(l, 80), u: u.slice(0, 500), g };
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

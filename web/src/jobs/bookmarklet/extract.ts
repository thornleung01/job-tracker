// The code that runs ON THE JOB PAGE, inside the user's own browser. Both functions are turned into the bookmarklet with
// Function.prototype.toString(), so each must be completely self-contained: no imports, no module-level helpers, no
// globals of ours. Keep them terse (the whole bookmarklet has to stay near 2.5 KB) and keep every step inside try/catch,
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

/** Reads the posting out of a document. Reliable sources: JobPosting JSON-LD, then LinkedIn, Indeed and Workday layouts. Guesses: titles, site name, first h1. */
export function extract(d: Document, h: string): Extracted {
  let c = "", r = "", l = "", u = "", g = 0;
  // z: clean and cap. Strips control characters, decodes the one HTML entity JSON-LD often carries, collapses whitespace.
  // (draftFromHash cleans again, more strictly, when it receives the result.)
  const z = (v: unknown, n = 200): string =>
    String(v == null ? "" : v).replace(/[\0-\b\x0e-\x1f\x7f-\x9f]/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, n);
  // s: text of the first element matching a selector, or one of its attributes.
  const s = (q: string, a?: string): string => { try { const e = d.querySelector(q); return z(e && (a ? e.getAttribute(a) : e.textContent), 300); } catch (e) { return ""; } };

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
    // 2. Known site layouts.
    r = r || s(".job-details-jobs-unified-top-card__job-title") || s("[data-testid=jobsearch-JobInfoHeader-title]").replace(/ - job post$/, "") || s("[data-automation-id=jobPostingHeader]");
    c = c || s(".job-details-jobs-unified-top-card__company-name") || s("[data-testid=inlineHeader-companyName]");
    l = l || z(s(".job-details-jobs-unified-top-card__primary-description-container").split("\u00b7")[0]) || s("[data-testid=inlineHeader-companyLocation]") || s("[data-automation-id=locations]");
  } catch (e) { /* keep what we have */ }

  try {
    // 3. Guesses, each flagged so the app can ask the user to check them.
    if (!r || !c) {
      const bad = /^(linkedin|indeed|careers?|jobs?)$/i;
      const pp = (t: string): string[] => t.split(/\s[|\u2013\u2014-]\s|\sat\s/).map((x) => z(x, 90)).filter((x) => x && !bad.test(x));
      const P = pp(s('meta[property="og:title"]', "content")), Q = pp(d.title);
      const T = P.length > 1 ? P : Q.length ? Q : P;
      if (!r) { r = s("h1") || T[0] || ""; if (r) g |= 2; }
      if (!c) {
        const n = s('meta[property="og:site_name"]', "content");
        c = T[1] || (bad.test(n) ? "" : n);
        if (c) g |= 1;
      }
    }
  } catch (e) { /* keep what we have */ }

  try {
    // 4. The posting's own address. A LinkedIn or Indeed job pane in a search is addressed by id, so rebuild the direct link.
    // Otherwise the page's canonical link, but only on the same host (a page can claim any canonical it likes).
    const L = new URL(h);
    const j = /[?&](?:currentJobId|vjk|jk)=(\w+)/.exec(h);
    if (j) u = /linkedin\./.test(L.host) ? L.origin + "/jobs/view/" + j[1] : /indeed\./.test(L.host) ? L.origin + "/viewjob?jk=" + j[1] : "";
    if (!u) {
      const v = new URL(s("link[rel=canonical]", "href") || s('meta[property="og:url"]', "content"), h);
      if (v.host === L.host) u = v.href;
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
    // Empty fields travel as empty parameters; draftFromHash treats them as missing.
    const q = new URLSearchParams({ add: "1", ...ex(d, h), s: "bm" } as unknown as Record<string, string>);
    // Not "noopener": that always returns null, so a blocked pop-up could not be told apart from a success.
    // Cut the link back to this page by hand instead.
    const t = w.open(app + q.toString(), "_blank");
    if (t) { try { t.opener = null; } catch (e) { /* cross-origin already */ } return; }
    const n = d.createElement("div");
    n.textContent = "Allow pop-ups to save this job";
    n.style.cssText = "position:fixed;top:9px;right:9px;z-index:9e9;padding:9px;background:black;color:white";
    (d.body || d.documentElement).appendChild(n);
    w.setTimeout(() => n.remove(), 4000);
  } catch (e) { /* never throw into the page */ }
}

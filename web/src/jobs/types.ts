// The shapes shared by everything that fills the Add application form from a job link: the link reader (url.ts), the job
// boards' public APIs (enrich.ts), the page's own data (jsonld.ts), pasted text (paste.ts) and the bookmarklet.

/** What we could work out about a job posting. Everything here is a SUGGESTION: the user confirms before anything is saved. */
export interface JobDraft {
  company: string;
  role: string;
  location: string;
  /** http(s) URL of the posting, cleaned of tracking parameters where that is safe. Empty if unknown. */
  url: string;
  /**
   * How it was derived:
   * - "link": parsed from the URL text alone (offline, instant)
   * - "api": confirmed by a job-board API (Greenhouse, Lever, Ashby, SmartRecruiters)
   * - "bookmarklet": read from the page the user was viewing
   * - "paste": parsed from text the user pasted
   */
  source: "link" | "api" | "bookmarklet" | "paste";
  /** The posting's text when the source had one: plain text, never markup, cut to MAX_POSTING_CHARS. Saved as the application's posting text. */
  description?: string;
  /** True for a field that is a guess the user should check. Fields not listed here are treated as reliable. */
  guessed: { company: boolean; role: boolean };
}

export const EMPTY_DRAFT: JobDraft = { company: "", role: "", location: "", url: "", source: "link", guessed: { company: false, role: false } };

export interface EnrichOptions {
  /** Defaults to globalThis.fetch. Injectable for tests. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** For the whole lookup, however many requests it makes. Default 6000. */
  timeoutMs?: number;
}

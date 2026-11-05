// Shared contract for "paste a job link". The parsing library (web/src/jobs/*), the bookmarklet
// (web/src/jobs/bookmarklet/*), storage (db, sync/actions, portability) and the add form (pages/applications)
// are built separately against these shapes.

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
  /** True for a field that is a guess the user should check. Fields not listed here are treated as reliable. */
  guessed: { company: boolean; role: boolean };
}

export const EMPTY_DRAFT: JobDraft = { company: "", role: "", location: "", url: "", source: "link", guessed: { company: false, role: false } };

export interface EnrichOptions {
  /** Defaults to globalThis.fetch. Injectable for tests. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** Default 6000. */
  timeoutMs?: number;
}

/**
 * Library API (implemented in web/src/jobs/index.ts):
 *   parseJobUrl(rawUrl): JobDraft | null            instant and offline; null if it is not an http(s) URL
 *   enrichJobDraft(draft, opts?): Promise<JobDraft> asks the job board's public API (only for known boards); never throws,
 *                                                    returns the input draft unchanged on any failure
 *   parsePastedText(text, url?): JobDraft | null    from text the user copied off the posting page
 *   extractJobPostingFromJsonLd(documentOrHtml): JobDraft | null
 * Bookmarklet API (implemented in web/src/jobs/bookmarklet/index.ts):
 *   buildBookmarkletSource(appUrl): string          the `javascript:` source to drag to the bookmarks bar
 *   draftFromHash(query: URLSearchParams): JobDraft | null   validates and caps what a bookmarklet sent; null if absent/invalid
 */

import type { EnrichOptions, JobDraft } from "../../jobs/types";
import { enrichJobDraft, parseJobUrl, parsePastedText } from "../../jobs";
import { draftFromHash } from "../../jobs/bookmarklet";

/** The parsing library, as the add form uses it. Pages take a partial override so tests can inject fakes. */
export interface JobLinkDeps {
  parseJobUrl(rawUrl: string): JobDraft | null;
  enrichJobDraft(draft: JobDraft, opts?: EnrichOptions): Promise<JobDraft>;
  parsePastedText(text: string, url?: string): JobDraft | null;
  draftFromHash(query: URLSearchParams): JobDraft | null;
}

export const realJobLinkDeps: JobLinkDeps = { parseJobUrl, enrichJobDraft, parsePastedText, draftFromHash };

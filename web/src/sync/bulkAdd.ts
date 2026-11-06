// "Add several links": up to 10 job links, one per line, each read with the same code as the single Add application form
// (an offline read first, then the job board's public API for the four boards we can ask), then saved as an application.
// Two links are read at once. Nothing here blocks: it reports each link as it finishes and stops cleanly on an AbortSignal.
import { ActionError } from "../db/errors";
import { BULK_ADD_MAX } from "../db/limits";
import { parsePostingUrl } from "../db/postingUrl";
import { tx, type JobTrackerDB } from "../db/schema";
import type { EnrichOptions, JobDraft } from "../jobs/types";
import { addApplication, type AddApplicationInput } from "./actions";
import { findDuplicates, type DuplicateMatch } from "./duplicates";

/** How many links are read at the same time. */
export const BULK_ADD_CONCURRENCY = 2;

/** What a link needs from the job-link library. The page hands over its own (a test hands over fakes). */
export interface BulkAddDeps {
  parseJobUrl(rawUrl: string): JobDraft | null;
  enrichJobDraft(draft: JobDraft, opts?: EnrichOptions): Promise<JobDraft>;
}

export type LinkOutcome =
  | { status: "added"; id: number; company: string; role: string; guessed: { company: boolean; role: boolean } }
  | { status: "skipped"; existing: DuplicateMatch }
  | { status: "unreadable"; reason: string }
  | { status: "stopped" }
  | { status: "failed"; reason: string };

export interface LinkResult {
  /** the link as typed, trimmed */
  link: string;
  outcome: LinkOutcome;
}

/** The lines of the box that hold a link: trimmed, blanks dropped, the same link once. Throws ActionError when there are none or more than 10. */
export function parseLinkLines(text: string): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // the same link twice is one link; compared as typed, then as it would be saved
    const key = parsePostingUrl(line) ?? line;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  if (!lines.length) throw new ActionError("Paste at least one link, one on each line.");
  if (lines.length > BULK_ADD_MAX) throw new ActionError(`Add up to ${BULK_ADD_MAX} links at a time. You pasted ${lines.length}.`);
  return lines;
}

export interface BulkAddOptions {
  signal?: AbortSignal;
  /** called as each link finishes, with how many are done */
  onResult?: (result: LinkResult, done: number, total: number) => void;
  /** the resume version sent with every application this run adds */
  resumeId?: number;
  /** for tests */
  now?: Date;
}

const NOT_HTTPS = "Not a link that starts with https://.";
const NO_NAME = "Couldn't read a company from it.";

/** One link: read it, skip it when it is saved already, save it. Never throws. `commit` runs the check and the save one at a time (and each is one transaction). */
async function addOne(
  db: JobTrackerDB, link: string, deps: BulkAddDeps, commit: <T>(fn: () => Promise<T>) => Promise<T>, o: BulkAddOptions,
): Promise<LinkOutcome> {
  const stopped = (): boolean => o.signal?.aborted === true;
  if (stopped()) return { status: "stopped" };
  const clean = parsePostingUrl(link);
  if (!clean || !clean.toLowerCase().startsWith("https://")) return { status: "unreadable", reason: NOT_HTTPS };
  let draft: JobDraft | null;
  try {
    draft = deps.parseJobUrl(clean);
  } catch {
    draft = null;
  }
  if (!draft) return { status: "unreadable", reason: NO_NAME };
  let read = draft;
  try {
    const enriched = await deps.enrichJobDraft(draft, { signal: o.signal });
    if (enriched) read = enriched;
  } catch {
    // the offline reading stands
  }
  // Stopped while the job board was being asked: nothing is saved for this link.
  if (stopped()) return { status: "stopped" };
  const company = read.company.trim();
  const role = read.role.trim();
  if (!company) return { status: "unreadable", reason: NO_NAME };
  const url = parsePostingUrl(read.url) || clean;
  try {
    // The check and the save are one transaction (nothing in it waits on the network), so another tab adding the same link can't slip in between.
    return await commit<LinkOutcome>(() => tx(db, async (): Promise<LinkOutcome> => {
      if (stopped()) return { status: "stopped" };
      const [existing] = await findDuplicates(db, company, role, url);
      if (existing) return { status: "skipped", existing };
      // The posting text is the draft's description, kept as the job posting for this application.
      const description = (read as JobDraft & { description?: string }).description?.trim();
      const input: AddApplicationInput & { postingText?: string; resumeId?: number } = {
        company, role, stage: "Applied", url,
        ...(description ? { postingText: description } : {}),
        ...(o.resumeId !== undefined ? { resumeId: o.resumeId } : {}),
      };
      const id = await addApplication(db, input, o.now);
      return { status: "added", id, company, role, guessed: read.guessed };
    }));
  } catch (e) {
    return { status: "failed", reason: e instanceof ActionError ? e.message : "Couldn't save it." };
  }
}

/**
 * Adds an application for each link and reports every one. Results come back in the order of `links`. Aborting the signal stops
 * links not yet started (and ones waiting on a job board): they are reported as "stopped", and what was already saved stays.
 */
export async function bulkAdd(db: JobTrackerDB, links: readonly string[], deps: BulkAddDeps, o: BulkAddOptions = {}): Promise<LinkResult[]> {
  if (links.length > BULK_ADD_MAX) throw new ActionError(`Add up to ${BULK_ADD_MAX} links at a time.`);
  const results: LinkResult[] = new Array(links.length);
  let tail: Promise<unknown> = Promise.resolve();
  // One check-and-save at a time, so two links for the same company and role in one batch can't both be added.
  const commit = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn);
    tail = next.catch(() => undefined);
    return next;
  };
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < links.length) {
      const i = next++;
      const outcome = await addOne(db, links[i], deps, commit, o).catch((): LinkOutcome => ({ status: "failed", reason: "Couldn't save it." }));
      results[i] = { link: links[i], outcome };
      o.onResult?.(results[i], ++done, links.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(BULK_ADD_CONCURRENCY, links.length) }, worker));
  return results;
}

/** The counts, in order of the sentence. */
export function tally(results: readonly LinkResult[]): { added: number; skipped: number; unreadable: number; stopped: number; failed: number } {
  const n = { added: 0, skipped: 0, unreadable: 0, stopped: 0, failed: 0 };
  for (const r of results) n[r.outcome.status]++;
  return n;
}

const shorten = (link: string, max = 80) => (link.length > max ? `${link.slice(0, max - 1)}…` : link);

/** "Added 4. Skipped 1 already saved. 1 couldn't be read: <link>". Parts that are zero are left out. */
export function summarize(results: readonly LinkResult[]): string {
  const n = tally(results);
  const parts: string[] = [];
  if (n.added) parts.push(`Added ${n.added}.`);
  if (n.skipped) parts.push(`Skipped ${n.skipped} already saved.`);
  const bad = results.filter((r) => r.outcome.status === "unreadable" || r.outcome.status === "failed");
  if (bad.length) parts.push(`${bad.length} couldn't be read${bad.length === 1 ? `: ${shorten(bad[0].link)}` : ""}.`);
  if (n.stopped) parts.push(`Stopped before ${n.stopped} ${n.stopped === 1 ? "link" : "links"}.`);
  return parts.join(" ") || "Nothing was added.";
}

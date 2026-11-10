// The last step of the Resume page: is the pasted job already in Applications, and saving the reviewed resume and letter to it (or to a new
// application) in one go. Either everything is saved or nothing is.
import { normalizeSections } from "../db/documentShape";
import { ActionError } from "../db/errors";
import { MAX_POSTING_CHARS } from "../db/limits";
import { cleanPostingUrl } from "../db/postingUrl";
import { tx, type ApplicationRow, type DocSection, type JobTrackerDB } from "../db/schema";
import { addApplication } from "./actions";
import { getCoverLetter, getTailored, saveCoverLetter, saveTailored } from "./documents";
import { findDuplicates } from "./duplicates";
import { isLive } from "./live";

/**
 * The live applications that are this job, newest first within each kind of match: the same posting link, then the same company and role.
 * Strict: a company alone is not a match, because Save acts on it.
 */
export async function jobMatches(db: JobTrackerDB, job: { company: string; role: string; url?: string }): Promise<ApplicationRow[]> {
  const matches = await findDuplicates(db, job.company, job.role, job.url ?? "", { strict: true });
  const rows = await db.applications.bulkGet(matches.map((m) => m.id));
  return rows.filter((a): a is ApplicationRow => a !== undefined && isLive(a));
}

/** Whether the application already has a tailored resume and a cover letter, so saving would replace them. */
export async function existingDocs(db: JobTrackerDB, appId: number): Promise<{ tailored: boolean; cover: boolean }> {
  const [tailored, cover] = await Promise.all([getTailored(db, appId), getCoverLetter(db, appId)]);
  return { tailored: Boolean(tailored), cover: Boolean(cover) };
}

export interface SaveTailoredJobInput {
  /** what the person reviewed. A null or empty letter saves no letter (an existing one is kept). */
  draft: { resume: DocSection[]; cover: DocSection[] | null; baselineId: number; source?: "ai" | "copy" };
  company: string;
  role: string;
  url?: string;
  posting: string;
  /** the application to save to; left out, a new one is added */
  useId?: number;
}

/**
 * Saves the reviewed draft, in one transaction: to application `useId` (which must still be there) or to a new one added with the company,
 * role, link and posting text. The tailored resume (based on `draft.baselineId`, marked as made with AI unless `draft.source` says it was
 * copied by hand) replaces any earlier one and becomes the resume sent; the letter replaces any earlier one. An application that is used
 * keeps its own posting text and link, and gets these only when it has none. A failure anywhere saves nothing.
 */
export async function saveTailoredJob(
  db: JobTrackerDB, input: SaveTailoredJobInput, now: Date = new Date(),
): Promise<{ appId: number; resumeId: number; coverId: number | null; created: boolean }> {
  const { draft } = input;
  const cover = draft.cover ? normalizeSections(draft.cover) : [];
  const source = draft.source ?? "ai";
  return tx(db, async () => {
    let appId: number;
    if (input.useId !== undefined) {
      const app = await db.applications.get(input.useId);
      if (!app || !isLive(app)) throw new ActionError("That application isn't there any more.");
      appId = app.id;
      await fillMissing(db, app, input);
    } else {
      appId = await addApplication(db, { company: input.company, role: input.role, url: input.url, postingText: input.posting }, now);
    }
    const resumeId = await saveTailored(db, appId, draft.resume, source, now, draft.baselineId);
    const coverId = cover.length ? await saveCoverLetter(db, appId, cover, source, now) : null;
    return { appId, resumeId, coverId, created: input.useId === undefined };
  });
}

/**
 * Gives an application the posting text and link it doesn't have yet. What it already has is never replaced. A link that isn't a web
 * address is refused (the same rule as adding an application), never dropped quietly, even when the application keeps its own.
 */
async function fillMissing(db: JobTrackerDB, app: ApplicationRow, input: Pick<SaveTailoredJobInput, "posting" | "url">): Promise<void> {
  const posting = input.posting.replace(/\r\n?/g, "\n").trim().slice(0, MAX_POSTING_CHARS);
  const checked = cleanPostingUrl(input.url ?? "");
  const link = app.postingUrl ? "" : checked;
  const fields: Partial<ApplicationRow> = {
    ...(!app.postingText?.trim() && posting ? { postingText: posting } : {}),
    ...(link ? { postingUrl: link } : {}),
  };
  if (Object.keys(fields).length) await db.applications.update(app.id, fields);
}

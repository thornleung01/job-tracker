// What the one-line "Resume: Analyst v2 · Cover letter" under an open application on the list says.
import type { JobTrackerDB } from "../db/schema";
import { getCoverLetter, getMaster, isLiveDocument } from "./documents";

export interface DocumentLine {
  /** the title of the resume sent, "(deleted)" when it was deleted, or null when none was chosen */
  resume: string | null;
  /** the application has a cover letter */
  cover: boolean;
}

/**
 * The resume sent and the cover letter for an application, or null when there is nothing to say: no resume, no letter and no
 * master resume to make one from (a person who doesn't use documents is not nagged).
 */
export async function documentLine(db: JobTrackerDB, appId: number): Promise<DocumentLine | null> {
  const app = await db.applications.get(appId);
  if (!app) return null;
  const doc = app.resumeId !== undefined ? await db.documents.get(app.resumeId) : undefined;
  const resume = app.resumeId === undefined ? null : doc && doc.kind === "resume" && isLiveDocument(doc) ? doc.title : "(deleted)";
  const cover = Boolean(await getCoverLetter(db, appId));
  if (resume === null && !cover && !(await getMaster(db))) return null;
  return { resume, cover };
}

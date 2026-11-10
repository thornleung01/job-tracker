// Resumes and cover letters. Resume versions are standalone: an application points at one with `resumeId`, and many can point
// at the same. A cover letter belongs to one application, and so does a tailored resume (a resume with `applicationId` set): it is
// not one of the reusable versions, is never counted against the cap, and goes with its application. The master is the resume you copy versions from.
// A deleted document stays in Recently deleted for TRASH_DAYS (db/limits.ts), like an application (sync/trash.ts), and is hidden everywhere else.
import { normalizeSections } from "../db/documentShape";
import { MAX_DOC_TITLE_CHARS, MAX_POSTING_CHARS, MAX_RESUME_VERSIONS, TRASH_DAYS } from "../db/limits";
import { ActionError, MissingRecordError } from "../db/errors";
import { requireApplication } from "../db/repo";
import { tx, type DocumentRow, type JobTrackerDB } from "../db/schema";
import { DAY_MS, iso } from "../db/time";

/** A request about documents that the app refuses, with a sentence that is safe to show. It is an ActionError, so the page's notice shows its own words. */
export class DocumentError extends ActionError {
  constructor(message: string) {
    super(message);
    this.name = "DocumentError";
  }
}

const MASTER_TITLE = "Master resume";

export const isLiveDocument = (d: Pick<DocumentRow, "deletedAt">): boolean => !d.deletedAt;

const cleanTitle = (title: string, fallback: string): string => title.replace(/\s+/g, " ").trim().slice(0, MAX_DOC_TITLE_CHARS) || fallback;

/** A resume written for one application (not the master, not a reusable version). */
export const isTailored = (d: Pick<DocumentRow, "kind" | "master" | "applicationId">): boolean => d.kind === "resume" && !d.master && d.applicationId !== null;

/** Every document you haven't deleted, resumes first (master first), then cover letters, each oldest first. */
export async function liveDocuments(db: JobTrackerDB): Promise<DocumentRow[]> {
  const rows = (await db.documents.toArray()).filter(isLiveDocument);
  const rank = (d: DocumentRow) => (d.kind === "resume" ? (d.master ? 0 : 1) : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
}

export async function getMaster(db: JobTrackerDB): Promise<DocumentRow | undefined> {
  return (await db.documents.where("kind").equals("resume").toArray()).find((d) => d.master && isLiveDocument(d));
}

/** The reusable resume versions you can choose from: the master and its copies, live ones only. A tailored resume is not here (see resumesForApplication). */
export async function liveResumes(db: JobTrackerDB): Promise<DocumentRow[]> {
  return (await liveDocuments(db)).filter((d) => d.kind === "resume" && !isTailored(d));
}

/** Every live tailored resume, oldest first, whatever its application. The Resume page's tailored list needs the live applications too: see tailoredPage in sync/queries.ts. */
export async function liveTailored(db: JobTrackerDB): Promise<DocumentRow[]> {
  return (await liveDocuments(db)).filter(isTailored);
}

/** The application's own tailored resume, when it has one. */
export async function getTailored(db: JobTrackerDB, appId: number): Promise<DocumentRow | undefined> {
  return (await db.documents.where("applicationId").equals(appId).toArray()).find((d) => isTailored(d) && isLiveDocument(d));
}

/** What one application can choose from: the master, the reusable versions, then its own tailored resume. */
export async function resumesForApplication(db: JobTrackerDB, appId: number): Promise<DocumentRow[]> {
  const own = await getTailored(db, appId);
  return [...(await liveResumes(db)), ...(own ? [own] : [])];
}

export async function getCoverLetter(db: JobTrackerDB, appId: number): Promise<DocumentRow | undefined> {
  return (await db.documents.where("applicationId").equals(appId).toArray()).find((d) => d.kind === "cover" && isLiveDocument(d));
}

/** Creates the master resume, or replaces the text of the one you have. */
export async function saveMaster(
  db: JobTrackerDB, sections: unknown, source: NonNullable<DocumentRow["source"]>, now: Date = new Date(),
): Promise<number> {
  const clean = normalizeSections(sections);
  if (!clean.length) throw new DocumentError("Add some text to your resume first.");
  return tx(db, async () => {
    const existing = await getMaster(db);
    const at = iso(now);
    if (existing) {
      await db.documents.update(existing.id, { sections: clean, source, updatedAt: at });
      return existing.id;
    }
    return db.documents.add({ kind: "resume", master: true, applicationId: null, title: MASTER_TITLE, sections: clean, source, createdAt: at, updatedAt: at });
  });
}

/** A new resume version, from nothing or from another document's text. */
export async function createVersion(
  db: JobTrackerDB,
  input: { title: string; sections: unknown; basedOn?: number; source?: DocumentRow["source"] },
  now: Date = new Date(),
): Promise<number> {
  const clean = normalizeSections(input.sections);
  if (!clean.length) throw new DocumentError("Add some text to the resume first.");
  return tx(db, async () => {
    const versions = (await liveResumes(db)).filter((d) => !d.master);
    if (versions.length >= MAX_RESUME_VERSIONS) {
      throw new DocumentError(`You can keep ${MAX_RESUME_VERSIONS} resume versions. Delete one to make another.`);
    }
    const at = iso(now);
    return db.documents.add({
      kind: "resume", master: false, applicationId: null, title: cleanTitle(input.title, "Resume"), sections: clean,
      ...(input.basedOn !== undefined ? { basedOn: input.basedOn } : {}), ...(input.source ? { source: input.source } : {}), createdAt: at, updatedAt: at,
    });
  });
}

/** Changes a document's title or text. A resume can't end up with no text. */
export async function updateDocument(
  db: JobTrackerDB, id: number, changes: { title?: string; sections?: unknown }, now: Date = new Date(),
): Promise<void> {
  await tx(db, async () => {
    const doc = await db.documents.get(id);
    if (!doc || !isLiveDocument(doc)) throw new MissingRecordError(`No document ${id}`);
    const fields: Partial<DocumentRow> = { updatedAt: iso(now) };
    if (changes.title !== undefined) fields.title = cleanTitle(changes.title, doc.title);
    if (changes.sections !== undefined) {
      const clean = normalizeSections(changes.sections);
      if (!clean.length && doc.kind === "resume") throw new DocumentError("A resume needs some text.");
      fields.sections = clean;
    }
    await db.documents.update(id, fields);
  });
}

/** Copies a resume for one application ("Resume for Acme, Analyst") and points the application at the copy. Returns the new version's id. */
export async function copyResumeForApplication(db: JobTrackerDB, appId: number, fromId?: number, now: Date = new Date()): Promise<number> {
  return tx(db, async () => {
    const app = await requireApplication(db, appId);
    const from = fromId !== undefined ? await db.documents.get(fromId) : await getMaster(db);
    if (!from || from.kind !== "resume" || !isLiveDocument(from)) throw new DocumentError("Add your resume first.");
    const id = await createVersion(
      db, { title: `Resume for ${app.company}${app.role ? `, ${app.role}` : ""}`, sections: from.sections, basedOn: from.id, source: "copy" }, now,
    );
    await db.applications.update(appId, { resumeId: id });
    return id;
  });
}

/** The title of an application's tailored resume. */
const tailoredTitle = (app: { company: string; role: string }): string =>
  cleanTitle(`Resume for ${app.company}${app.role ? `, ${app.role}` : ""} (tailored)`, "Resume (tailored)");

/**
 * The one tailored resume for an application: written from `sections`, or the one you have replaced. It is named after the application,
 * based on `basedOn` (the baseline it was tailored from; the master when not given), and the application is pointed at it. It never counts
 * against the cap on resume versions. Replacing an existing one changes its baseline only when `basedOn` is given.
 */
export async function saveTailored(
  db: JobTrackerDB, appId: number, sections: unknown, source: NonNullable<DocumentRow["source"]>, now: Date = new Date(), basedOn?: number,
): Promise<number> {
  const clean = normalizeSections(sections);
  if (!clean.length) throw new DocumentError("Add some text to the resume first.");
  return tx(db, async () => {
    const app = await requireApplication(db, appId);
    const existing = await getTailored(db, appId);
    const baseId = basedOn ?? (await getMaster(db))?.id;
    const at = iso(now);
    let id: number;
    if (existing) {
      await db.documents.update(existing.id, { sections: clean, source, updatedAt: at, ...(basedOn !== undefined ? { basedOn } : {}) });
      id = existing.id;
    } else {
      id = await db.documents.add({
        kind: "resume", master: false, applicationId: appId, title: tailoredTitle(app),
        sections: clean, ...(baseId !== undefined ? { basedOn: baseId } : {}), source, createdAt: at, updatedAt: at,
      });
    }
    await db.applications.update(appId, { resumeId: id });
    return id;
  });
}

/**
 * Starts the application's tailored resume as a copy of a baseline (the master or a reusable version), to edit by hand. Every line keeps its
 * id (ids only need to be unique inside one document), so the copy can be compared with its baseline later. Refused when the application
 * already has a tailored resume, or the baseline is deleted, not a resume, or tailored for another application.
 */
export async function startTailoredFromBaseline(db: JobTrackerDB, appId: number, baselineId: number, now: Date = new Date()): Promise<number> {
  return tx(db, async () => {
    const app = await requireApplication(db, appId);
    const baseline = await db.documents.get(baselineId);
    if (!baseline || baseline.kind !== "resume" || !isLiveDocument(baseline)) throw new DocumentError("That resume isn't there any more.");
    if (isTailored(baseline) && baseline.applicationId !== appId) throw new DocumentError("That resume was tailored for another application.");
    if (await getTailored(db, appId)) throw new DocumentError("This application already has a tailored resume.");
    const sections = normalizeSections(baseline.sections);
    if (!sections.length) throw new DocumentError("Add some text to the resume first.");
    const at = iso(now);
    const id = await db.documents.add({
      kind: "resume", master: false, applicationId: appId, title: tailoredTitle(app), sections, basedOn: baseline.id, source: "copy", createdAt: at, updatedAt: at,
    });
    await db.applications.update(appId, { resumeId: id });
    return id;
  });
}

/** The resumes a tailored copy can start from: the master first, then the reusable versions, in the order liveResumes lists them. */
export function baselineChoices(rows: readonly DocumentRow[]): DocumentRow[] {
  const rank = (d: DocumentRow) => (d.master ? 0 : 1);
  return rows.filter((d) => d.kind === "resume" && isLiveDocument(d) && !isTailored(d)).sort((a, b) => rank(a) - rank(b) || a.id - b.id);
}

/** Turns a tailored resume into a reusable version (it no longer belongs to the application, which keeps pointing at it). Refused at the cap. */
export async function promoteTailored(db: JobTrackerDB, id: number, title?: string, now: Date = new Date()): Promise<void> {
  await tx(db, async () => {
    const doc = await db.documents.get(id);
    if (!doc || !isLiveDocument(doc) || !isTailored(doc)) throw new MissingRecordError(`No tailored resume ${id}`);
    if ((await liveResumes(db)).filter((d) => !d.master).length >= MAX_RESUME_VERSIONS) {
      throw new DocumentError(`You can keep ${MAX_RESUME_VERSIONS} resume versions. Delete one to make another.`);
    }
    await db.documents.update(id, { applicationId: null, ...(title !== undefined ? { title: cleanTitle(title, doc.title) } : {}), updatedAt: iso(now) });
  });
}

/** Chooses the resume version sent with an application, or none (null). */
export async function setApplicationResume(db: JobTrackerDB, appId: number, resumeId: number | null): Promise<void> {
  await tx(db, async () => {
    await requireApplication(db, appId);
    if (resumeId === null) {
      const { resumeId: _drop, ...rest } = (await db.applications.get(appId))!;
      await db.applications.put(rest);
      return;
    }
    const doc = await db.documents.get(resumeId);
    if (!doc || doc.kind !== "resume" || !isLiveDocument(doc)) throw new DocumentError("That resume isn't there any more.");
    if (isTailored(doc) && doc.applicationId !== appId) throw new DocumentError("That resume was tailored for another application.");
    await db.applications.update(appId, { resumeId });
  });
}

/** The cover letter for an application: written from `sections`, or the one you have replaced. */
export async function saveCoverLetter(db: JobTrackerDB, appId: number, sections: unknown, source?: DocumentRow["source"], now: Date = new Date()): Promise<number> {
  const clean = normalizeSections(sections);
  if (!clean.length) throw new DocumentError("Write something first.");
  return tx(db, async () => {
    const app = await requireApplication(db, appId);
    const existing = await getCoverLetter(db, appId);
    const at = iso(now);
    if (existing) {
      await db.documents.update(existing.id, { sections: clean, updatedAt: at, ...(source ? { source } : {}) });
      return existing.id;
    }
    return db.documents.add({
      kind: "cover", master: false, applicationId: appId, title: cleanTitle(`Cover letter for ${app.company}${app.role ? `, ${app.role}` : ""}`, "Cover letter"),
      sections: clean, ...(source ? { source } : {}), createdAt: at, updatedAt: at,
    });
  });
}

/** Keeps the posting text on an application, cut to the limit. An empty text removes it. */
export async function setPostingText(db: JobTrackerDB, appId: number, text: string): Promise<void> {
  const clean = text.replace(/\r\n?/g, "\n").trim().slice(0, MAX_POSTING_CHARS);
  await tx(db, async () => {
    const app = await requireApplication(db, appId);
    if (clean) await db.applications.update(appId, { postingText: clean });
    else {
      const { postingText: _drop, ...rest } = app;
      await db.applications.put(rest);
    }
  });
}

/** Moves a document to Recently deleted. The master can't be deleted: replace its text instead. */
export async function deleteDocument(db: JobTrackerDB, id: number, now: Date = new Date()): Promise<void> {
  await tx(db, async () => {
    const doc = await db.documents.get(id);
    if (!doc || !isLiveDocument(doc)) throw new MissingRecordError(`No document ${id}`);
    if (doc.master) throw new DocumentError("Your master resume can't be deleted. Replace its text instead.");
    await db.documents.update(id, { deletedAt: iso(now) });
  });
}

export async function restoreDocument(db: JobTrackerDB, id: number): Promise<void> {
  await tx(db, async () => {
    const doc = await db.documents.get(id);
    if (!doc?.deletedAt) throw new MissingRecordError(`No deleted document ${id}`);
    if (doc.kind === "cover" && doc.applicationId !== null) {
      const app = await db.applications.get(doc.applicationId);
      if (!app || app.deletedAt) throw new DocumentError("Restore the application first.");
      if (await getCoverLetter(db, doc.applicationId)) throw new DocumentError("That application has a newer cover letter already.");
    }
    if (isTailored(doc)) {
      const app = await db.applications.get(doc.applicationId!);
      if (!app || app.deletedAt) throw new DocumentError("Restore the application first.");
      if (await getTailored(db, doc.applicationId!)) throw new DocumentError("That application has a newer tailored resume already.");
    } else if (doc.kind === "resume" && !doc.master && (await liveResumes(db)).filter((d) => !d.master).length >= MAX_RESUME_VERSIONS) {
      throw new DocumentError(`You can keep ${MAX_RESUME_VERSIONS} resume versions. Delete one to restore this.`);
    }
    const { deletedAt: _drop, ...rest } = doc;
    await db.documents.put(rest);
  });
}

/** Erases a document for good. An application that pointed at a resume no longer has one set. A cover letter is never pointed at, so it skips that scan. */
export async function eraseDocument(db: JobTrackerDB, id: number): Promise<void> {
  await tx(db, async () => {
    if ((await db.documents.get(id))?.kind === "resume") {
      for (const a of (await db.applications.toArray()).filter((x) => x.resumeId === id)) {
        const { resumeId: _drop, ...rest } = a;
        await db.applications.put(rest);
      }
    }
    await db.documents.delete(id);
  });
}

/** Deleted documents, newest deletion first, with the days left before they are erased. */
export async function listDeletedDocuments(db: JobTrackerDB, now: Date = new Date()): Promise<(DocumentRow & { daysLeft: number })[]> {
  return (await db.documents.toArray())
    .filter((d): d is DocumentRow & { deletedAt: string } => Boolean(d.deletedAt))
    .sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1))
    .map((d) => ({ ...d, daysLeft: Math.max(0, TRASH_DAYS - Math.floor(Math.max(0, now.getTime() - new Date(d.deletedAt).getTime()) / DAY_MS)) })); // a deletion time in the future counts as just now
}

/** Erases the deleted documents that have been there TRASH_DAYS or more. Returns how many. */
export async function purgeExpiredDocuments(db: JobTrackerDB, now: Date = new Date()): Promise<number> {
  const old = (await listDeletedDocuments(db, now)).filter((d) => d.daysLeft === 0);
  // One document that won't erase doesn't stop the rest: the first failure is thrown once the others are done.
  let erased = 0;
  let failure: unknown;
  for (const d of old) {
    try {
      await eraseDocument(db, d.id);
      erased++;
    } catch (e) {
      failure ??= e;
    }
  }
  if (failure) throw failure;
  return erased;
}


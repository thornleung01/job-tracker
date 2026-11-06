// Recently deleted: deleting an application hides it for 30 days instead of erasing it, so one slip can't lose a whole
// job search. A deleted application keeps its emails, notes, steps and people corrections; it is left out of every list,
// count and match (sync/live.ts) until you restore it or it is purged. Purging is the old delete: the application row goes
// and every email's content is erased, so nothing can rebuild it.
// This file also lists and erases deleted documents (resumes and cover letters), whose own moves and live check are in sync/documents.ts.
import { MissingRecordError } from "../db/errors";
import { clearEmail } from "../db/repo";
import { tx, type ApplicationRow, type JobTrackerDB } from "../db/schema";
import { TRASH_DAYS } from "../db/limits";
import { DAY_MS, iso } from "../db/time";
import type { Stage } from "../db/stages";
import { eraseDocument, listDeletedDocuments, purgeExpiredDocuments } from "./documents";
import { removeApplicationRow } from "./recheck";

/** How long a deleted application waits before it is erased for good. */
export { TRASH_DAYS };
/**
 * That is 30 x 24 hours counted on the timestamp, not 30 calendar days: a clock change (daylight saving) or a different time
 * zone can't move it by more than the hour the clocks changed, and nothing here depends on the viewer's zone.
 */
export const TRASH_MS = TRASH_DAYS * DAY_MS;

/** Erases an application for good: every email's content goes (only its id and date stay, so it is not fetched again) and then the application row with its notes and steps. Call it inside a transaction. */
export async function eraseApplication(db: JobTrackerDB, appId: number): Promise<void> {
  for (const e of await db.emails.where("applicationId").equals(appId).toArray()) await clearEmail(db, e.id);
  await removeApplicationRow(db, appId);
}

/** Marks an application deleted, keeping everything it holds. Throws MissingRecordError when it is gone or already deleted. Call it inside a transaction. */
export async function markDeleted(db: JobTrackerDB, appId: number, now: Date): Promise<ApplicationRow> {
  const app = await db.applications.get(appId);
  if (!app || app.deletedAt) throw new MissingRecordError(`No application ${appId}`);
  await db.applications.update(appId, { deletedAt: iso(now) });
  return app;
}

/** Brings a deleted application back as it was, with the same id, its emails and notes. Returns false when it wasn't deleted. Throws MissingRecordError when it has been purged. */
export async function restoreApplication(db: JobTrackerDB, appId: number): Promise<boolean> {
  return tx(db, async () => {
    const app = await db.applications.get(appId);
    if (!app) throw new MissingRecordError(`No application ${appId}`);
    if (!app.deletedAt) return false;
    await db.applications.update(appId, { deletedAt: undefined });
    return true;
  });
}

/** What the Recently deleted list shows for one application. */
export interface TrashEntry {
  kind: "application";
  id: number;
  company: string;
  role: string;
  stage: Stage;
  deletedAt: string;
  /** whole days since it was deleted (0 on the day) */
  daysAgo: number;
  /** whole days until it is erased, rounded up, so the last day reads "1 day left" until the moment it goes */
  daysLeft: number;
}

function toEntry(a: ApplicationRow & { deletedAt: string }, now: Date): TrashEntry {
  const age = Math.max(0, now.getTime() - new Date(a.deletedAt).getTime());
  return {
    kind: "application", id: a.id, company: a.company, role: a.role, stage: a.stage, deletedAt: a.deletedAt,
    daysAgo: Math.floor(age / DAY_MS), daysLeft: Math.max(0, Math.ceil((TRASH_MS - age) / DAY_MS)),
  };
}

/** What the Recently deleted list shows for one resume or cover letter. `label` is the row's text: "Resume for Acme, Analyst" or "Acme, Analyst". */
export interface DocumentTrashEntry {
  kind: "resume" | "cover";
  id: number;
  label: string;
  deletedAt: string;
  /** whole days since it was deleted (0 on the day) */
  daysAgo: number;
  /** whole days until it is erased (see listDeletedDocuments) */
  daysLeft: number;
}

const daysSince = (at: string, now: Date): number => Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / DAY_MS));

/** One row of Recently deleted, of any kind. */
export type AnyTrashEntry = TrashEntry | DocumentTrashEntry;

/**
 * Deleted resumes and cover letters, most recently deleted first. A cover letter is named after its application ("Acme, Analyst"),
 * or by its own title when the application is gone.
 */
export async function listDeletedDocumentEntries(db: JobTrackerDB, now: Date = new Date()): Promise<DocumentTrashEntry[]> {
  const apps = new Map((await db.applications.toArray()).map((a) => [a.id, a]));
  return (await listDeletedDocuments(db, now)).map((d) => {
    const app = d.applicationId === null ? undefined : apps.get(d.applicationId);
    const label = d.kind === "cover" && app ? [app.company, app.role].filter(Boolean).join(", ") : d.title;
    return { kind: d.kind, id: d.id, label: label || d.title, deletedAt: d.deletedAt as string, daysAgo: daysSince(d.deletedAt as string, now), daysLeft: d.daysLeft };
  });
}

/** Everything in Recently deleted, applications and documents together, most recently deleted first. */
export async function listTrash(db: JobTrackerDB, now: Date = new Date()): Promise<AnyTrashEntry[]> {
  const all: AnyTrashEntry[] = [...(await listDeleted(db, now)), ...(await listDeletedDocumentEntries(db, now))];
  return all.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0));
}

/** Erases one deleted document now. Returns false when it isn't in Recently deleted (restored or already gone). A live one is never touched. */
export async function deleteDocumentForever(db: JobTrackerDB, id: number): Promise<boolean> {
  return tx(db, async () => {
    if (!(await db.documents.get(id))?.deletedAt) return false;
    await eraseDocument(db, id);
    return true;
  });
}

/** The deleted application with this id, or null when there is none (it is live, or already erased). The detail page uses it for the page of a deleted application. */
export async function deletedApplication(db: JobTrackerDB, appId: number, now: Date = new Date()): Promise<TrashEntry | null> {
  const app = await db.applications.get(appId);
  return app?.deletedAt ? toEntry({ ...app, deletedAt: app.deletedAt }, now) : null;
}

/** True once an application deleted at `deletedAt` is old enough to erase at `now`. */
export function isExpired(deletedAt: string, now: Date): boolean {
  return now.getTime() - new Date(deletedAt).getTime() >= TRASH_MS;
}

/** Deleted applications, most recently deleted first. */
export async function listDeleted(db: JobTrackerDB, now: Date = new Date()): Promise<TrashEntry[]> {
  const rows = (await db.applications.toArray()).filter((a): a is ApplicationRow & { deletedAt: string } => Boolean(a.deletedAt));
  return rows
    .sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : b.id - a.id))
    .map((a) => toEntry(a, now));
}

/** Erases one deleted application now. Returns false when it isn't in Recently deleted (restored or already gone), and never touches a live one. */
export async function deleteForever(db: JobTrackerDB, appId: number): Promise<boolean> {
  return tx(db, async () => {
    if (!(await db.applications.get(appId))?.deletedAt) return false;
    await eraseApplication(db, appId);
    return true;
  });
}

/** Erases everything in Recently deleted, deleted resumes and cover letters too. Returns how many rows went (what the list showed). */
export async function emptyTrash(db: JobTrackerDB): Promise<number> {
  return tx(db, async () => {
    let erased = 0;
    // Documents first, so a deleted cover letter counts once and isn't taken with its application.
    for (const d of await db.documents.toArray()) {
      if (!d.deletedAt) continue;
      await eraseDocument(db, d.id);
      erased++;
    }
    for (const a of await db.applications.toArray()) {
      if (!a.deletedAt) continue;
      await eraseApplication(db, a.id);
      erased++;
    }
    return erased;
  });
}

/** True when `deletedAt` is later than `now`: a hand-edited file or a clock that was ahead when the application was deleted. */
const isInTheFuture = (deletedAt: string, now: Date): boolean => new Date(deletedAt).getTime() > now.getTime();

/**
 * Erases the deleted applications and documents that have waited TRASH_DAYS. Returns how many went.
 *
 * Each application is its own transaction, so one that can't be erased (it fails, or is changed by another tab at that moment)
 * never holds back the others, which would keep their email text past the 30 days: the rest are erased, and then the first
 * error is thrown. An application whose `deletedAt` is in the future would never expire, so its 30 days start now instead.
 */
export async function purgeExpired(db: JobTrackerDB, now: Date = new Date()): Promise<number> {
  const deleted = (await db.applications.toArray()).filter((a) => a.deletedAt);
  let erased = 0;
  let failure: { error: unknown } | null = null;
  for (const { id } of deleted) {
    try {
      const gone = await tx(db, async () => {
        const app = await db.applications.get(id);   // read again inside: it may have been restored or erased since the list was read
        if (!app?.deletedAt) return false;
        if (isInTheFuture(app.deletedAt, now)) await db.applications.update(id, { deletedAt: iso(now) });
        else if (isExpired(app.deletedAt, now)) await eraseApplication(db, id);
        else return false;
        return !(await db.applications.get(id));
      });
      if (gone) erased++;
    } catch (error) {
      console.error(error);
      failure ??= { error };
    }
  }
  try {
    erased += await purgeExpiredDocuments(db, now);
  } catch (error) {
    console.error(error);
    failure ??= { error };
  }
  if (failure) throw failure.error;
  return erased;
}

/** Databases already purged in this session, so the check runs once per session however often the page remounts. */
const purged = new WeakSet<JobTrackerDB>();

/** Purges expired applications the first time it is called for a database. Never throws: a failed purge simply runs again next session. */
export async function purgeOncePerSession(db: JobTrackerDB, now: Date = new Date()): Promise<void> {
  if (purged.has(db)) return;
  purged.add(db);
  try {
    await purgeExpired(db, now);
  } catch (err) {
    console.error(err);
  }
}

// Doing one thing to several applications at once. Each action is a single transaction: it all happens or none of it does.
import { ActionError } from "../db/errors";
import { isStage, type Stage } from "../db/stages";
import { tx, type ApplicationRow, type JobTrackerDB } from "../db/schema";
import { iso } from "../db/time";
import { deleteApplication } from "./actions";
import { isLive } from "./live";
import { isLiveDocument, isTailored } from "./documents";
import { restoreApplication } from "./trash";

/** The most applications one bulk action takes. */
export const BULK_MAX = 500;

/** The distinct, whole-number ids, in the order given. Refuses a list longer than BULK_MAX rather than quietly doing part of it. */
function validIds(ids: readonly number[]): number[] {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id)))];
  if (unique.length > BULK_MAX) throw new ActionError(`Choose ${BULK_MAX} applications or fewer at a time.`);
  return unique;
}

/** What setStage writes: the stage set by hand, stamped now, and locked so mail stops moving it. Kept in step with setStage in actions.ts by a test. */
function manualStage(stage: Stage, stamp: string) {
  return { stage, stageAt: stamp, locked: true };
}

/** Sets the stage by hand on each application and locks it, like the stage dropdown in the list. Returns how many changed. Ids that no longer exist are skipped. */
export async function bulkSetStage(db: JobTrackerDB, ids: readonly number[], stage: Stage, now: Date = new Date()): Promise<number> {
  if (!isStage(stage)) throw new ActionError("Unknown stage.");
  const wanted = validIds(ids);
  if (!wanted.length) return 0;
  const fields = manualStage(stage, iso(now));
  // A deleted application is "no such application" here, like an id that is gone.
  return tx(db, () => db.applications.where(":id").anyOf(wanted).filter(isLive).modify(fields));
}

/** How one application's stage stood before a bulk change. */
export interface StageBefore {
  id: number;
  stage: Stage;
  stageAt: string | null;
  locked: boolean;
}

/** Puts each stage back exactly as it was, including whether it was locked: the Undo after a bulk stage change. Returns how many were put back. Ids that no longer exist are skipped. */
export async function bulkRestoreStages(db: JobTrackerDB, before: readonly StageBefore[]): Promise<number> {
  if (!before.every((b) => isStage(b.stage))) throw new ActionError("Unknown stage.");
  const byId = new Map<number, StageBefore>();
  for (const b of before) if (Number.isInteger(b.id) && !byId.has(b.id)) byId.set(b.id, b);
  const wanted = validIds([...byId.keys()]);
  if (!wanted.length) return 0;
  return tx(db, async () => {
    let restored = 0;
    for (const id of wanted) {
      const { stage, stageAt, locked } = byId.get(id)!;
      const app = await db.applications.get(id);
      if (app && isLive(app)) restored += await db.applications.update(id, { stage, stageAt, locked });
    }
    return restored;
  });
}

/**
 * Deletes each application like Delete application on the detail page: it goes to Recently deleted for 30 days, with its emails,
 * so bulkRestore can bring them back. Returns how many were deleted. Ids that no longer exist (or are already deleted) are skipped.
 */
export async function bulkDelete(db: JobTrackerDB, ids: readonly number[], now: Date = new Date()): Promise<number> {
  const wanted = validIds(ids);
  if (!wanted.length) return 0;
  return tx(db, async () => {
    let deleted = 0;
    for (const id of wanted) {
      const app = await db.applications.get(id);
      if (!app || !isLive(app)) continue;
      await deleteApplication(db, id, "clear", now);
      deleted++;
    }
    return deleted;
  });
}

/** Brings deleted applications back, with their emails and notes: the Undo after a bulk delete. Returns how many came back. Ids that are live, or already erased, are skipped. */
export async function bulkRestore(db: JobTrackerDB, ids: readonly number[]): Promise<number> {
  const wanted = validIds(ids);
  if (!wanted.length) return 0;
  return tx(db, async () => {
    let restored = 0;
    for (const id of wanted) if ((await db.applications.get(id))?.deletedAt && (await restoreApplication(db, id))) restored++;
    return restored;
  });
}

/** How one application's resume stood before a bulk change: the version's id, or null for none. */
export interface ResumeBefore {
  id: number;
  resumeId: number | null;
}

/** Writes a resume id, or takes the field off for null. Nothing here checks the application: callers have. */
const writeResume = async (db: JobTrackerDB, app: ApplicationRow, resumeId: number | null) => {
  if (resumeId !== null) await db.applications.update(app.id, { resumeId });
  else {
    const { resumeId: _gone, ...rest } = app;
    await db.applications.put(rest);
  }
};

/**
 * Sets the resume sent on each application, or clears it (null). The version must be a live resume. Returns how many changed:
 * an application that already had it counts, an id that no longer exists (or is deleted) is skipped.
 */
export async function bulkSetResume(db: JobTrackerDB, ids: readonly number[], resumeId: number | null): Promise<number> {
  const wanted = validIds(ids);
  if (!wanted.length) return 0;
  return tx(db, async () => {
    if (resumeId !== null) {
      const doc = await db.documents.get(resumeId);
      if (!doc || doc.kind !== "resume" || !isLiveDocument(doc)) throw new ActionError("That resume isn't there any more.");
      if (isTailored(doc)) throw new ActionError("A tailored resume belongs to one application, so it can't be set on several.");
    }
    let changed = 0;
    for (const id of wanted) {
      const app = await db.applications.get(id);
      if (!app || !isLive(app)) continue;
      await writeResume(db, app, resumeId);
      changed++;
    }
    return changed;
  });
}

/**
 * Puts each application's resume back as it was: the Undo after a bulk Set resume. A version erased for good since can't be
 * pointed at, so that application is left with none. Returns how many were put back.
 */
export async function bulkRestoreResumes(db: JobTrackerDB, before: readonly ResumeBefore[]): Promise<number> {
  const byId = new Map<number, ResumeBefore>();
  for (const b of before) if (Number.isInteger(b.id) && !byId.has(b.id)) byId.set(b.id, b);
  const wanted = validIds([...byId.keys()]);
  if (!wanted.length) return 0;
  return tx(db, async () => {
    // One in Recently deleted can still be pointed at (it comes back with a restore).
    const known = new Set((await db.documents.where("kind").equals("resume").primaryKeys()) as number[]);
    let restored = 0;
    for (const id of wanted) {
      const was = byId.get(id)!.resumeId;
      const app = await db.applications.get(id);
      if (!app || !isLive(app)) continue;
      await writeResume(db, app, was !== null && known.has(was) ? was : null);
      restored++;
    }
    return restored;
  });
}

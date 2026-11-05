// Doing one thing to several applications at once. Each action is a single transaction: it all happens or none of it does.
import { ActionError } from "../db/errors";
import { isStage, type Stage } from "../db/stages";
import { tx, type JobTrackerDB } from "../db/schema";
import { iso } from "../db/time";
import { deleteApplication } from "./actions";

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
  return tx(db, () => db.applications.where(":id").anyOf(wanted).modify(fields));
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
      restored += await db.applications.update(id, { stage, stageAt, locked });
    }
    return restored;
  });
}

/** Deletes each application and clears its saved emails, like Delete application on the detail page. Returns how many were deleted. Ids that no longer exist are skipped. */
export async function bulkDelete(db: JobTrackerDB, ids: readonly number[]): Promise<number> {
  const wanted = validIds(ids);
  if (!wanted.length) return 0;
  return tx(db, async () => {
    let deleted = 0;
    for (const id of wanted) {
      if (!(await db.applications.get(id))) continue;
      await deleteApplication(db, id, "clear");
      deleted++;
    }
    return deleted;
  });
}

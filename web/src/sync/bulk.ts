// Doing one thing to several applications at once. Each action is a single transaction: it all happens or none of it does.
import { ActionError } from "../db/errors";
import { isStage, type Stage } from "../db/stages";
import { tx, type JobTrackerDB } from "../db/schema";
import { iso } from "../db/time";
import { deleteApplication } from "./actions";

/** The most applications one bulk action takes. */
export const BULK_MAX = 500;

/** The distinct, whole-number ids, in the order given. Refuses a list longer than BULK_MAX rather than quietly doing part of it. */
function cleanIds(ids: readonly number[]): number[] {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id)))];
  if (unique.length > BULK_MAX) throw new ActionError(`Choose ${BULK_MAX} applications or fewer at a time.`);
  return unique;
}

/** Sets the stage by hand on each application and locks it, like the stage dropdown in the list. Returns how many changed. Ids that no longer exist are skipped. */
export async function bulkSetStage(db: JobTrackerDB, ids: readonly number[], stage: Stage, now: Date = new Date()): Promise<number> {
  if (!isStage(stage)) throw new ActionError("Unknown stage.");
  const wanted = cleanIds(ids);
  if (!wanted.length) return 0;
  const stamp = iso(now);
  return tx(db, async () => {
    let changed = 0;
    for (const id of wanted) {
      if (!(await db.applications.get(id))) continue;
      await db.applications.update(id, { stage, stageAt: stamp, locked: true });
      changed++;
    }
    return changed;
  });
}

/** Deletes each application and clears its saved emails, like Delete application on the detail page. Returns how many were deleted. Ids that no longer exist are skipped. */
export async function bulkDelete(db: JobTrackerDB, ids: readonly number[]): Promise<number> {
  const wanted = cleanIds(ids);
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

// Which applications count. A deleted application stays in the database for 30 days (see trash.ts), so every read that
// lists, counts or matches applications goes through here and leaves it out.
import type { ApplicationRow, JobTrackerDB } from "../db/schema";

/** True unless you deleted it. */
export const isLive = (a: Pick<ApplicationRow, "deletedAt">): boolean => !a.deletedAt;

/** Every application you haven't deleted. */
export async function liveApplications(db: JobTrackerDB): Promise<ApplicationRow[]> {
  return (await db.applications.toArray()).filter(isLive);
}

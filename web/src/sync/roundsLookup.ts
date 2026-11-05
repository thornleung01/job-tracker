// Interview rounds for the whole application list, worked out from the interview emails already grouped and one read of the steps.
import type { ApplicationRow, JobTrackerDB } from "../db/schema";
import { deriveRounds, type MailForRounds } from "./rounds";
import { groupBy } from "./groupBy";

/**
 * Returns a lookup that gives an application's round count, or null when there is nothing to count. Pass each application's
 * interview emails (the other mail doesn't matter); the steps are read here, once.
 */
export async function roundsLookup(
  db: JobTrackerDB,
  interviewsByApp: ReadonlyMap<number, readonly MailForRounds[]>,
): Promise<(app: Pick<ApplicationRow, "id" | "interviewRounds">) => number | null> {
  const stepsBy = groupBy((await db.activity.toArray()).filter((s) => s.kind === "step"), (s) => s.applicationId);
  return (app) => deriveRounds(interviewsByApp.get(app.id) ?? [], stepsBy.get(app.id) ?? [], app.interviewRounds)?.count ?? null;
}

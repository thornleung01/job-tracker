// Interview rounds for the whole application list, worked out from one read of the emails and one of the steps.
import type { ActivityRow, ApplicationRow, EmailRow, JobTrackerDB } from "../db/schema";
import { deriveRounds } from "./rounds";

type Mail = Pick<EmailRow, "id" | "threadId" | "receivedAt" | "subject" | "body" | "event" | "applicationId">;

/**
 * Returns a function that gives an application's round count, or null when there is nothing to count. Pass the emails you
 * already loaded; the steps are read here, once. Only interview emails matter, so the rest are skipped.
 */
export async function listRounds(db: JobTrackerDB, emails: readonly Mail[]): Promise<(app: Pick<ApplicationRow, "id" | "interviewRounds">) => number | null> {
  const mailBy = new Map<number, Mail[]>();
  for (const e of emails) {
    if (e.applicationId == null || e.event !== "interview") continue;
    mailBy.set(e.applicationId, [...(mailBy.get(e.applicationId) ?? []), e]);
  }
  const stepsBy = new Map<number, ActivityRow[]>();
  for (const s of await db.activity.toArray()) {
    if (s.kind === "step") stepsBy.set(s.applicationId, [...(stepsBy.get(s.applicationId) ?? []), s]);
  }
  return (app) => deriveRounds(mailBy.get(app.id) ?? [], stepsBy.get(app.id) ?? [], app.interviewRounds)?.count ?? null;
}

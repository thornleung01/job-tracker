// When an application is worth a nudge: nothing has moved, and it has gone quiet.
import type { Stage } from "../db/stages";

/** Idle days (calendar days since the last activity, see idleDaysSince) before an application that hasn't moved needs a follow-up. */
export const FOLLOW_UP_DAYS = 7;

/** Only these stages mean nothing has moved. Assessment, Interview, Offer and Rejected never need a nudge. */
const WAITING: ReadonlySet<Stage> = new Set<Stage>(["Applied", "Heard back"]);

/** True for an Applied or Heard back application idle for FOLLOW_UP_DAYS or more. An unknown idle time never counts. */
export function needsFollowUp(stage: Stage, idleDays: number | null): boolean {
  return WAITING.has(stage) && idleDays !== null && idleDays >= FOLLOW_UP_DAYS;
}

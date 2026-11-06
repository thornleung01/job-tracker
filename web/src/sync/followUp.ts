// When an application is worth a nudge: nothing has moved, and it has gone quiet. After a month of quiet it is called ghosted
// instead, and the nudges stop.
import type { Stage } from "../db/stages";

/** Idle days (calendar days since the last activity, see idleDaysSince) before an application that hasn't moved needs a follow-up. */
export const FOLLOW_UP_DAYS = 7;

/** Idle days after which an application that hasn't moved is ghosted: it shows "No reply in 30 days" and is no longer nudged. */
export const GHOSTED_DAYS = 30;

/** Only these stages mean nothing has moved. Assessment, Interview, Offer and Rejected never need a nudge. */
const WAITING: ReadonlySet<Stage> = new Set<Stage>(["Applied", "Heard back"]);

/** True for the stages where nothing has moved (Applied, Heard back): the only ones that are nudged or called ghosted. The calendar reuses this rule. */
export const isWaitingStage = (stage: Stage): boolean => WAITING.has(stage);

/**
 * False for a Rejected or Offer application: a past interview email shouldn't remind you of a meeting for one that has already been
 * decided, so its next interview isn't shown on the list, the calendar or the application's own actions.
 */
export const remindsOfInterviews = (stage: string): boolean => stage !== "Rejected" && stage !== "Offer";

/**
 * True for an Applied or Heard back application idle for 7 to 29 days (FOLLOW_UP_DAYS up to, not including, GHOSTED_DAYS). This is
 * what the Needs follow-up filter and the "Follow up?" tag use. From 30 days it is ghosted instead, so a month-old application
 * stops asking for a nudge. An unknown idle time never counts.
 */
export function needsFollowUp(stage: Stage, idleDays: number | null): boolean {
  return WAITING.has(stage) && idleDays !== null && idleDays >= FOLLOW_UP_DAYS && idleDays < GHOSTED_DAYS;
}

/** True for an Applied or Heard back application idle for GHOSTED_DAYS or more. An unknown idle time never counts. */
export function isGhosted(stage: Stage, idleDays: number | null): boolean {
  return WAITING.has(stage) && idleDays !== null && idleDays >= GHOSTED_DAYS;
}

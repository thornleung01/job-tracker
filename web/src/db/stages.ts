// Stage vocabulary and event mapping, from jobtracker/db.py.

export type EventName = "applied" | "heard_back" | "assessment" | "interview" | "offer" | "rejected";
export type Stage = "Applied" | "Heard back" | "Assessment" | "Interview" | "Offer" | "Rejected";
export type Confidence = "high" | "medium" | "low";

export const STAGE_FOR_EVENT: Readonly<Record<EventName, Stage>> = {
  applied: "Applied",
  heard_back: "Heard back",
  assessment: "Assessment",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};
export const EVENT_FOR_STAGE: Readonly<Record<Stage, EventName>> = {
  Applied: "applied",
  "Heard back": "heard_back",
  Assessment: "assessment",
  Interview: "interview",
  Offer: "offer",
  Rejected: "rejected",
};
export const STAGES: readonly Stage[] = Object.values(STAGE_FOR_EVENT);
/** Progression events only move an application forward. */
export const PROGRESSION: readonly Stage[] = ["Applied", "Heard back", "Assessment", "Interview"];
/** Terminal events can land from any stage, but only if the email is newer than the current stage. */
export const TERMINAL: ReadonlySet<Stage> = new Set<Stage>(["Offer", "Rejected"]);

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}
export function isEvent(value: unknown): value is EventName {
  return typeof value === "string" && value in STAGE_FOR_EVENT;
}

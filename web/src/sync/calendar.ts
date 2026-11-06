// What the calendar shows on each day. Pure: it takes the list rows and the logged steps and returns the events by day.
// Every day is a viewer-local YYYY-MM-DD (see db/time.ts); events carry a day, never a time.
import type { Stage } from "../db/stages";
import type { JobTrackerDB } from "../db/schema";
import { safeOfferDeadline } from "../db/offer";
import { dayOf, daysBetween, shiftDay } from "../db/time";
import { FOLLOW_UP_DAYS, GHOSTED_DAYS, isGhosted, isWaitingStage, remindsOfInterviews } from "./followUp";
import type { ApplicationListRow } from "./queries";

export type CalendarKind = "interview" | "applied" | "offer" | "followUp" | "step";

export interface CalendarEvent {
  /** `${kind}:${appId}:${day}:${label}`: unique within a day, for React keys */
  key: string;
  /** YYYY-MM-DD */
  day: string;
  kind: CalendarKind;
  appId: number;
  company: string;
  role: string;
  stage: Stage;
  /** the words shown: "Interview", "Applied", "Offer decision due", "Follow up due", "Follow up was due", "No reply in 30 days", or a step's name */
  label: string;
  /** before today */
  past: boolean;
  /** an interview's "Sent: ..." line: the live resume the application was sent with */
  resumeTitle?: string;
}

/** The part of a list row the calendar reads. */
export type CalendarRow = Pick<
  ApplicationListRow, "id" | "company" | "role" | "stage" | "appliedAt" | "lastActivity" | "followUp" | "offerDeadline" | "interviewDays"
>;

/** A step you logged (kind "step" in the activity table). */
export interface CalendarStep {
  applicationId: number;
  label: string;
  occurredAt: string;
}

/** The order of events within a day. */
export const KIND_ORDER: readonly CalendarKind[] = ["interview", "offer", "followUp", "applied", "step"];

const KIND_RANK: Readonly<Record<CalendarKind, number>> = Object.fromEntries(KIND_ORDER.map((k, i) => [k, i])) as Record<CalendarKind, number>;

const text = (a: string, b: string) => a.localeCompare(b);

/** Kind, then company, then id, then label, so the order never depends on how the rows arrived. */
const byOrder = (a: CalendarEvent, b: CalendarEvent): number =>
  KIND_RANK[a.kind] - KIND_RANK[b.kind] || text(a.company, b.company) || a.appId - b.appId || text(a.label, b.label);

/** Steps that are already shown as their own kind of event. */
const SHOWN_ELSEWHERE = "Applied";

/**
 * The events on each day from `range.from` to `range.to` (both included), as a map from YYYY-MM-DD to that day's events in a fixed
 * order. Days with no events are absent. `today` is YYYY-MM-DD.
 *  - Interview: every interview day. A day that is today or later is hidden for a Rejected or Offer application (an old email
 *    shouldn't remind you of it), the same rule as the list's next interview.
 *  - Applied: the day you applied.
 *  - Offer decision due: at the Offer stage with a deadline.
 *  - Follow-up: one per Applied or Heard back application, a week after its last activity (or its applied day when there is none).
 *    "Follow up was due" when that day has passed and the Follow up? tag shows. After 30 quiet days the application is ghosted and
 *    gets "No reply in 30 days" on that 30th day instead.
 *  - Step: a step you logged, except "Applied" and an "Interview" on a day that already shows an interview. The same step on the
 *    same day shows once. A step of an application that isn't in `rows` (deleted, or filtered out) is left out.
 * `resumeTitles` (application id to live resume title, see resumeTitlesByApp) gives interview events their `resumeTitle`.
 */
export function calendarEvents(
  rows: readonly CalendarRow[], steps: readonly CalendarStep[], today: string, range: { from: string; to: string },
  resumeTitles?: ReadonlyMap<number, string>,
): Map<string, CalendarEvent[]> {
  const events = new Map<string, CalendarEvent[]>();
  const interviewOn = new Set<string>();
  const seenSteps = new Set<string>();
  const byId = new Map<number, CalendarRow>();

  const add = (row: CalendarRow, kind: CalendarKind, day: string, label: string) => {
    if (!day || day < range.from || day > range.to) return;
    const event: CalendarEvent = {
      key: `${kind}:${row.id}:${day}:${label}`, day, kind, appId: row.id, company: row.company, role: row.role, stage: row.stage, label, past: day < today,
    };
    const resumeTitle = kind === "interview" ? resumeTitles?.get(row.id) : undefined;
    if (resumeTitle) event.resumeTitle = resumeTitle;
    const list = events.get(day);
    if (list) list.push(event);
    else events.set(day, [event]);
  };

  for (const row of rows) {
    byId.set(row.id, row);
    const reminds = remindsOfInterviews(row.stage);
    for (const day of row.interviewDays) {
      if (day >= today && !reminds) continue;
      add(row, "interview", day, "Interview");
      interviewOn.add(`${row.id}:${day}`);
    }
    add(row, "applied", dayOf(row.appliedAt), "Applied");
    const deadline = row.stage === "Offer" ? safeOfferDeadline(row.offerDeadline) : undefined;
    if (deadline) add(row, "offer", deadline, "Offer decision due");
    if (isWaitingStage(row.stage)) {
      const last = dayOf(row.lastActivity);
      const idle = last ? Math.max(0, daysBetween(last, today)) : null;
      if (last && isGhosted(row.stage, idle)) add(row, "followUp", shiftDay(last, GHOSTED_DAYS), `No reply in ${GHOSTED_DAYS} days`);
      else {
        const base = last || dayOf(row.appliedAt);
        if (base) {
          const day = shiftDay(base, FOLLOW_UP_DAYS);
          add(row, "followUp", day, day < today && row.followUp ? "Follow up was due" : "Follow up due");
        }
      }
    }
  }

  for (const step of steps) {
    const row = byId.get(step.applicationId);
    const day = dayOf(step.occurredAt);
    if (!row || !day || !step.label || step.label === SHOWN_ELSEWHERE) continue;
    if (step.label === "Interview" && interviewOn.has(`${row.id}:${day}`)) continue;
    const key = `${row.id}:${day}:${step.label}`;
    if (seenSteps.has(key)) continue;
    seenSteps.add(key);
    add(row, "step", day, step.label);
  }

  for (const list of events.values()) list.sort(byOrder);
  return events;
}

/** The steps logged from `from` to `to` (YYYY-MM-DD, both included), for calendarEvents. Reads the activity table and keeps `kind: "step"` rows. */
export async function calendarSteps(db: JobTrackerDB, from: string, to: string): Promise<CalendarStep[]> {
  const out: CalendarStep[] = [];
  for (const a of await db.activity.toArray()) {
    if (a.kind !== "step" || !a.label) continue;
    const day = dayOf(a.occurredAt);
    if (day && day >= from && day <= to) out.push({ applicationId: a.applicationId, label: a.label, occurredAt: a.occurredAt });
  }
  return out;
}

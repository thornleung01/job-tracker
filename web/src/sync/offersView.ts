// The Compare offers card: every application at Offer (or carrying offer details), with the decision deadline counted in days.
// Pure. Salary is free text, so nothing here reads a number out of it.
import { safeOfferDeadline, safeOfferSalary } from "../db/offer";
import type { ApplicationRow, JobTrackerDB } from "../db/schema";
import type { Stage } from "../db/stages";
import { dayOf, daysBetween, localToday } from "../db/time";
import { isLive, liveApplications } from "./live";

export interface OfferEntry {
  id: number;
  company: string;
  role: string;
  stage: Stage;
  /** what you typed, "" when none */
  salary: string;
  /** YYYY-MM-DD, "" when none */
  deadline: string;
  /** whole days from today to the deadline: 0 is today, negative once it has passed; null when there is no deadline */
  daysLeft: number | null;
  /** the day the application reached its stage, "" when unknown */
  stageDay: string;
}

type OfferRow = Pick<ApplicationRow, "id" | "company" | "role" | "stage" | "stageAt" | "offerSalary" | "offerDeadline" | "deletedAt">;

/** The card shows when at least this many applications have an offer. */
export const OFFERS_MIN = 2;

/**
 * The offers to compare. An application counts when its stage is Offer or it has a salary or a deadline saved. Order: deadlines
 * still ahead first, soonest first (today is first of all), then deadlines that have passed, most recent first, then offers with no
 * deadline, newest stage date first. Deleted applications are left out.
 */
export function offersView(rows: readonly OfferRow[], today: string): OfferEntry[] {
  const entries: OfferEntry[] = [];
  for (const r of rows) {
    if (!isLive(r)) continue;
    const salary = safeOfferSalary(r.offerSalary) ?? "";
    const deadline = safeOfferDeadline(r.offerDeadline) ?? "";
    if (r.stage !== "Offer" && !salary && !deadline) continue;
    entries.push({
      id: r.id, company: r.company, role: r.role, stage: r.stage, salary, deadline,
      daysLeft: deadline ? daysBetween(today, deadline) : null, stageDay: dayOf(r.stageAt),
    });
  }
  const rank = (e: OfferEntry) => (e.daysLeft === null ? 2 : e.daysLeft >= 0 ? 0 : 1);
  return entries.sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    if (a.daysLeft !== null && b.daysLeft !== null) return rank(a) === 0 ? a.daysLeft - b.daysLeft : b.daysLeft - a.daysLeft;
    return b.stageDay.localeCompare(a.stageDay) || a.id - b.id;
  });
}

/** The deadline in plain words: "3 days left", "1 day left", "Today", "Passed 2 days ago", "Yesterday"... or "" when none. */
export function deadlineWords(daysLeft: number | null): string {
  if (daysLeft === null) return "";
  if (daysLeft === 0) return "Today";
  if (daysLeft > 0) return daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
  return daysLeft === -1 ? "Passed yesterday" : `Passed ${-daysLeft} days ago`;
}

/** What the page shows: the entries, or none when fewer than OFFERS_MIN applications have an offer. */
export async function loadOffers(db: JobTrackerDB, now: Date = new Date()): Promise<OfferEntry[]> {
  const entries = offersView(await liveApplications(db), localToday(now));
  return entries.length >= OFFERS_MIN ? entries : [];
}

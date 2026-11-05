// Upcoming interviews: the next day an application's interview emails say a meeting is on, and how to show it.
import { interviewMeetings, type MailForRounds } from "./rounds";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** How far ahead the "Coming up" strip looks, and how many rows it shows. */
export const COMING_UP_DAYS = 7;
export const COMING_UP_MAX = 5;

const parts = (day: string): [number, number, number] => {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
};

/**
 * The earliest interview day (YYYY-MM-DD) that is today or later, or null. Each thread counts once, with the newest email
 * deciding its day, so a rescheduled meeting follows its new day and a cancelled one is dropped.
 */
export function nextInterviewDay(emails: readonly MailForRounds[], today: string): string | null {
  let next: string | null = null;
  for (const { day } of interviewMeetings(emails)) {
    if (day && day >= today && (next === null || day < next)) next = day;
  }
  return next;
}

/** Whole calendar days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
}

/** "Thu, Oct 15" for a YYYY-MM-DD. */
export function shortDay(day: string): string {
  const [y, m, d] = parts(day);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTHS[m - 1]} ${d}`;
}

/** "Today", "Tomorrow", or "Thu, Oct 15". */
export function dayLabel(day: string, today: string): string {
  const away = daysBetween(today, day);
  return away === 0 ? "Today" : away === 1 ? "Tomorrow" : shortDay(day);
}

export interface UpcomingRow {
  id: number;
  company: string;
  role: string;
  nextInterview: string | null;
}

/** The interviews in the next week, soonest first (then by company), at most five. */
export function comingUp<T extends UpcomingRow>(rows: readonly T[], today: string): T[] {
  return rows
    .filter((r) => r.nextInterview !== null && daysBetween(today, r.nextInterview) >= 0 && daysBetween(today, r.nextInterview) <= COMING_UP_DAYS)
    .sort((a, b) => (a.nextInterview! < b.nextInterview! ? -1 : a.nextInterview! > b.nextInterview! ? 1 : a.company.localeCompare(b.company) || a.id - b.id))
    .slice(0, COMING_UP_MAX);
}

// Upcoming interviews: the next day an application's interview emails say a meeting is on, and how to show it.
import { dayText } from "../components/TimeText";
import { DAY_MS } from "../db/time";
import { interviewMeetings, type MailForRounds } from "./rounds";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** How far ahead the "Coming up" strip looks, and how many rows it shows. */
const COMING_UP_DAYS = 7;
const COMING_UP_MAX = 5;

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
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${dayText(day, "plain")}`;
}

/** How soon a day is: today, tomorrow or later, with the words to show for it ("Today", "Tomorrow", "Thu, Oct 15"). */
export interface DayWhen {
  when: "today" | "tomorrow" | "later";
  text: string;
}

export function dayWhen(day: string, today: string): DayWhen {
  const away = daysBetween(today, day);
  if (away === 0) return { when: "today", text: "Today" };
  if (away === 1) return { when: "tomorrow", text: "Tomorrow" };
  return { when: "later", text: shortDay(day) };
}

/** "Today", "Tomorrow", or "Thu, Oct 15". */
export const dayLabel = (day: string, today: string): string => dayWhen(day, today).text;

export interface UpcomingRow {
  id: number;
  company: string;
  role: string;
  nextInterview: string | null;
}

/** The interviews in the next week, soonest first (then by company, then id), at most five. */
export function comingUp<T extends UpcomingRow>(rows: readonly T[], today: string): T[] {
  const soon: { row: T; away: number }[] = [];
  for (const row of rows) {
    if (row.nextInterview === null) continue;
    const away = daysBetween(today, row.nextInterview);
    if (away >= 0 && away <= COMING_UP_DAYS) soon.push({ row, away });
  }
  soon.sort((a, b) => a.away - b.away || a.row.company.localeCompare(b.row.company) || a.row.id - b.row.id);
  return soon.slice(0, COMING_UP_MAX).map((s) => s.row);
}

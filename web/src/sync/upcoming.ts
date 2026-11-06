// Upcoming interviews: the next day an application's interview emails say a meeting is on, and how to show it.
import { WEEKDAY_NAMES, dayText } from "../db/dayText";
import { daysBetween, weekdayOf } from "../db/time";
import { interviewMeetings, type MailForRounds } from "./rounds";

/** "Sun" ... "Sat", by weekday number (see weekdayOf in db/time.ts). The full names are WEEKDAY_NAMES in db/dayText.ts. */
export const WEEKDAYS: readonly string[] = WEEKDAY_NAMES.map((name) => name.slice(0, 3));

/** How far ahead the "Coming up" strip looks, and how many rows it shows. */
const COMING_UP_DAYS = 7;
const COMING_UP_MAX = 5;

/**
 * Every interview day (YYYY-MM-DD) the emails name, past and future, each once, earliest first. Each thread counts once, with the
 * newest email deciding its day, so a rescheduled meeting follows its new day and a cancelled one is dropped (see interviewMeetings).
 */
export function meetingDays(emails: readonly MailForRounds[]): string[] {
  const days = new Set<string>();
  for (const { day } of interviewMeetings(emails)) if (day) days.add(day);
  return [...days].sort();
}

/** The earliest interview day (YYYY-MM-DD) that is today or later, or null. Built on meetingDays, so it follows its rules. */
export function nextInterviewDay(emails: readonly MailForRounds[], today: string): string | null {
  return meetingDays(emails).find((day) => day >= today) ?? null;
}

/**
 * Every interview day (YYYY-MM-DD) that is today or later, each once, earliest first. It counts meetings the way meetingDays does,
 * so its first day is always nextInterviewDay's.
 */
export function interviewDays(emails: readonly MailForRounds[], today: string): string[] {
  return meetingDays(emails).filter((day) => day >= today);
}

/** "Thu, Oct 15" for a YYYY-MM-DD. */
export function shortDay(day: string): string {
  return `${WEEKDAYS[weekdayOf(day)]}, ${dayText(day, "plain")}`;
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

export interface UpcomingRow {
  id: number;
  company: string;
  role: string;
  nextInterview: string | null;
  /** named in the calendar entry; the list rows carry it */
  stage?: string;
  /** the title of the resume sent, when it is live; a deleted or missing resume leaves it out */
  resumeTitle?: string | null;
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

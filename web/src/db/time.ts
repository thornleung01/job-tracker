import { ActionError } from "./errors";

// Times are ISO-8601 UTC strings without milliseconds, like jobtracker/db.py's iso(), so string comparison orders them.

export const DAY_MS = 86_400_000;

export function iso(when: Date | string | number): string {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Not a date: ${String(when)}`);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function addDays(when: Date, days: number): Date {
  return new Date(when.getTime() + days * DAY_MS);
}

// -- calendar days -------------------------------------------------------------------------------------------------
//
// One rule for "which day is this?". A stored time is one of two things:
//  - an instant (a mail's date, "now"): it belongs to the day it falls on in the VIEWER's time zone, so a 9 pm email in
//    Toronto is that evening's day, not the next one in UTC;
//  - a day you picked (applied on Oct 21): stored as noon UTC, DAY_STAMP below, and read back by its date. Noon UTC is
//    the middle of the day for the zones near Greenwich, and reading it by its date makes it the day you picked in every
//    zone from UTC-12 to UTC+14 (as an instant it would slip into the next day east of UTC+11). A mail that really arrived at
//    exactly 12:00:00 UTC reads the same way: at most a day off, only east of UTC+11, one mail in 86,400.
// Everything that shows a day, exports one, or compares days goes through dayOf, localDay and localToday below.
// The optional `timeZone` (an IANA name such as "America/Toronto") is for tests; the app always uses the viewer's own.

/** The clock time a picked day is stored at. */
const DAY_STAMP = "T12:00:00Z";

const dayFormats = new Map<string, Intl.DateTimeFormat>();
const pad2 = (n: number) => String(n).padStart(2, "0");

/** The calendar day (YYYY-MM-DD) an instant falls on in `timeZone`, or in the viewer's own zone. */
export function localDay(when: Date | string | number, timeZone?: string): string {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Not a date: ${String(when)}`);
  if (timeZone === undefined) return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  let format = dayFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormats.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Your calendar day (local time) as YYYY-MM-DD. */
export function localToday(now: Date = new Date(), timeZone?: string): string {
  return localDay(now, timeZone);
}

/** The day a stored time stands for, as YYYY-MM-DD, or "" when it isn't a time. See the rule above. */
export function dayOf(value: string | null | undefined, timeZone?: string): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value.endsWith(DAY_STAMP) && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  const when = new Date(value);
  return Number.isNaN(when.getTime()) ? "" : localDay(when, timeZone);
}

export const EARLIEST_DAY = "1990-01-01";

/**
 * The time to store for "this happened on `day`" (YYYY-MM-DD, read as the viewer's calendar day). Today is the current
 * instant, so it sorts among today's mail; any other day is noon UTC, which always reads back as that day. Throws
 * ActionError for something that isn't a day, is in the future, or is before 1990.
 */
export function stampForDay(day: string, now: Date = new Date(), timeZone?: string): string {
  if (!isDayString(day)) throw new ActionError("Enter the date as year-month-day, for example 2026-10-21.");
  const today = localToday(now, timeZone);
  if (day > today) throw new ActionError("The date can't be in the future.");
  if (day < EARLIEST_DAY) throw new ActionError("Enter a date from 1990 onward.");
  if (day !== today) return `${day}${DAY_STAMP}`;
  // An instant that is exactly noon UTC would be read as a picked day, so move it one second.
  const current = iso(now);
  return current.endsWith(DAY_STAMP) ? iso(now.getTime() + 1000) : current;
}

/** Whole calendar days from one YYYY-MM-DD to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
}

/**
 * How many calendar days (in the viewer's zone) have passed since a stored time, or null when unknown. Never negative: a
 * time later today, or a day stamp a little ahead of the clock, is 0. A list's "idle days" and the follow-up nudge use this,
 * so "7 days ago" always means the date shown is 7 days back.
 */
export function idleDaysSince(value: string | null | undefined, now: Date = new Date(), timeZone?: string): number | null {
  const day = dayOf(value, timeZone);
  return day ? Math.max(0, daysBetween(day, localToday(now, timeZone))) : null;
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isDayString(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** Python's round(): halves go to the even neighbour, so percentages match stats.py exactly. */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

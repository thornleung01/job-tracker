// The month grid: which days a month view shows. Pure maths on YYYY-MM-DD and YYYY-MM strings, done in UTC (see shiftDay in
// db/time.ts), so no time zone or daylight saving change can move a day.
import { MONTHS } from "../db/dayText";
import { WEEK_START, daysBetween, daysInMonth, shiftDay, startOfWeek } from "../db/time";

const FIRST_YEAR = 1990;
const LAST_YEAR = 2100;
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

const parse = (month: string): [number, number] => {
  const [y, m] = month.split("-").map(Number);
  return [y, m];
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * The weeks a month needs (5 or 6, 4 for a February that starts on the first weekday), each seven YYYY-MM-DD days from `weekStart`
 * (WEEK_START in db/time.ts unless told otherwise, 0 is Sunday: the same day the weekly goal's week starts on).
 */
export function monthGrid(month: string, weekStart: number = WEEK_START): string[][] {
  const [y, m] = parse(month);
  const first = `${month}-01`;
  const start = startOfWeek(first, weekStart);
  const weeks = Math.ceil((daysBetween(start, first) + daysInMonth(y, m)) / 7);
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => shiftDay(start, w * 7 + d)));
}

/** The first and last day the grid shows (inclusive), which reach into the months on either side. */
export function gridRange(month: string, weekStart: number = WEEK_START): { from: string; to: string } {
  const weeks = monthGrid(month, weekStart);
  return { from: weeks[0][0], to: weeks[weeks.length - 1][6] };
}

/** The month `n` months after `month` (before it when negative), as YYYY-MM. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = parse(month);
  const index = y * 12 + (m - 1) + n;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${pad2((index % 12 + 12) % 12 + 1)}`;
}

/**
 * A month from the address, as YYYY-MM. A value that isn't a month falls back to the month of `today` (YYYY-MM-DD). A year outside
 * 1990 to 2100 is moved to the nearest month inside it, so a typed address can't ask for a grid of a million years ago.
 */
export function parseMonth(value: string | null | undefined, today: string): string {
  const m = value ? MONTH_PATTERN.exec(value) : null;
  if (!m) return today.slice(0, 7);
  const year = Number(m[1]);
  if (year < FIRST_YEAR) return `${FIRST_YEAR}-01`;
  if (year > LAST_YEAR) return `${LAST_YEAR}-12`;
  return value as string;
}

/** "November 2026". */
export function monthTitle(month: string): string {
  const [y, m] = parse(month);
  return `${MONTHS[m - 1] ?? ""} ${y}`.trim();
}

// The weekly goal: how many applications you want to send each week, and how many you have sent this week. Stored per account
// database in the settings table (key "weeklyGoal"), so Export and Import carry it. Default: no goal, and nothing is shown.
import { WEEKLY_GOAL_MAX } from "../db/limits";
import { isRecord } from "../db/isRecord";
import { ActionError } from "../db/errors";
import { getSetting, setSetting } from "../db/repo";
import type { ApplicationRow, JobTrackerDB } from "../db/schema";
import { WEEK_START, dayOf, localToday, shiftDay, startOfWeek } from "../db/time";
import { isLive, liveApplications } from "./live";

export const GOAL_KEY = "weeklyGoal";

/** The goal as it is stored: a whole number from 1 to WEEKLY_GOAL_MAX, or null for none. Anything else (an import) is none. */
export function sanitizeGoal(raw: unknown): number | null {
  const n = isRecord(raw) ? raw.perWeek : raw;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= WEEKLY_GOAL_MAX ? n : null;
}

export async function loadGoal(db: JobTrackerDB): Promise<number | null> {
  return sanitizeGoal(await getSetting(db, GOAL_KEY));
}

/** Sets the goal. Text from a form is read as a whole number; empty or 0 clears it. Throws ActionError for anything else. */
export async function setGoal(db: JobTrackerDB, value: number | string): Promise<number | null> {
  const text = String(value).trim();
  if (text === "" || text === "0") {
    await db.settings.delete(GOAL_KEY);
    return null;
  }
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!(n >= 1 && n <= WEEKLY_GOAL_MAX)) throw new ActionError(`Enter a whole number from 1 to ${WEEKLY_GOAL_MAX}.`);
  await setSetting(db, GOAL_KEY, { perWeek: n });
  return n;
}

export async function clearGoal(db: JobTrackerDB): Promise<void> {
  await db.settings.delete(GOAL_KEY);
}

/** The first and last day (YYYY-MM-DD) of the week `today` is in. The week starts on WEEK_START (db/time.ts), the same day the calendar's first column does. */
export function weekOf(today: string, weekStart: number = WEEK_START): { start: string; end: string } {
  const start = startOfWeek(today, weekStart);
  return { start, end: shiftDay(start, 6) };
}

export interface WeeklyProgress {
  /** applications with an applied day in this week */
  count: number;
  goal: number;
  /** 0 to 100, for the bar */
  percent: number;
  done: boolean;
  start: string;
  end: string;
}

/**
 * How far this week's applications are toward the goal. The week runs from `weekStart` (WEEK_START: Monday unless told otherwise,
 * 0 is Sunday) to six days later in the viewer's zone, and an application counts on the day it was applied (dayOf, so a picked
 * day and an instant both land on the right day). Deleted applications and ones with no applied day don't count. `timeZone` is for tests.
 */
export function weeklyProgress(
  rows: readonly Pick<ApplicationRow, "appliedAt" | "deletedAt">[], goal: number, now: Date = new Date(), weekStart: number = WEEK_START, timeZone?: string,
): WeeklyProgress {
  const { start, end } = weekOf(localToday(now, timeZone), weekStart);
  let count = 0;
  for (const r of rows) {
    if (!isLive(r)) continue;
    const day = dayOf(r.appliedAt, timeZone);
    if (day && day >= start && day <= end) count++;
  }
  return { count, goal, percent: goal > 0 ? Math.min(100, Math.round((count / goal) * 100)) : 0, done: goal > 0 && count >= goal, start, end };
}

/** The goal and this week's progress for the page, or null when there is no goal. */
export async function loadWeeklyProgress(db: JobTrackerDB, now: Date = new Date(), weekStart: number = WEEK_START): Promise<WeeklyProgress | null> {
  const goal = await loadGoal(db);
  return goal === null ? null : weeklyProgress(await liveApplications(db), goal, now, weekStart);
}

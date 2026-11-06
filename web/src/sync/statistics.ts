// The numbers on the Statistics page beyond the funnel: how fast companies answer, how many applications you send a week, how the
// reply rate moves month by month, and what is still waiting. Hosted edition only (the Python edition has just the funnel).
//
// There is no stage history: only the current stage is stored. So every timing comes from dated evidence, a classified email
// (its receivedAt) or a step you logged that names a stage (its occurredAt), and an application with no such evidence simply
// adds nothing to that timing. All days are the viewer's calendar days (db/time.ts); `timeZone` is for tests.
import type { ApplicationRow, JobTrackerDB } from "../db/schema";
import { TERMINAL, type Stage } from "../db/stages";
import { WEEK_START, dayOf, daysBetween, daysInMonth, idleDaysSince, localToday, roundHalfEven, shiftDay, startOfWeek } from "../db/time";
import { GHOSTED_DAYS, isGhosted, isWaitingStage, needsFollowUp } from "./followUp";
import { loadGoal } from "./goal";
import { applicationPath, buildFlow, loadCohort, type FlowData, type FlowFilter, type StageEvent } from "./stats";

/** A median needs at least this many applications behind it, or the page says there isn't enough yet. */
export const MIN_SAMPLE = 3;
/** The most weeks the pace chart shows (a year). */
export const MAX_WEEKS = 52;
/** The most months the monthly chart shows (two years). */
export const MAX_MONTHS = 24;

/** "Nearest rank" percentile of a list sorted from smallest to largest: always one of the values, never an in-between. */
export function nearestRank(sorted: readonly number[], percent: number): number {
  return sorted[Math.max(1, Math.ceil((percent / 100) * sorted.length)) - 1];
}

export interface Spread {
  /** how many applications have this timing */
  n: number;
  /** whole days. Null (with p25 and p75) when n is under MIN_SAMPLE */
  median: number | null;
  p25: number | null;
  p75: number | null;
}

export function spread(days: readonly number[]): Spread {
  const n = days.length;
  if (n < MIN_SAMPLE) return { n, median: null, p25: null, p75: null };
  const sorted = [...days].sort((a, b) => a - b);
  return { n, median: nearestRank(sorted, 50), p25: nearestRank(sorted, 25), p75: nearestRank(sorted, 75) };
}

export interface Timing {
  /** days from applying to the first sign of any reply */
  reply: number | null;
  interview: number | null;
  /** days to an offer or a rejection, for applications that have one */
  outcome: number | null;
}

/**
 * How long one application took to move, from the day it was applied. A stage dated before the applied day counts as day 0
 * (an application logged late), and an application with no applied day has no timings at all.
 */
export function timingOf(app: Pick<ApplicationRow, "appliedAt" | "stage">, events: readonly StageEvent[], timeZone?: string): Timing {
  const applied = dayOf(app.appliedAt, timeZone);
  const none: Timing = { reply: null, interview: null, outcome: null };
  if (!applied) return none;
  let reply = "";
  let interview = "";
  let outcome = "";
  const earlier = (best: string, day: string) => (!best || day < best ? day : best);
  for (const e of events) {
    const day = dayOf(e.at, timeZone);
    if (!day) continue;
    if (e.stage !== "Applied") reply = earlier(reply, day);
    if (e.stage === "Interview") interview = earlier(interview, day);
    if (TERMINAL.has(e.stage as Stage)) outcome = earlier(outcome, day);
  }
  const since = (day: string) => (day ? Math.max(0, daysBetween(applied, day)) : null);
  return { reply: since(reply), interview: since(interview), outcome: TERMINAL.has(app.stage) ? since(outcome) : null };
}

export interface Speed {
  reply: Spread;
  interview: Spread;
  outcome: Spread;
}

export function speedOf(apps: readonly ApplicationRow[], events: ReadonlyMap<number, readonly StageEvent[]>, timeZone?: string): Speed {
  const reply: number[] = [];
  const interview: number[] = [];
  const outcome: number[] = [];
  for (const a of apps) {
    const t = timingOf(a, events.get(a.id) ?? [], timeZone);
    if (t.reply !== null) reply.push(t.reply);
    if (t.interview !== null) interview.push(t.interview);
    if (t.outcome !== null) outcome.push(t.outcome);
  }
  return { reply: spread(reply), interview: spread(interview), outcome: spread(outcome) };
}

export interface WeekCount {
  /** the first and last day of the week, YYYY-MM-DD */
  start: string;
  end: string;
  count: number;
  /** the week that today is in, which isn't over yet */
  current: boolean;
}

export interface Pace {
  /** oldest first, ending with the current week */
  weeks: WeekCount[];
  /** the weekly goal, or null when there isn't one */
  goal: number | null;
  /** applications a week, to one decimal. Weeks that are over, or the current one alone when it is the only one */
  perWeek: number;
  /** the busiest week (the latest of equals), or null when no week has an application */
  best: WeekCount | null;
  /** how many weeks in a row met the goal, counting back from this week if it already has, otherwise from last week. 0 with no goal */
  streak: number;
}

/**
 * Applications sent per week, from the day each was applied. Every live application in the account counts, whatever the period
 * (the period only sets how many weeks are shown), so the oldest week is never a partial one. `days` 0 means since the first
 * application, at most MAX_WEEKS. Null when no application in those weeks has an applied day.
 */
export function paceOf(
  apps: readonly Pick<ApplicationRow, "appliedAt">[], days: number, goal: number | null, now: Date = new Date(), timeZone?: string, weekStart: number = WEEK_START,
): Pace | null {
  const today = localToday(now, timeZone);
  const thisWeek = startOfWeek(today, weekStart);
  const applied: string[] = [];
  for (const a of apps) {
    const day = dayOf(a.appliedAt, timeZone);
    if (day && day <= today) applied.push(day);
  }
  if (!applied.length) return null;

  const first = startOfWeek(applied.reduce((a, b) => (b < a ? b : a)), weekStart);
  const wanted = days ? Math.ceil(days / 7) : Math.min(MAX_WEEKS, Math.floor(daysBetween(first, thisWeek) / 7) + 1);
  const count = Math.min(wanted, MAX_WEEKS);
  const oldest = shiftDay(thisWeek, -7 * (count - 1));

  const perWeek = new Map<string, number>();
  for (const day of applied) {
    const week = startOfWeek(day, weekStart);
    if (week >= oldest) perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
  }
  const weeks: WeekCount[] = [];
  for (let i = 0; i < count; i++) {
    const start = shiftDay(oldest, 7 * i);
    weeks.push({ start, end: shiftDay(start, 6), count: perWeek.get(start) ?? 0, current: start === thisWeek });
  }
  if (!weeks.some((w) => w.count)) return null;

  const done = weeks.filter((w) => !w.current);
  const basis = done.length ? done : weeks;
  const average = Math.round((basis.reduce((sum, w) => sum + w.count, 0) / basis.length) * 10) / 10;
  let best: WeekCount | null = null;
  for (const w of weeks) if (w.count && (!best || w.count >= best.count)) best = w;
  let streak = 0;
  if (goal !== null) {
    let i = weeks.length - 1;
    if (weeks[i].count < goal) i--;
    while (i >= 0 && weeks[i].count >= goal) {
      streak++;
      i--;
    }
  }
  return { weeks, goal, perWeek: average, best, streak };
}

/** The one line under the pace chart: a streak of goal weeks if there is one, otherwise the best week. Null when neither applies. */
export function paceNote(pace: Pace): string | null {
  if (pace.goal !== null && pace.streak >= 2) return `Goal met ${pace.streak} weeks in a row`;
  return pace.best ? `Best week: ${pace.best.count}` : null;
}

export interface MonthRate {
  /** YYYY-MM, the month the applications were sent */
  month: string;
  applied: number;
  /** how many of them got any reply */
  heardBack: number;
  /** whole percent, or null for a month with no applications */
  pct: number | null;
  /** replies are still arriving: even the last application of the month is under GHOSTED_DAYS old */
  settling: boolean;
}

/**
 * The reply rate by the month an application was sent, oldest first, with the empty months in between. Empty when fewer than two
 * months have applications, since one column says nothing about a trend. Applications with no applied day are left out.
 */
export function monthlyRates(
  apps: readonly ApplicationRow[], events: ReadonlyMap<number, readonly StageEvent[]>, now: Date = new Date(), timeZone?: string,
): MonthRate[] {
  const byMonth = new Map<string, { applied: number; heardBack: number }>();
  for (const a of apps) {
    const day = dayOf(a.appliedAt, timeZone);
    if (!day) continue;
    const month = day.slice(0, 7);
    const row = byMonth.get(month) ?? { applied: 0, heardBack: 0 };
    row.applied++;
    if (applicationPath(a.stage, (events.get(a.id) ?? []).map((e) => e.stage)).includes("Heard back")) row.heardBack++;
    byMonth.set(month, row);
  }
  if (byMonth.size < 2) return [];

  const months = [...byMonth.keys()].sort();
  const today = localToday(now, timeZone);
  const out: MonthRate[] = [];
  let [y, m] = months[0].split("-").map(Number);
  const [lastY, lastM] = months[months.length - 1].split("-").map(Number);
  while (y < lastY || (y === lastY && m <= lastM)) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    const row = byMonth.get(month) ?? { applied: 0, heardBack: 0 };
    const lastDay = `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
    out.push({ month, ...row, pct: row.applied ? roundHalfEven((100 * row.heardBack) / row.applied) : null, settling: daysBetween(lastDay, today) < GHOSTED_DAYS });
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out.slice(-MAX_MONTHS);
}

export interface Waiting {
  /** Applied or Heard back, idle under a week */
  fresh: number;
  /** idle 7 to 29 days: the Needs follow-up filter on the list */
  followUp: number;
  /** idle 30 days or more: the No reply filter on the list */
  ghosted: number;
}

/** What is still waiting on a company right now. Counts every live application in the account, so the numbers match the list's filters. */
export function waitingOf(apps: readonly ApplicationRow[], now: Date = new Date(), timeZone?: string): Waiting {
  const out: Waiting = { fresh: 0, followUp: 0, ghosted: 0 };
  for (const a of apps) {
    if (!isWaitingStage(a.stage)) continue;
    const idle = idleDaysSince(a.lastActivity, now, timeZone);
    if (idle === null) continue;
    if (isGhosted(a.stage, idle)) out.ghosted++;
    else if (needsFollowUp(a.stage, idle)) out.followUp++;
    else out.fresh++;
  }
  return out;
}

export interface Statistics {
  /** the funnel, with the counts the tiles use */
  flow: FlowData;
  speed: Speed;
  pace: Pace | null;
  monthly: MonthRate[];
  waiting: Waiting;
}

export interface StatisticsFilter extends FlowFilter {
  /** an IANA zone name; tests only */
  timeZone?: string;
}

/** Everything the Statistics page shows, from one read of the emails and one of the steps. */
export async function statistics(db: JobTrackerDB, filter: StatisticsFilter = {}): Promise<Statistics> {
  const now = filter.now ?? new Date();
  const tz = filter.timeZone;
  const cohort = await loadCohort(db, { ...filter, now });
  const goal = await loadGoal(db);
  return {
    flow: buildFlow(cohort.apps, cohort.events),
    speed: speedOf(cohort.apps, cohort.events, tz),
    pace: paceOf(cohort.inAccount, filter.days ?? 0, goal, now, tz),
    monthly: monthlyRates(cohort.apps, cohort.events, now, tz),
    waiting: waitingOf(cohort.inAccount, now, tz),
  };
}

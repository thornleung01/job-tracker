// How many interview rounds an application has had. It is an estimate from the emails the app already classified,
// firmed up by the steps you log, and always replaceable by a number you type.
import type { ActivityRow, EmailRow } from "../db/schema";

/** Steps that are an interview round when you log them. A recruiter call, take-home or reference check is not. */
export const ROUND_STEPS: readonly string[] = ["Interview", "Phone screen", "Technical interview", "Final round"];
export const MAX_ROUNDS = 20;

export type RoundsSource = "yours" | "logged" | "estimated";
export interface Rounds {
  count: number;
  source: RoundsSource;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const MONTH_FIRST = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d\\d))?\\b`, "gi");
const DAY_FIRST = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\.?(?:,?\\s+(20\\d\\d))?\\b`, "gi");
const ISO_DAY = /\b(20\d\d)-(\d{2})-(\d{2})\b/g;

/** "Oct", "october" or "Sept" as 1 to 12; 0 for anything else. */
const monthNumber = (name: string): number => MONTHS[name.toLowerCase()] ?? MONTHS[name.toLowerCase().slice(0, 3)] ?? 0;

const DAY_MS = 86_400_000;
const HORIZON_DAYS = 120;
const SCAN = 1500;

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const valid = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/**
 * The first calendar day an email says the interview is on, as YYYY-MM-DD, or null. Only days from the day before the email
 * to about four months after count, so a date in a footer or a quoted old thread isn't taken for the interview.
 */
export function interviewDay(subject: string | null, body: string | null, receivedAt: string): string | null {
  const received = new Date(receivedAt);
  if (Number.isNaN(received.getTime())) return null;
  const text = `${subject ?? ""}\n${(body ?? "").slice(0, SCAN)}`;
  const earliest = received.getTime() - DAY_MS;
  const latest = received.getTime() + HORIZON_DAYS * DAY_MS;
  const found: { pos: number; day: string }[] = [];
  const consider = (index: number, y: number | undefined, m: number, d: number) => {
    for (const year of y ? [y] : [received.getUTCFullYear(), received.getUTCFullYear() + 1]) {
      if (!valid(year, m, d)) continue;
      const at = Date.UTC(year, m - 1, d, 12);
      if (at >= earliest && at <= latest) {
        found.push({ pos: index, day: dayKey(year, m, d) });
        return;
      }
    }
  };
  for (const x of text.matchAll(ISO_DAY)) consider(x.index ?? 0, Number(x[1]), Number(x[2]), Number(x[3]));
  for (const x of text.matchAll(MONTH_FIRST)) consider(x.index ?? 0, x[3] ? Number(x[3]) : undefined, monthNumber(x[1]), Number(x[2]));
  for (const x of text.matchAll(DAY_FIRST)) consider(x.index ?? 0, x[3] ? Number(x[3]) : undefined, monthNumber(x[2]), Number(x[1]));
  found.sort((a, b) => a.pos - b.pos);
  return found[0]?.day ?? null;
}

const ORDINALS: Readonly<Record<string, number>> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };
const ORDINAL_ROUND = /\b(first|second|third|fourth|fifth|sixth|1st|2nd|3rd|4th|5th|6th)\s+(?:round|interview|stage)\b/gi;
const ROUND_NUMBER = /\b(?:round|stage)\s+(\d)\b/gi;
const CANCELLED = /\b(?:cancel(?:l?ed|lation)|no longer (?:going ahead|needed|required))\b/i;

/** The highest "second round", "round 3" or "4th interview" an email names, or 0. */
export function namedRound(subject: string | null, body: string | null): number {
  const text = `${subject ?? ""}\n${(body ?? "").slice(0, SCAN)}`;
  let best = 0;
  for (const x of text.matchAll(ORDINAL_ROUND)) {
    const w = x[1].toLowerCase();
    best = Math.max(best, ORDINALS[w] ?? Number.parseInt(w, 10));
  }
  for (const x of text.matchAll(ROUND_NUMBER)) best = Math.max(best, Number(x[1]));
  return Math.min(best, MAX_ROUNDS);
}

type MailForRounds = Pick<EmailRow, "id" | "threadId" | "receivedAt" | "subject" | "body" | "event">;

/**
 * Rounds from the emails alone. Mail about one meeting (invite, confirmation, reminder, reschedule) shares a thread or a
 * date, so it counts once. The newest email in a thread decides its date and whether it was cancelled. Several sessions on
 * the same day are one round.
 */
export function roundsFromEmails(emails: readonly MailForRounds[]): number {
  const threads = new Map<string, MailForRounds[]>();
  for (const e of emails) {
    if (e.event !== "interview") continue;
    const key = e.threadId ?? `msg:${e.id}`;
    threads.set(key, [...(threads.get(key) ?? []), e]);
  }
  const rounds = new Set<string>();
  let named = 0;
  for (const [thread, mails] of threads) {
    const newestFirst = [...mails].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : b.id - a.id));
    if (CANCELLED.test(newestFirst[0].subject ?? "")) continue;       // a cancelled meeting adds nothing, not even a named round
    for (const m of newestFirst) named = Math.max(named, namedRound(m.subject, m.body));
    let day: string | null = null;
    for (const m of newestFirst) {
      day = interviewDay(m.subject, m.body, m.receivedAt);
      if (day) break;
    }
    rounds.add(day ? `day:${day}` : `thread:${thread}`);
  }
  return Math.max(rounds.size, named);
}

/**
 * The count to show: your own number if you set one, otherwise the larger of what the emails suggest and the interview steps
 * you logged. null when there is nothing to count.
 */
export function deriveRounds(
  emails: readonly MailForRounds[],
  steps: readonly Pick<ActivityRow, "kind" | "label">[],
  yours?: number,
): Rounds | null {
  if (yours !== undefined && Number.isInteger(yours) && yours >= 0) return { count: Math.min(yours, MAX_ROUNDS), source: "yours" };
  const estimate = roundsFromEmails(emails);
  const logged = steps.filter((s) => s.kind === "step" && s.label !== null && ROUND_STEPS.includes(s.label)).length;
  const count = Math.min(Math.max(estimate, logged), MAX_ROUNDS);
  if (count === 0) return null;
  return { count, source: logged >= estimate ? "logged" : "estimated" };
}

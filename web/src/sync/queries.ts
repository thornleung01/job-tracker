// Read-side queries for the pages: the application list, counts, Needs review and the ignored list (jobtracker/web.py).
import type { AccountRow, ApplicationRow, EmailRow, IgnoredMailRow, JobTrackerDB } from "../db/schema";
import { STAGES, STAGE_FOR_EVENT, type Stage } from "../db/stages";
import { idleDaysSince, localToday } from "../db/time";
import * as activity from "./activity";
import * as contacts from "./contacts";
import { needsFollowUp } from "./followUp";
import * as learn from "./learn";
import { pipeline } from "./pipeline";
import { deriveRounds, type Rounds } from "./rounds";
import { byDesc } from "./compare";
import { groupBy } from "./groupBy";
import { roundsLookup } from "./roundsLookup";
import { nextInterviewDay } from "./upcoming";

/** How many companies and roles the search box suggests, and how many ignored emails are listed. */
const SUGGESTION_LIMIT = 300;
const IGNORED_LIST_LIMIT = 50;

export type SortColumn = "company" | "role" | "stage" | "applied" | "lastActivity" | "emails" | "rounds";
export const SORT_COLUMNS: readonly SortColumn[] = ["company", "role", "stage", "applied", "lastActivity", "emails", "rounds"];
export const DEFAULT_DIR: Readonly<Record<SortColumn, "asc" | "desc">> = {
  company: "asc", role: "asc", stage: "asc", applied: "desc", lastActivity: "desc", emails: "desc", rounds: "desc",
};

export interface ListQuery {
  stage?: string;
  /** matches company or role, case-insensitively */
  q?: string;
  account?: number;
  sort?: string;
  dir?: string;
  /** keep only applications that need a follow-up */
  followUp?: boolean;
  now?: Date;
}

export interface ApplicationListRow extends ApplicationRow {
  nEmails: number;
  /** whole calendar days (your time zone) since the last activity, never negative; null when unknown. Follow-ups count these days. */
  idleDays: number | null;
  /** still Applied or Heard back, and quiet for a week or more */
  followUp: boolean;
  /** the next day an interview email says a meeting is on (YYYY-MM-DD, today or later), or null */
  nextInterview: string | null;
  /** interview rounds (yours, or worked out from the emails and steps); null when there is nothing to count */
  rounds: number | null;
}

/** An interview email that belongs to an application. */
type InterviewMail = EmailRow & { applicationId: number };
const isInterviewMail = (e: EmailRow): e is InterviewMail => e.event === "interview" && e.applicationId != null;

/** The row before the interview day and the rounds are worked out: those are only needed for the rows that are shown. */
type EarlyRow = Omit<ApplicationListRow, "nextInterview" | "rounds">;

type Cmp = (a: ApplicationListRow, b: ApplicationListRow) => number;

/** Case-insensitive text order. */
const compareText = (a: string, b: string) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
// Null sorts before everything when ascending (and so last when descending), as in the local edition, where SQLite does it.
const nullable = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1);

export async function listApplications(db: JobTrackerDB, query: ListQuery = {}): Promise<ApplicationListRow[]> {
  const sort: SortColumn = SORT_COLUMNS.includes(query.sort as SortColumn) ? (query.sort as SortColumn) : "lastActivity";
  const dir = query.dir === "asc" || query.dir === "desc" ? query.dir : DEFAULT_DIR[sort];
  const sign = dir === "asc" ? 1 : -1;
  const now = query.now ?? new Date();

  const emails = await db.emails.toArray();
  const counts = new Map<number, number>();
  const inAccount = new Set<number>();
  for (const e of emails) {
    if (e.applicationId == null) continue;
    counts.set(e.applicationId, (counts.get(e.applicationId) ?? 0) + 1);
    if (query.account && e.accountId === query.account) inAccount.add(e.applicationId);
  }
  const interviews = groupBy(emails.filter(isInterviewMail), (e) => e.applicationId);
  const needle = (query.q ?? "").trim().toLowerCase();
  let early: EarlyRow[] = (await db.applications.toArray()).map((a) => {
    const idleDays = idleDaysSince(a.lastActivity, now);
    return { ...a, nEmails: counts.get(a.id) ?? 0, idleDays, followUp: needsFollowUp(a.stage, idleDays) };
  });
  if ((STAGES as readonly string[]).includes(query.stage ?? "")) early = early.filter((a) => a.stage === query.stage);
  if (needle) early = early.filter((a) => a.company.toLowerCase().includes(needle) || a.role.toLowerCase().includes(needle));
  if (query.account) early = early.filter((a) => inAccount.has(a.id));
  if (query.followUp) early = early.filter((a) => a.followUp);

  const today = localToday(now);
  const roundsOf = await roundsLookup(db, interviews);
  const rows: ApplicationListRow[] = early.map((a) => {
    // A rejected application or an offer has no interview worth reminding you of, whatever an old email said.
    const remindsOfInterviews = a.stage !== "Rejected" && a.stage !== "Offer";
    return { ...a, nextInterview: remindsOfInterviews ? nextInterviewDay(interviews.get(a.id) ?? [], today) : null, rounds: roundsOf(a) };
  });

  const by: Record<SortColumn, Cmp> = {
    company: (a, b) => sign * compareText(a.company, b.company),
    role: (a, b) => sign * compareText(a.role, b.role),
    stage: (a, b) => sign * (STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage)),
    // an unknown applied date always goes last
    applied: (a, b) => (a.appliedAt === null || b.appliedAt === null ? (a.appliedAt === null ? 1 : 0) - (b.appliedAt === null ? 1 : 0) : sign * nullable(a.appliedAt, b.appliedAt)),
    lastActivity: (a, b) => sign * nullable(a.lastActivity, b.lastActivity),
    emails: (a, b) => sign * (a.nEmails - b.nEmails),
    // no count always goes last, whichever way you sort
    rounds: (a, b) => (a.rounds === null || b.rounds === null ? (a.rounds === null ? 1 : 0) - (b.rounds === null ? 1 : 0) : sign * (a.rounds - b.rounds)),
  };
  return rows.sort((a, b) => by[sort](a, b) || a.id - b.id);
}

/** How many applications are at each stage. */
export async function stageCounts(db: JobTrackerDB): Promise<Record<Stage, number>> {
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const a of await db.applications.toArray()) counts[a.stage]++;
  return counts;
}

export interface Suggestion {
  kind: "Company" | "Role";
  text: string;
  n: number;
}

/** The companies and roles you actually have, newest activity first, for the search box. */
export async function suggestions(db: JobTrackerDB): Promise<Suggestion[]> {
  const apps = await db.applications.toArray();
  const out: Suggestion[] = [];
  for (const [kind, field] of [["Company", "company"], ["Role", "role"]] as const) {
    const keyField = `${field}Key` as "companyKey" | "roleKey";
    const groups = new Map<string, { text: string; n: number; latest: string }>();
    for (const a of apps) {
      if (!a[keyField]) continue;
      const g = groups.get(a[keyField]);
      const latest = a.lastActivity ?? "";
      if (!g) groups.set(a[keyField], { text: a[field], n: 1, latest });
      else {
        g.n++;
        if (latest > g.latest) g.latest = latest;
      }
    }
    [...groups.values()].sort(byDesc((g) => g.latest)).slice(0, SUGGESTION_LIMIT)
      .forEach((g) => out.push({ kind, text: g.text, n: g.n }));
  }
  return out;
}

export interface ReviewItem extends EmailRow {
  provider: AccountRow["provider"] | null;
  address: string | null;
  guessCompany: string;
  guessRole: string;
  guessStage: Stage;
}

export interface ReviewPage {
  emails: ReviewItem[];
  apps: Pick<ApplicationRow, "id" | "company" | "role">[];
  learned: learn.RuleView[];
  ignored: IgnoredMailRow[];
}

/** Everything the Needs review page shows. */
export async function reviewPage(db: JobTrackerDB, now: Date = new Date()): Promise<ReviewPage> {
  const p = pipeline();
  const accounts = new Map((await db.accounts.toArray()).map((a) => [a.id, a]));
  const waiting = (await db.emails.toArray()).filter((e) => e.needsReview && accounts.has(e.accountId))
    .sort((a, b) => byDesc<EmailRow>((e) => e.receivedAt)(a, b) || b.id - a.id);
  const emails: ReviewItem[] = waiting.map((e) => {
    const [company, role] = p.extractCompanyRole({
      id: e.providerMsgId, threadId: e.threadId ?? "", senderName: "", senderEmail: (e.sender ?? "").split("<").pop()!.replace(/>+$/, ""),
      // receivedAt is not read when guessing a company and role from the text; it is only here to make a whole Message
      subject: e.subject ?? "", receivedAt: now.toISOString(), body: e.body ?? "",
    });
    const account = accounts.get(e.accountId)!;
    return {
      ...e, provider: account.provider, address: account.address, guessCompany: company, guessRole: role,
      guessStage: e.event ? STAGE_FOR_EVENT[e.event] : "Applied",
    };
  });
  const apps = (await db.applications.toArray()).map(({ id, company, role }) => ({ id, company, role }))
    .sort((a, b) => compareText(a.company, b.company));
  const ignored = (await db.ignoredMail.toArray()).sort(byDesc((m) => m.receivedAt)).slice(0, IGNORED_LIST_LIMIT);
  return { emails, apps, learned: await learn.activeRules(db), ignored };
}

export async function reviewCount(db: JobTrackerDB): Promise<number> {
  return (await db.emails.toArray()).filter((e) => e.needsReview).length;
}

export interface ApplicationDetail {
  application: ApplicationRow;
  idleDays: number | null;
  nEmails: number;
  emails: (EmailRow & { provider: string; address: string })[];
  /** your notes and steps (no emails: the detail page lists emails itself) */
  notes: activity.HistoryItem[];
  notesTotal: number;
  others: Pick<ApplicationRow, "id" | "company" | "role">[];
  people: contacts.Contact[];
  /** address -> title for senders on this application's emails */
  titles: Record<string, string>;
  /** interview rounds: yours, or worked out from the emails and logged steps; null when there is nothing to count */
  rounds: Rounds | null;
}

/** The application page. Returns null when there is no such application. */
export async function applicationDetail(db: JobTrackerDB, appId: number, now: Date = new Date()): Promise<ApplicationDetail | null> {
  const application = await db.applications.get(appId);
  if (!application) return null;
  const accounts = new Map((await db.accounts.toArray()).map((a) => [a.id, a]));
  const rows = (await db.emails.where("applicationId").equals(appId).toArray())
    .sort((a, b) => byDesc<EmailRow>((e) => e.receivedAt)(a, b) || b.id - a.id);
  const emails = rows.filter((e) => accounts.has(e.accountId)).map((e) => ({ ...e, provider: accounts.get(e.accountId)!.provider, address: accounts.get(e.accountId)!.address }));
  const { items, total } = await activity.history(db, appId, undefined, false);
  const people = await contacts.derive(db, appId);
  const others = (await db.applications.toArray()).filter((a) => a.id !== appId).map(({ id, company, role }) => ({ id, company, role }))
    .sort((a, b) => compareText(a.company, b.company));
  return {
    application, idleDays: idleDaysSince(application.lastActivity, now), nEmails: rows.length, emails, notes: items, notesTotal: total, others, people,
    titles: contacts.titleByAddress(people),
    rounds: deriveRounds(rows, await db.activity.where("applicationId").equals(appId).toArray(), application.interviewRounds),
  };
}

/** Mailbox cards for Settings: each account with how many emails are stored for it. */
export async function accountSummaries(db: JobTrackerDB): Promise<(AccountRow & { emailCount: number })[]> {
  const counts = new Map<number, number>();
  for (const e of await db.emails.toArray()) counts.set(e.accountId, (counts.get(e.accountId) ?? 0) + 1);
  return (await db.accounts.orderBy("id").toArray()).map((a) => ({ ...a, emailCount: counts.get(a.id) ?? 0 }));
}

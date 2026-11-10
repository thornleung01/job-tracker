// Read-side queries for the pages: the application list, counts, Needs review and the ignored list (jobtracker/web.py).
import type { AccountRow, ApplicationRow, DocumentRow, EmailRow, IgnoredMailRow, JobTrackerDB } from "../db/schema";
import { STAGES, STAGE_FOR_EVENT, type Stage } from "../db/stages";
import { SEARCH_MIN_CHARS } from "../db/limits";
import { sectionsToText } from "../db/documentShape";
import { idleDaysSince, localToday } from "../db/time";
import * as activity from "./activity";
import * as contacts from "./contacts";
import { isGhosted, needsFollowUp, remindsOfInterviews } from "./followUp";
import { liveApplications } from "./live";
import * as learn from "./learn";
import { pipeline } from "./pipeline";
import { deriveRounds, type Rounds } from "./rounds";
import { byDesc } from "./compare";
import { groupBy } from "./groupBy";
import { roundsLookup } from "./roundsLookup";
import { searchApplications, type SearchCover, type SearchMatch } from "./search";
import { isLiveDocument, isTailored, liveTailored } from "./documents";
import { meetingDays } from "./upcoming";

/** How many companies and roles the search box suggests, and how many ignored emails are listed. */
const SUGGESTION_LIMIT = 300;
const IGNORED_LIST_LIMIT = 50;

export type SortColumn = "company" | "role" | "stage" | "applied" | "lastActivity" | "emails" | "rounds" | "resume";
export const SORT_COLUMNS: readonly SortColumn[] = ["company", "role", "stage", "applied", "lastActivity", "emails", "rounds", "resume"];
export const DEFAULT_DIR: Readonly<Record<SortColumn, "asc" | "desc">> = {
  company: "asc", role: "asc", stage: "asc", applied: "desc", lastActivity: "desc", emails: "desc", rounds: "desc", resume: "asc",
};

export interface ListQuery {
  stage?: string;
  /** matches company or role, case-insensitively */
  q?: string;
  account?: number;
  sort?: string;
  dir?: string;
  /** keep only applications that need a follow-up (idle 7 to 29 days) */
  followUp?: boolean;
  /** keep only ghosted applications (idle 30 days or more). With followUp, an application that is either. */
  ghosted?: boolean;
  /** a resume version's id, or "none" for applications with no resume set. An id that isn't a live resume matches nothing. */
  resume?: string;
  now?: Date;
}

/** A list row leaves out the posting text: search reads it while the rows are built, and nothing on the list needs up to 20,000 characters per row. */
export interface ApplicationListRow extends Omit<ApplicationRow, "postingText"> {
  nEmails: number;
  /** whole calendar days (your time zone) since the last activity, never negative; null when unknown. Follow-ups count these days. */
  idleDays: number | null;
  /** still Applied or Heard back, and quiet for 7 to 29 days */
  followUp: boolean;
  /** still Applied or Heard back, and quiet for 30 days or more: shows "No reply" and is not nudged */
  ghosted: boolean;
  /** why a search matched, when it did (see sync/search.ts); absent when there was no search */
  match?: SearchMatch;
  /** a job posting text is saved on the application (the text itself is left out of the row) */
  hasPosting: boolean;
  /** the application has a live tailored resume */
  tailored: boolean;
  /** the next day an interview email says a meeting is on (YYYY-MM-DD, today or later), or null */
  nextInterview: string | null;
  /** every interview day the emails name, past and future (YYYY-MM-DD), earliest first, each once; a cancelled meeting is left out. The calendar shows these. */
  interviewDays: string[];
  /** interview rounds (yours, or worked out from the emails and steps); null when there is nothing to count */
  rounds: number | null;
  /** the title of the resume sent; null when none is set or it was deleted */
  resumeTitle: string | null;
}

/** An interview email that belongs to an application. */
type InterviewMail = EmailRow & { applicationId: number };
const isInterviewMail = (e: EmailRow): e is InterviewMail => e.event === "interview" && e.applicationId != null;

/** The row before the interview day and the rounds are worked out: those are only needed for the rows that are shown. */
type EarlyRow = Omit<ApplicationListRow, "nextInterview" | "interviewDays" | "rounds" | "resumeTitle" | "hasPosting" | "tailored"> & Pick<ApplicationRow, "postingText">;

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
  let early: EarlyRow[] = (await liveApplications(db)).map((a) => {
    const idleDays = idleDaysSince(a.lastActivity, now);
    return { ...a, nEmails: counts.get(a.id) ?? 0, idleDays, followUp: needsFollowUp(a.stage, idleDays), ghosted: isGhosted(a.stage, idleDays) };
  });
  if ((STAGES as readonly string[]).includes(query.stage ?? "")) early = early.filter((a) => a.stage === query.stage);
  // Company and role, and (from 2 characters) the emails already loaded above plus notes and steps; sync/search.ts has the rules.
  // The job posting and the cover letters are read the same way, and only for a search that long.
  const deep = needle.length >= SEARCH_MIN_CHARS;
  const hits = needle
    ? searchApplications(early, emails, deep ? await db.activity.toArray() : [], needle, deep ? await coverLetters(db) : [])
    : null;
  if (hits) early = early.filter((a) => hits.has(a.id));
  if (query.account) early = early.filter((a) => inAccount.has(a.id));
  // The resume versions you haven't deleted: a deleted one is "no resume" here, and a filter on it shows nothing.
  const resumeTitles = new Map<number, string>();
  const tailoredApps = new Set<number>();
  for (const d of await db.documents.where("kind").equals("resume").toArray()) {
    if (!isLiveDocument(d)) continue;
    resumeTitles.set(d.id, d.title);
    if (isTailored(d) && d.applicationId !== null) tailoredApps.add(d.applicationId);
  }
  const wantResume = query.resume === "none" ? "none" : Number(query.resume) > 0 ? Number(query.resume) : null;
  if (wantResume === "none") early = early.filter((a) => a.resumeId === undefined || !resumeTitles.has(a.resumeId));
  else if (wantResume !== null) early = early.filter((a) => a.resumeId === wantResume && resumeTitles.has(wantResume));
  if (query.followUp || query.ghosted) early = early.filter((a) => (query.followUp && a.followUp) || (query.ghosted && a.ghosted));

  const today = localToday(now);
  const roundsOf = await roundsLookup(db, interviews);
  const rows: ApplicationListRow[] = early.map((a) => {
    // A rejected application or an offer has no interview worth reminding you of, whatever an old email said.
    const days = meetingDays(interviews.get(a.id) ?? []);
    const { postingText: _posting, ...rest } = a;
    return {
      ...rest, hasPosting: Boolean(_posting), tailored: tailoredApps.has(a.id), nextInterview: remindsOfInterviews(a.stage) ? days.find((d) => d >= today) ?? null : null, interviewDays: days, rounds: roundsOf(a),
      match: hits?.get(a.id), resumeTitle: a.resumeId === undefined ? null : resumeTitles.get(a.resumeId) ?? null,
    };
  });

  const by: Record<SortColumn, Cmp> = {
    company: (a, b) => sign * compareText(a.company, b.company),
    role: (a, b) => sign * compareText(a.role, b.role),
    stage: (a, b) => sign * (STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage)),
    // an unknown applied date always goes last
    applied: (a, b) => (a.appliedAt === null || b.appliedAt === null ? (a.appliedAt === null ? 1 : 0) - (b.appliedAt === null ? 1 : 0) : sign * nullable(a.appliedAt, b.appliedAt)),
    lastActivity: (a, b) => sign * nullable(a.lastActivity, b.lastActivity),
    emails: (a, b) => sign * (a.nEmails - b.nEmails),
    // no resume always goes last, whichever way you sort
    resume: (a, b) => (a.resumeTitle === null || b.resumeTitle === null ? (a.resumeTitle === null ? 1 : 0) - (b.resumeTitle === null ? 1 : 0) : sign * compareText(a.resumeTitle, b.resumeTitle)),
    // no count always goes last, whichever way you sort
    rounds: (a, b) => (a.rounds === null || b.rounds === null ? (a.rounds === null ? 1 : 0) - (b.rounds === null ? 1 : 0) : sign * (a.rounds - b.rounds)),
  };
  return rows.sort((a, b) => by[sort](a, b) || a.id - b.id);
}

/** The text of each live cover letter, for search. */
async function coverLetters(db: JobTrackerDB): Promise<SearchCover[]> {
  const out: SearchCover[] = [];
  for (const d of await db.documents.where("kind").equals("cover").toArray()) {
    if (isLiveDocument(d) && d.applicationId !== null) out.push({ applicationId: d.applicationId, text: sectionsToText(d.sections) });
  }
  return out;
}

/** How many applications are at each stage. */
export async function stageCounts(db: JobTrackerDB): Promise<Record<Stage, number>> {
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const a of await liveApplications(db)) counts[a.stage]++;
  return counts;
}

export interface Suggestion {
  kind: "Company" | "Role" | "Person" | "Title";
  text: string;
  n: number;
  /** what to show beside the text instead of the application count, such as "3 people" or a person's company */
  note?: string;
}

/** The companies and roles you actually have, newest activity first, for the search box. */
export async function suggestions(db: JobTrackerDB): Promise<Suggestion[]> {
  const apps = await liveApplications(db);
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
  const apps = (await liveApplications(db)).map(({ id, company, role }) => ({ id, company, role }))
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
  if (!application || application.deletedAt) return null;   // a deleted application is only in Recently deleted: see deletedApplication in trash.ts
  const accounts = new Map((await db.accounts.toArray()).map((a) => [a.id, a]));
  const rows = (await db.emails.where("applicationId").equals(appId).toArray())
    .sort((a, b) => byDesc<EmailRow>((e) => e.receivedAt)(a, b) || b.id - a.id);
  const emails = rows.filter((e) => accounts.has(e.accountId)).map((e) => ({ ...e, provider: accounts.get(e.accountId)!.provider, address: accounts.get(e.accountId)!.address }));
  const { items, total } = await activity.history(db, appId, undefined, false);
  const people = await contacts.derive(db, appId);
  const others = (await liveApplications(db)).filter((a) => a.id !== appId).map(({ id, company, role }) => ({ id, company, role }))
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

/** The live tailored resumes of live applications, newest first, each with its application's name: the Resume page's Tailored tab. */
export async function tailoredPage(db: JobTrackerDB): Promise<{ doc: DocumentRow; app: { id: number; company: string; role: string } | null }[]> {
  const apps = new Map((await liveApplications(db)).map((a) => [a.id, a]));
  return (await liveTailored(db))
    .filter((d) => d.applicationId !== null && apps.has(d.applicationId))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : b.id - a.id))
    .map((doc) => {
      const a = apps.get(doc.applicationId!)!;
      return { doc, app: { id: a.id, company: a.company, role: a.role } };
    });
}

// IndexedDB schema (Dexie), the equivalent of SCHEMA in jobtracker/db.py. One database per signed-in user.
import Dexie, { type Table } from "dexie";
import type { ProviderName } from "../types";
import type { Confidence, EventName, Stage } from "./stages";

/** What a table accepts on insert: the id is assigned by the database unless an import supplies one. */
export type Insert<T extends { id: number }> = Omit<T, "id"> & { id?: number };

export interface AccountRow {
  id: number;
  provider: ProviderName;
  address: string;
  lastSync: string | null;
  lastError: string | null;
  active: boolean;
}

export interface ApplicationRow {
  id: number;
  company: string;
  companyKey: string;
  role: string;
  roleKey: string;
  stage: Stage;
  stageAt: string | null;
  appliedAt: string | null;
  lastActivity: string | null;
  /** you set the stage by hand, so mail no longer moves it */
  locked: boolean;
  /** you made or edited this application, so rechecks never rewrite it */
  manual: boolean;
  /** the job posting's web address; absent when there is none. Not indexed. */
  postingUrl?: string;
  /** the number of interview rounds you typed; absent means "work it out from the emails and steps". Not indexed. */
  interviewRounds?: number;
  /** what the offer pays, free text of at most 60 characters; absent when none. Not indexed. */
  offerSalary?: string;
  /** the day you have to decide by, YYYY-MM-DD (a past day is allowed); absent when none. Not indexed. */
  offerDeadline?: string;
  /**
   * When you deleted it (ISO). A deleted application stays in "Recently deleted" with its emails and notes for 30 days, hidden
   * everywhere else; absent means it is live. Not indexed (nothing looks rows up by it, and the table is small), so it needs no
   * new Dexie version: older rows simply have no field. See sync/trash.ts.
   */
  deletedAt?: string;
  /** the job posting's text, at most MAX_POSTING_CHARS; absent when none. Not indexed. */
  postingText?: string;
  /** the resume version you sent (a documents row of kind "resume"); absent when none or when that version was erased. Not indexed. */
  resumeId?: number;
}

export interface EmailRow {
  id: number;
  accountId: number;
  providerMsgId: string;
  threadId: string | null;
  receivedAt: string;
  /** "Name <address>"; null once the content is erased */
  sender: string | null;
  subject: string | null;
  body: string | null;
  related: boolean;
  event: EventName | null;
  confidence: Confidence | null;
  applicationId: number | null;
  needsReview: boolean;
  webLink: string | null;
  bulk: boolean;
  /** kept in Needs review until you place it yourself */
  hold: boolean;
  reason: string | null;
}

export interface ActivityRow {
  id: number;
  applicationId: number;
  kind: "note" | "step";
  label: string | null;
  body: string;
  /** when it happened */
  occurredAt: string;
  /** when you typed it */
  createdAt: string;
}

export interface FeedbackRow {
  id: number;
  createdAt: string;
  verdict: "not_job" | "job";
  senderEmail: string;
  senderDomain: string;
  subject: string;
  reason: string;
  applicationId: number | null;
}

export interface IgnoredMailRow {
  id: number;
  accountId: number;
  providerMsgId: string;
  threadId: string | null;
  receivedAt: string;
  sender: string;
  subject: string;
  body: string;
  webLink: string | null;
  reason: string;
  createdAt: string;
  bulk: boolean;
}

export const RULE_KINDS = ["block_sender", "block_domain", "allow_sender", "distrust_pattern"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export const isRuleKind = (value: unknown): value is RuleKind => typeof value === "string" && (RULE_KINDS as readonly string[]).includes(value);

export interface LearnedRuleRow {
  id: number;
  kind: RuleKind;
  value: string;
  evidence: number;
  active: boolean;
  createdAt: string;
}

export interface ContactEditRow {
  /** "<applicationId>|<address>" or "<applicationId>|name:<normalised name>" */
  key: string;
  name: string | null;
  title: string | null;
  hidden: boolean;
}

/** What a resume line is, so it can be laid out the way a resume is: a job, its title, a bullet, a skill, a school. A line with no kind is plain text. */
export const DOC_ITEM_KINDS = ["org", "title", "bullet", "skill", "school"] as const;
export type DocItemKind = (typeof DOC_ITEM_KINDS)[number];
export const isDocItemKind = (value: unknown): value is DocItemKind => typeof value === "string" && (DOC_ITEM_KINDS as readonly string[]).includes(value);

/**
 * One line of a resume or paragraph of a cover letter. The id is stable, so a tailored line can be traced to the line it came from.
 * `kind`, `label` and `right` are optional and additive: they need no new database or export version, and a line without them is plain text.
 * A label belongs only on a bullet or skill and `right` only on an org, school or title: normalizeSections drops them elsewhere.
 */
export interface DocItem {
  id: string;
  /** the line: an organization, a job title, a bullet's body, a skill's values, a school, or plain text */
  text: string;
  kind?: DocItemKind;
  /** the bold lead-in of a bullet ("Reporting & Automation") or a skill ("Analytics"); only those kinds keep one */
  label?: string;
  /** shown on the right: the location of an org or school, the dates of a title; only those kinds keep one */
  right?: string;
}

export interface DocSection {
  id: string;
  /** "Experience", "Skills"... Empty for a cover letter. */
  heading: string;
  items: DocItem[];
}

/**
 * A resume or a cover letter. Resume versions are standalone and reusable: any number of applications can point at one
 * (ApplicationRow.resumeId), and `master` marks the one you copy from. A cover letter belongs to one application.
 */
export interface DocumentRow {
  id: number;
  kind: "resume" | "cover";
  /** the resume you copy versions from; at most one, and never a cover letter */
  master: boolean;
  /** the application a cover letter was written for; null for a resume */
  applicationId: number | null;
  title: string;
  sections: DocSection[];
  /** the document it was copied or tailored from */
  basedOn?: number;
  /** how it was made: "upload" (read from a file), "paste" (pasted text), "copy" (a version made from another resume), "ai" (Convert with your own key, and tailoring will use it too), "template" (typed into the blank template) */
  source?: "upload" | "paste" | "copy" | "ai" | "template";
  createdAt: string;
  updatedAt: string;
  /** when you deleted it (ISO): it stays in Recently deleted for 30 days, hidden everywhere else. Not indexed. */
  deletedAt?: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export class JobTrackerDB extends Dexie {
  accounts!: Table<AccountRow, number, Insert<AccountRow>>;
  applications!: Table<ApplicationRow, number, Insert<ApplicationRow>>;
  emails!: Table<EmailRow, number, Insert<EmailRow>>;
  activity!: Table<ActivityRow, number, Insert<ActivityRow>>;
  feedback!: Table<FeedbackRow, number, Insert<FeedbackRow>>;
  ignoredMail!: Table<IgnoredMailRow, number, Insert<IgnoredMailRow>>;
  learnedRules!: Table<LearnedRuleRow, number, Insert<LearnedRuleRow>>;
  contactEdits!: Table<ContactEditRow, string>;
  documents!: Table<DocumentRow, number, Insert<DocumentRow>>;
  settings!: Table<SettingRow, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      accounts: "++id, &[provider+address]",
      applications: "++id, companyKey, stage, lastActivity",
      emails: "++id, &[accountId+providerMsgId], [accountId+threadId], applicationId, receivedAt",
      activity: "++id, applicationId",
      feedback: "++id, applicationId",
      ignoredMail: "++id, &[accountId+providerMsgId], createdAt",
      learnedRules: "++id, &[kind+value]",
      contactEdits: "key",
      settings: "key",
    });
    // v2: applications may carry a postingUrl. It is not indexed, so the stores stay as they are; existing rows simply have no field.
    this.version(2).stores({}).upgrade((trans) =>
      trans.table("applications").toCollection().modify((a: { postingUrl?: unknown }) => {
        if (typeof a.postingUrl !== "string" || !a.postingUrl) delete a.postingUrl;
      }),
    );
    // v3: resumes and cover letters.
    this.version(3).stores({ documents: "++id, kind, applicationId" });
  }
}

export function openDatabase(name: string): JobTrackerDB {
  return new JobTrackerDB(name);
}

/** Deletes the whole database ("delete all my data"). Close any open handle first. */
export async function deleteDatabase(name: string): Promise<void> {
  await Dexie.delete(name);
}

/** Runs `fn` as one read-write transaction over every table, like `with conn:` in the Python code. */
export function tx<T>(db: JobTrackerDB, fn: () => Promise<T>): Promise<T> {
  return db.transaction("rw", db.tables, fn);
}

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

export type RuleKind = "block_sender" | "block_domain" | "allow_sender" | "distrust_pattern";

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
  }
}

/** The per-user database name the auth module uses. */
export function userDbName(iss: string, sub: string): string {
  return `jobtracker:${iss}:${sub}`;
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

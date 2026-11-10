// The export file: a versioned JSON envelope around every table the hosted edition keeps.
import type {
  AccountRow, ActivityRow, ApplicationRow, ContactEditRow, DocumentRow, EmailRow, FeedbackRow, IgnoredMailRow, LearnedRuleRow,
} from "../db/schema";

export const EXPORT_FORMAT = "jobtracker-export";
/**
 * 2 added the posting link on applications.
 * Version 1 files are still read.
 * Applications may also carry `interviewRounds`, an optional number you typed: it is additive, so it needed no new version.
 * The same goes for `offerSalary` (text, at most 60 characters) and `offerDeadline` (YYYY-MM-DD): optional, and dropped on import when they are not valid.
 * Likewise `deletedAt` (an ISO time): an application with it is in Recently deleted, and a value that is not a time is dropped.
 * 3 added `documents` (resumes and cover letters) and, on applications, `postingText` and `resumeId`.
 * Older files are still read: a file without `documents` has none.
 * A resume line may also carry `kind`, `label` and `right` (see DocItem): additive, so they needed no new version, and a kind that isn't known is dropped.
 * A resume's `source` may also be "template" (typed into the blank template): additive too, and a source that isn't known is dropped.
 * A resume that is not the master may also carry an `applicationId`: it is that application's tailored resume (at most one live per application). Additive, so no new version.
 */
export const EXPORT_VERSION = 3;

export interface ExportData {
  accounts: AccountRow[];
  applications: ApplicationRow[];
  emails: EmailRow[];
  activity: ActivityRow[];
  feedback: FeedbackRow[];
  ignoredMail: IgnoredMailRow[];
  learnedRules: LearnedRuleRow[];
  contactEdits: ContactEditRow[];
  documents: DocumentRow[];
  /** the saved sections, e.g. { appearance: {...}, sync: {...} } */
  settings: Record<string, unknown>;
}

export interface ExportEnvelope {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  /** "web" for this app; "python" for a file converted from the local edition */
  source: "web" | "python";
  data: ExportData;
}

/** The file written by scripts/export_json.py: column names and 0/1 flags exactly as SQLite has them. */
export const PYTHON_FORMAT = "jobtracker-python-export";
export const PYTHON_VERSION = 1;

export class ImportError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    const shown = problems.slice(0, 5).join(" ");
    super(`This file can't be imported. ${shown}${problems.length > 5 ? ` (and ${problems.length - 5} more problems)` : ""}`);
    this.name = "ImportError";
    this.problems = problems;
  }
}

export interface ImportSummary {
  accounts: number;
  applications: number;
  emails: number;
  activity: number;
  feedback: number;
  ignoredMail: number;
  learnedRules: number;
  contactEdits: number;
  documents: number;
}

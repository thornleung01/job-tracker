// The logic behind the Settings buttons, kept out of the component so it can be tested with fakes.
import type { JobTrackerDB } from "../../db/schema";
import { localToday } from "../../db/time";
import { importAll, importFromPythonExport, ImportError, MAX_IMPORT_BYTES, PYTHON_FORMAT, type ImportSummary } from "../../portability";
import { isCleanReport, reportProblems } from "../../components/syncprogress/result";
import type { SyncReport } from "../../sync/mailbox";
import { plural } from "../../sync/text";

// The mailbox pieces live in sync/mailbox.ts, where the sync banner uses them too. These re-exports keep this page's
// imports (and its tests) short.
export { PROVIDER_LABEL, accountLabel } from "../../sync/accountLabel";
export {
  connectMailbox, connectedAddress, forgetConnections, isConnected, registerMailbox, runSync,
  type MailDeps, type RegisterResult, type SyncDeps, type SyncOptions, type SyncReport,
} from "../../sync/mailbox";

/** Plain sentences for the result notice. */
export function describeSync(report: SyncReport): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  const added = report.synced.reduce((n, s) => n + (s.counts["applied-to-application"] ?? 0), 0);
  const review = report.synced.reduce((n, s) => n + (s.counts.review ?? 0), 0);
  if (report.synced.length > 0) {
    lines.push(`Synced ${plural(report.synced.length, "account")}. ${added} added to applications, ${review} ${review === 1 ? "needs" : "need"} review.`);
  }
  lines.push(...reportProblems(report));
  if (lines.length === 0) lines.push("There are no accounts to sync.");
  return { ok: isCleanReport(report), lines };
}

// -- import ------------------------------------------------------------------------------------

export type ImportKind = "web" | "python";

/** Reads a chosen file as text. Throws ImportError, before reading anything, when the file is too big to be a Job Tracker export. */
export function readFileText(file: Blob): Promise<string> {
  if (file.size > MAX_IMPORT_BYTES) throw new ImportError([`The file is larger than ${MAX_IMPORT_BYTES / (1024 * 1024)} MB, which is too big to be a Job Tracker export. Choose a file exported from Job Tracker.`]);
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export interface ParsedImport {
  kind: ImportKind;
  data: unknown;
}

/** Reads a chosen file. Throws ImportError when it is not JSON; deeper checks happen when importing. */
export function parseImportText(text: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError(["The file isn't valid JSON. Choose a file exported from Job Tracker."]);
  }
  const kind: ImportKind = (data as { format?: unknown } | null)?.format === PYTHON_FORMAT ? "python" : "web";
  return { kind, data };
}

export function runImport(db: JobTrackerDB, parsed: ParsedImport): Promise<ImportSummary> {
  return parsed.kind === "python" ? importFromPythonExport(db, parsed.data) : importAll(db, parsed.data);
}

export function describeImport(s: ImportSummary): string {
  return `Imported ${plural(s.applications, "application")} and ${plural(s.emails, "email")}.`;
}

export function downloadText(filename: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Dated with your own day, like the CSV file name. */
export const exportFilename = (now: Date = new Date()) => `job-tracker-${localToday(now)}.json`;

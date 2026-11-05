// Export, import and "delete all my data" for the user's database.
import { tx, type JobTrackerDB } from "../db/schema";
import { iso } from "../db/time";
import {
  EXPORT_FORMAT, EXPORT_VERSION, ImportError, TABLE_NAMES, type ExportData, type ExportEnvelope, type ImportSummary,
} from "./format";
import { convertPythonExport } from "./python";
import { parseEnvelope } from "./validate";

export * from "./format";
export { convertPythonExport } from "./python";
export { parseEnvelope, parseExportData } from "./validate";

/** Everything in the database as one versioned JSON-ready object. */
export async function exportAll(db: JobTrackerDB, now: Date = new Date()): Promise<ExportEnvelope> {
  return db.transaction("r", db.tables, async () => {
    const settings: Record<string, unknown> = {};
    for (const row of await db.settings.toArray()) settings[row.key] = row.value;
    const byId = <T extends { id: number }>(rows: T[]) => rows.sort((a, b) => a.id - b.id);
    const data: ExportData = {
      accounts: byId(await db.accounts.toArray()),
      applications: byId(await db.applications.toArray()),
      emails: byId(await db.emails.toArray()),
      activity: byId(await db.activity.toArray()),
      feedback: byId(await db.feedback.toArray()),
      ignoredMail: byId(await db.ignoredMail.toArray()),
      learnedRules: byId(await db.learnedRules.toArray()),
      contactEdits: (await db.contactEdits.toArray()).sort((a, b) => (a.key < b.key ? -1 : 1)),
      settings,
    };
    return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: iso(now), source: "web" as const, data };
  });
}

/** The export as text, ready to save as a file. */
export async function exportAllAsJson(db: JobTrackerDB, now: Date = new Date()): Promise<string> {
  return JSON.stringify(await exportAll(db, now), null, 2);
}

function summary(data: ExportData): ImportSummary {
  return Object.fromEntries(TABLE_NAMES.map((t) => [t, data[t].length])) as unknown as ImportSummary;
}

async function replaceWith(db: JobTrackerDB, data: ExportData): Promise<ImportSummary> {
  await tx(db, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.accounts.bulkAdd(data.accounts);
    await db.applications.bulkAdd(data.applications);
    await db.emails.bulkAdd(data.emails);
    await db.activity.bulkAdd(data.activity);
    await db.feedback.bulkAdd(data.feedback);
    await db.ignoredMail.bulkAdd(data.ignoredMail);
    await db.learnedRules.bulkAdd(data.learnedRules);
    await db.contactEdits.bulkAdd(data.contactEdits);
    await db.settings.bulkPut(Object.entries(data.settings).map(([key, value]) => ({ key, value })));
  });
  return summary(data);
}

/**
 * Replaces everything in the database with the contents of an export. The file is fully checked first: if anything is
 * wrong an ImportError is thrown and nothing is changed. `input` is the parsed JSON (or its text).
 */
export async function importAll(db: JobTrackerDB, input: unknown): Promise<ImportSummary> {
  const { data } = parseEnvelope(parseJson(input));
  return replaceWith(db, data);
}

/** The same, for the file made from the local edition's database by scripts/export_json.py. */
export async function importFromPythonExport(db: JobTrackerDB, input: unknown): Promise<ImportSummary> {
  const { data } = parseEnvelope(convertPythonExport(parseJson(input)));
  return replaceWith(db, data);
}

function parseJson(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    throw new ImportError(["The file isn't valid JSON. Choose a file exported from Job Tracker."]);
  }
}

/** Empties every table ("delete all my data"). To remove the database itself use deleteDatabase from db/schema. */
export async function clearAll(db: JobTrackerDB): Promise<void> {
  await tx(db, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
}

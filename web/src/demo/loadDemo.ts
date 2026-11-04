// "Load demo data": replaces what is in this browser with a bundled, seeded demo set (no real people or mail).
// The JSON is loaded on demand so it stays out of the main bundle.
import type { JobTrackerDB } from "../db/schema";
import { importFromPythonExport, type ImportSummary } from "../portability";
import { loadSettings, saveSettings } from "../sync/settings";

const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

/** Moves every timestamp by `ms`, so the newest one lands on today and the Flow period filters still show it. */
function shiftTimestamps(value: unknown, ms: number): unknown {
  if (typeof value === "string") return ISO_UTC.test(value) ? new Date(Date.parse(value) + ms).toISOString().replace(/\.\d{3}Z$/, "Z") : value;
  if (Array.isArray(value)) return value.map((v) => shiftTimestamps(v, ms));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftTimestamps(v, ms)]));
  }
  return value;
}

function newestTimestamp(value: unknown): number {
  if (typeof value === "string") return ISO_UTC.test(value) ? Date.parse(value) : -Infinity;
  if (Array.isArray(value)) return value.reduce<number>((m, v) => Math.max(m, newestTimestamp(v)), -Infinity);
  if (value && typeof value === "object") return Object.values(value).reduce<number>((m, v) => Math.max(m, newestTimestamp(v)), -Infinity);
  return -Infinity;
}

/** True when the database holds any applications or emails, so loading demo data would replace something. */
export async function hasData(db: JobTrackerDB): Promise<boolean> {
  return (await db.applications.count()) > 0 || (await db.emails.count()) > 0;
}

/** Replaces everything with the demo set. Your own look (theme, accent and so on) is kept. */
export async function loadDemoData(db: JobTrackerDB, now: Date = new Date()): Promise<ImportSummary> {
  const demo = (await import("./demo-export.json")).default as { tables: unknown };
  const newest = newestTimestamp(demo.tables);
  const shifted = { ...demo, tables: shiftTimestamps(demo.tables, Number.isFinite(newest) ? now.getTime() - newest : 0) };
  const before = await loadSettings(db);
  const summary = await importFromPythonExport(db, shifted);
  await saveSettings(db, "appearance", { ...before.appearance });
  return summary;
}

// "Load demo data": replaces what is in this browser with a bundled, seeded demo set (no real people or mail).
// The JSON is loaded on demand so it stays out of the main bundle.
import type { JobTrackerDB } from "../db/schema";
import { iso, localToday, shiftDay } from "../db/time";
import { importFromPythonExport, type ImportSummary } from "../portability";
import { createVersion, saveCoverLetter, saveMaster } from "../sync/documents";
import { loadSettings, saveSettings } from "../sync/settings";

const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

/** Moves every timestamp by `ms`, so the newest one lands on today and the Statistics period filters still show it. */
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

/** How many days from today the demo's interviews fall, so the calendar and Coming up have something to show. */
const DEMO_INTERVIEW_OFFSETS = [2, 6, 11];

/** Gives the first few Interview-stage demo applications an invitation naming a day this week or next. Plainly marked as demo. */
async function addDemoInterviews(db: JobTrackerDB, now: Date): Promise<void> {
  const account = await db.accounts.toCollection().first();
  if (!account?.id) return;
  const apps = (await db.applications.where("stage").equals("Interview").toArray()).slice(0, DEMO_INTERVIEW_OFFSETS.length);
  const received = iso(new Date(now.getTime() - 3_600_000));
  await db.emails.bulkAdd(apps.map((a, i) => ({
    accountId: account.id!, providerMsgId: `demo-interview-${i}`, threadId: `demo-interview-${i}`, receivedAt: received,
    sender: `Demo recruiter <recruiter@${a.companyKey.replace(/\W/g, "") || "demo"}.example>`, subject: "Interview invitation (demo)",
    body: `Demo email. We will meet on ${shiftDay(localToday(now), DEMO_INTERVIEW_OFFSETS[i])} at 10:00.`,
    related: true, event: "interview" as const, confidence: "high" as const, applicationId: a.id!, needsReview: false, webLink: null, bulk: false, hold: false, reason: null,
  })));
}

const DAY_MS = 86_400_000;
const lines = (...texts: string[]) => texts.map((text) => ({ text }));

/** The demo master resume: a made-up analyst's, in four sections. */
const DEMO_RESUME = [
  { heading: "Summary", items: lines("Analyst with 5 years of experience turning messy data into decisions for finance and product teams.") },
  {
    heading: "Experience",
    items: lines(
      "Senior Analyst, Northfield Bank (2022 to now)",
      "Built a weekly reporting model that cut month-end close time by 2 days.",
      "Led a dashboard rollout used by 40 people across 3 teams.",
      "Ran A/B tests on the onboarding flow and shared the results with product.",
      "Analyst, Harbour Retail (2019 to 2022)",
      "Wrote SQL pipelines that replaced 12 hours of manual spreadsheet work each week.",
    ),
  },
  { heading: "Skills", items: lines("SQL, Python, Tableau, Excel", "Experiment design, forecasting, stakeholder reporting") },
  { heading: "Education", items: lines("B.Com in Economics, Demo University (2019)") },
];

/** Each version is the master with the line that fits its kind of role moved to the top of Experience. The roles it was sent for follow the role's name. */
const DEMO_VERSIONS = [
  { title: "Resume for data roles", roles: /data/i, first: "Wrote SQL pipelines that replaced 12 hours of manual spreadsheet work each week." },
  { title: "Resume for product roles", roles: /product|business/i, first: "Ran A/B tests on the onboarding flow and shared the results with product." },
];

/**
 * A demo master resume, two versions of it, and every application whose role fits a version pointing at that version, so the
 * Resume page, the list filter and the Resume column have something to show. The first Interview-stage application gets a cover letter.
 * Nothing here is random: the same demo gives the same documents.
 */
async function addDemoDocuments(db: JobTrackerDB, now: Date): Promise<void> {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const masterId = await saveMaster(db, DEMO_RESUME, "paste", ago(45));
  const apps = (await db.applications.toArray()).sort((a, b) => a.id - b.id);
  const taken = new Set<number>();
  for (const [i, v] of DEMO_VERSIONS.entries()) {
    const sections = DEMO_RESUME.map((s) =>
      s.heading === "Experience" ? { ...s, items: [...s.items.filter((x) => x.text === v.first), ...s.items.filter((x) => x.text !== v.first)] } : s,
    );
    const id = await createVersion(db, { title: v.title, sections, basedOn: masterId, source: "copy" }, ago(30 - i * 10));
    for (const a of apps.filter((x) => !taken.has(x.id) && v.roles.test(x.role))) {
      taken.add(a.id);
      await db.applications.update(a.id, { resumeId: id });
    }
  }
  const interview = apps.find((a) => a.stage === "Interview");
  if (!interview) return;
  await saveCoverLetter(db, interview.id, [{
    heading: "",
    items: lines(
      `Dear hiring team at ${interview.company},`,
      `I'm applying for the ${interview.role} role. For 5 years I've turned messy data into decisions that finance and product teams act on.`,
      "At Northfield Bank I built the weekly reporting model that cut month-end close by 2 days, and led a dashboard rollout used by 40 people.",
      "I'd enjoy bringing that to your team and would welcome a conversation.",
    ),
  }], "paste", ago(2));
}

/** Replaces everything with the demo set. Your own look (theme, accent and so on) is kept. */
export async function loadDemoData(db: JobTrackerDB, now: Date = new Date()): Promise<ImportSummary> {
  const demo = (await import("./demo-export.json")).default as { tables: unknown };
  const newest = newestTimestamp(demo.tables);
  const shifted = { ...demo, tables: shiftTimestamps(demo.tables, Number.isFinite(newest) ? now.getTime() - newest : 0) };
  const before = await loadSettings(db);
  const summary = await importFromPythonExport(db, shifted);
  await saveSettings(db, "appearance", { ...before.appearance });
  await addDemoInterviews(db, now);
  await addDemoDocuments(db, now);
  return summary;
}

// Notes and dated steps you add to an application, shown alongside its emails (jobtracker/activity.py).
import { BODY_LIMIT } from "../types";
import { tx, type JobTrackerDB } from "../db/schema";
import { STAGES, type Stage } from "../db/stages";
import { isDayString, iso, localToday } from "../db/time";
import { mailboxLink, replyLink, type MailLink } from "./links";
import { cpLength, squeeze } from "./text";

export const NOTE_MAX = 2000;
/** What you can log as a step. The six stages move the application; the others are history only. */
export const STEP_PRESETS: readonly string[] = [
  "Recruiter call", "Phone screen", "Take-home assignment", "Technical interview", "Final round",
  "Reference check", "Follow-up sent", "Offer negotiation", "Withdrew application",
];
export const STEP_GROUPS: readonly { label: string; steps: readonly string[] }[] = [
  { label: "Moves the application to a stage", steps: STAGES },
  { label: "Other steps", steps: STEP_PRESETS },
];
const ALLOWED_STEPS = new Map<string, string>([...STAGES, ...STEP_PRESETS].map((s) => [s.toLowerCase(), s]));

/** A user-facing validation problem, safe to show in the page. */
export class ActivityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivityError";
  }
}

/** The application (or email, or rule) does not exist. Not named NotFoundError: Dexie wraps errors with that name. */
export class MissingRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingRecordError";
  }
}

async function requireApplication(db: JobTrackerDB, appId: number) {
  const app = await db.applications.get(appId);
  if (!app) throw new MissingRecordError(`No application ${appId}`);
  return app;
}

async function touch(db: JobTrackerDB, appId: number, when: string): Promise<void> {
  const app = await db.applications.get(appId);
  if (app && when > (app.lastActivity ?? "")) await db.applications.update(appId, { lastActivity: when });
}

/** Timestamp for a chosen day. Today means right now; earlier days count as midday UTC. */
function whenFor(day: string | null | undefined, now: Date): string {
  if (!day || !day.trim()) return iso(now);
  const chosen = day.trim();
  if (!isDayString(chosen)) throw new ActivityError("Enter the date as year-month-day, for example 2026-10-21.");
  const today = localToday(now);
  if (chosen > today) throw new ActivityError("The date can't be in the future.");
  if (chosen === today) return iso(now);
  return `${chosen}T12:00:00Z`;
}

export async function addNote(db: JobTrackerDB, appId: number, body: string | null | undefined, now: Date = new Date()): Promise<void> {
  const text = (body ?? "").trim();
  if (!text) throw new ActivityError("Write a note first.");
  if (cpLength(text) > NOTE_MAX) throw new ActivityError(`Notes can be up to ${NOTE_MAX} characters. This one is ${cpLength(text)}.`);
  await tx(db, async () => {
    await requireApplication(db, appId);
    const stamp = iso(now);
    await db.activity.add({ applicationId: appId, kind: "note", label: null, body: text, occurredAt: stamp, createdAt: stamp });
    await touch(db, appId, stamp);
  });
}

/**
 * Logs a step from the preset list. If it is one of the stages, the application moves to it (when the date isn't older
 * than the current stage). Returns true if the stage changed.
 */
export async function addStep(
  db: JobTrackerDB, appId: number, label: string | null | undefined, day?: string | null, body = "", now: Date = new Date(),
): Promise<boolean> {
  const step = ALLOWED_STEPS.get(squeeze(label).toLowerCase());
  const text = (body ?? "").trim();
  if (!step) throw new ActivityError("Choose a step from the list.");
  if (cpLength(text) > NOTE_MAX) throw new ActivityError(`Notes can be up to ${NOTE_MAX} characters.`);
  const when = whenFor(day, now);
  const stage: Stage | null = (STAGES as readonly string[]).includes(step) ? (step as Stage) : null;
  const created = iso(now);

  return tx(db, async () => {
    const app = await requireApplication(db, appId);
    await db.activity.add({ applicationId: appId, kind: "step", label: step, body: text, occurredAt: when, createdAt: created });
    await touch(db, appId, when);
    if (!stage) return false;
    if (stage === "Applied" && (!app.appliedAt || when < app.appliedAt)) await db.applications.update(appId, { appliedAt: when });
    // Your own entry can move a stage in either direction, but an older date is history only.
    // It never locks the application, so later emails can still move it forward.
    if (stage !== app.stage && when >= (app.stageAt ?? "")) {
      await db.applications.update(appId, { stage, stageAt: when });
      return true;
    }
    return false;
  });
}

/** Removes a note or step. A stage change it caused is not undone. */
export async function deleteEntry(db: JobTrackerDB, appId: number, activityId: number): Promise<boolean> {
  return tx(db, async () => {
    const row = await db.activity.get(activityId);
    if (!row || row.applicationId !== appId) return false;
    await db.activity.delete(activityId);
    return true;
  });
}

export interface HistoryItem {
  kind: "note" | "step" | "email";
  id: number;
  when: string;
  title: string;
  body: string;
  detail: string;
  // email only
  sender?: string;
  account?: string;
  truncated?: boolean;
  open?: MailLink | null;
  reply?: MailLink | null;
  subject?: string;
}

/** Notes, steps, and (optionally) emails for one application, newest first, plus the total count. */
export async function history(
  db: JobTrackerDB, appId: number, limit = 20, includeEmails = true,
): Promise<{ items: HistoryItem[]; total: number }> {
  const items: HistoryItem[] = (await db.activity.where("applicationId").equals(appId).toArray()).map((r) => ({
    kind: r.kind, id: r.id, when: r.occurredAt, title: r.label ?? "", body: r.body, detail: "",
  }));
  if (includeEmails) {
    const accounts = new Map((await db.accounts.toArray()).map((a) => [a.id, a]));
    for (const r of await db.emails.where("applicationId").equals(appId).toArray()) {
      const account = accounts.get(r.accountId);
      if (r.needsReview || !account) continue;
      items.push({
        kind: "email", id: r.id, when: r.receivedAt, title: r.subject || "(no subject)", body: r.body ?? "",
        detail: (r.event ?? "").replace(/_/g, " "), sender: r.sender ?? "",
        account: `${account.provider[0].toUpperCase()}${account.provider.slice(1)} ${account.address}`,
        truncated: cpLength(r.body ?? "") >= BODY_LIMIT,
        open: mailboxLink(account.provider, account.address, r.threadId, r.webLink),
        reply: replyLink(account.provider, account.address, r.sender ?? "", r.subject, r.webLink),
        subject: r.subject ?? "",
      });
    }
  }
  items.sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : b.id - a.id));
  return { items: items.slice(0, limit), total: items.length };
}

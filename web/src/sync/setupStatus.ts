// What is set up, in one place: the four things Job Tracker needs to work well, in the order they depend on each other
// (mailbox, resume, AI key, backup). The Setup tab and the "Finish setting up" card both read this.
//
// Each step is "done" (it is there), "skipped" (the person chose to go without: only the mailbox and the AI key can be skipped)
// or "missing". Skipped counts as done, so the card and the count stop asking. Skips and the card's dismissal are rows in
// the settings table, so they travel with Export and Import. No React here: the AI key and the backup bookkeeping are
// handed in (SetupDeps), so a test can pass fakes.
import type { JobTrackerDB } from "../db/schema";
import { getSetting, setSetting } from "../db/repo";
import { isBackupStale } from "../backup/schedule";
import { PROVIDER_LABEL } from "./accountLabel";
import { getMaster } from "./documents";
import { SETUP_CARD_KEY, SETUP_SKIPS_KEY, sanitizeSetupCard, sanitizeSetupSkips } from "./settings";

export type StepKey = "mailbox" | "resume" | "aiKey" | "backup";
export interface StepState {
  state: "done" | "skipped" | "missing";
  /** one short line: "Gmail · you@gmail.com", "Master resume · updated Nov 10", "Key ending in ••••1234 · locked", "Backed up Nov 9" */
  detail: string;
}
export interface SetupStatus {
  steps: Record<StepKey, StepState>;
  /** steps that are done or skipped */
  done: number;
  total: 4;
  /** the first step still missing, in the order mailbox, resume, aiKey, backup; null when none is */
  next: StepKey | null;
}

export interface SetupDeps {
  aiState(dbName: string): "none" | "locked" | "unlocked";
  /** the last four characters of the saved key, for "Key ending in ••••1234"; null with no key */
  aiLast4(dbName: string): string | null;
  /** when the last full backup was saved (an ISO time), or null */
  lastBackupAt(dbName: string): string | null;
  /** the name of the chosen backup file, or null */
  backupFile(dbName: string): Promise<string | null>;
  /** false in a build that can't connect a mailbox (the demo) */
  mailAvailable(): boolean;
}

export const STEP_ORDER: readonly StepKey[] = ["mailbox", "resume", "aiKey", "backup"];

/** "Nov 10", in the viewer's own zone. */
const shortDate = (iso: string): string => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

export async function setupStatus(db: JobTrackerDB, deps: SetupDeps, now: Date = new Date()): Promise<SetupStatus> {
  const [accounts, master, skips, file] = await Promise.all([
    db.accounts.toArray(),
    getMaster(db),
    getSetting(db, SETUP_SKIPS_KEY).then(sanitizeSetupSkips),
    deps.backupFile(db.name),
  ]);

  const active = accounts.filter((a) => a.active).sort((a, b) => a.id - b.id);
  const mailbox: StepState =
    active.length > 0 ? { state: "done", detail: active.map((a) => `${PROVIDER_LABEL[a.provider]} · ${a.address}`).join(", ") }
    : skips.mailbox ? { state: "skipped", detail: "Skipped" }
    : { state: "missing", detail: deps.mailAvailable() ? "No mailbox connected" : "This demo can't connect mail" };

  const resume: StepState = master
    ? { state: "done", detail: `Master resume · updated ${shortDate(master.updatedAt)}` }
    : { state: "missing", detail: "No resume yet" };

  const aiState = deps.aiState(db.name);
  const last4 = deps.aiLast4(db.name);
  const aiKey: StepState =
    aiState !== "none" ? { state: "done", detail: `Key ending in ••••${last4 ?? ""} · ${aiState}` }
    : skips.aiKey ? { state: "skipped", detail: "Skipped" }
    : { state: "missing", detail: "No key" };

  // Backed up: a backup file is chosen, or a full export happened in the last two weeks.
  const lastBackupAt = deps.lastBackupAt(db.name);
  const fresh = lastBackupAt !== null && !isBackupStale(lastBackupAt, now);
  const backup: StepState =
    file !== null || fresh
      ? { state: "done", detail: lastBackupAt ? `Backed up ${shortDate(lastBackupAt)}` : `Backup file · ${file}` }
      : { state: "missing", detail: lastBackupAt ? `Last backup ${shortDate(lastBackupAt)}` : "Never backed up" };

  const steps = { mailbox, resume, aiKey, backup };
  const done = STEP_ORDER.filter((k) => steps[k].state !== "missing").length;
  return { steps, done, total: 4, next: STEP_ORDER.find((k) => steps[k].state === "missing") ?? null };
}

/** "Skip" on the mailbox or "Not now" on the AI key: the step counts as done until Show skipped steps again. */
export async function skipStep(db: JobTrackerDB, key: "mailbox" | "aiKey"): Promise<void> {
  const skips = sanitizeSetupSkips(await getSetting(db, SETUP_SKIPS_KEY));
  await setSetting(db, SETUP_SKIPS_KEY, { ...skips, [key]: true });
}

/** Forgets every skip. */
export async function unskipAll(db: JobTrackerDB): Promise<void> {
  await db.settings.delete(SETUP_SKIPS_KEY);
}

/** Closes the "Finish setting up" card for good (for this account's database). */
export async function dismissSetupCard(db: JobTrackerDB): Promise<void> {
  await setSetting(db, SETUP_CARD_KEY, { dismissed: true });
}

export async function isSetupCardDismissed(db: JobTrackerDB): Promise<boolean> {
  return sanitizeSetupCard(await getSetting(db, SETUP_CARD_KEY)).dismissed;
}

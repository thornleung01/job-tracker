// Data helpers mirroring jobtracker/db.py. Every function takes the user's database as its first argument.
import type { ProviderName } from "../types";
import { MissingRecordError } from "./errors";
import {
  tx,
  type AccountRow,
  type ApplicationRow,
  type EmailRow,
  type FeedbackRow,
  type JobTrackerDB,
} from "./schema";
import { PROGRESSION, STAGE_FOR_EVENT, TERMINAL, type EventName, type Stage } from "./stages";
import { iso } from "./time";

// -- accounts ---------------------------------------------------------------------------------

/** Adds a mailbox, or switches an existing one back on and clears its error. Returns its id. */
export async function upsertAccount(db: JobTrackerDB, provider: ProviderName, address: string): Promise<number> {
  return tx(db, async () => {
    const existing = await db.accounts.where("[provider+address]").equals([provider, address]).first();
    if (existing) {
      await db.accounts.update(existing.id, { active: true, lastError: null });
      return existing.id;
    }
    return db.accounts.add({ provider, address, lastSync: null, lastError: null, active: true });
  });
}

export async function listAccounts(db: JobTrackerDB, opts: { activeOnly?: boolean } = {}): Promise<AccountRow[]> {
  const rows = await db.accounts.orderBy("id").toArray();
  return opts.activeOnly ? rows.filter((a) => a.active) : rows;
}

/** Stops syncing a mailbox. Its saved emails and applications are kept. */
export async function deactivateAccount(db: JobTrackerDB, accountId: number): Promise<void> {
  await db.accounts.update(accountId, { active: false });
}

// -- emails -----------------------------------------------------------------------------------

export async function emailSeen(db: JobTrackerDB, accountId: number, msgId: string): Promise<boolean> {
  return (await db.emails.where("[accountId+providerMsgId]").equals([accountId, msgId]).count()) > 0;
}

/** The application the newest linked email in this thread belongs to. */
export async function threadApplication(db: JobTrackerDB, accountId: number, threadId: string): Promise<number | null> {
  if (!threadId) return null;
  const rows = await db.emails.where("[accountId+threadId]").equals([accountId, threadId]).toArray();
  let best: EmailRow | null = null;
  for (const e of rows) {
    if (e.applicationId == null) continue;
    if (!best || e.receivedAt > best.receivedAt || (e.receivedAt === best.receivedAt && e.id > best.id)) best = e;
  }
  return best ? best.applicationId : null;
}

/** Turns a stored job email back into ordinary mail: only its id and date are kept (the same as rememberUnrelated), also when you dismiss it. */
export async function clearEmail(db: JobTrackerDB, emailId: number): Promise<void> {
  await db.emails.update(emailId, {
    related: false, needsReview: false, event: null, confidence: null, subject: null, body: null, sender: null,
    threadId: null, webLink: null, bulk: false, reason: null, applicationId: null, hold: false,
  });
}

// -- applications -----------------------------------------------------------------------------

export interface NewApplication {
  company: string;
  companyKey: string;
  role: string;
  roleKey: string;
  stage: Stage;
  when: string;
  manual?: boolean;
  locked?: boolean;
  /** an already-checked posting link (see cleanPostingUrl); empty for none */
  postingUrl?: string;
}

export async function createApplication(db: JobTrackerDB, a: NewApplication): Promise<number> {
  return db.applications.add({
    company: a.company,
    companyKey: a.companyKey,
    role: a.role,
    roleKey: a.roleKey,
    stage: a.stage,
    stageAt: a.when,
    appliedAt: a.stage === "Applied" ? a.when : null,
    lastActivity: a.when,
    locked: a.locked ?? false,
    manual: a.manual ?? false,
    ...(a.postingUrl ? { postingUrl: a.postingUrl } : {}),
  });
}

/** The application, or MissingRecordError when it is gone or deleted (a deleted one is only in Recently deleted). Call it inside the transaction that then writes to it. */
export async function requireApplication(db: JobTrackerDB, appId: number): Promise<ApplicationRow> {
  const app = await db.applications.get(appId);
  if (!app || app.deletedAt) throw new MissingRecordError(`No application ${appId}`);
  return app;
}

/** Moves an application to the stage for `event`. Returns true if the stage changed. */
export async function applyEvent(db: JobTrackerDB, appId: number, event: EventName, when: string): Promise<boolean> {
  const app = await db.applications.get(appId);
  if (!app) throw new Error(`No application ${appId}`);
  const next = STAGE_FOR_EVENT[event];
  const current = app.stage;

  const fields: Partial<ApplicationRow> = { lastActivity: when > (app.lastActivity ?? "") ? when : (app.lastActivity ?? "") };
  if (next === "Applied" && (!app.appliedAt || when < app.appliedAt)) fields.appliedAt = when;

  let change = false;
  if (!app.locked) {
    if (TERMINAL.has(next)) change = next !== current && when >= (app.stageAt ?? "");
    else if (PROGRESSION.includes(current) && PROGRESSION.indexOf(next) > PROGRESSION.indexOf(current)) change = true;
  }
  if (change) {
    fields.stage = next;
    fields.stageAt = when;
  }
  await db.applications.update(appId, fields);
  return change;
}

export async function allApplicationsFor(db: JobTrackerDB, companyKey: string): Promise<ApplicationRow[]> {
  const rows = await db.applications.where("companyKey").equals(companyKey).toArray();
  return rows.sort((a, b) => a.id - b.id);
}

// -- settings, feedback, contact edits ---------------------------------------------------------

export async function getSetting(db: JobTrackerDB, key: string): Promise<unknown> {
  return (await db.settings.get(key))?.value;
}

export async function setSetting(db: JobTrackerDB, key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

/** Remembers what an email looked like and what you said about it. Call before its content is erased. */
export async function recordFeedback(
  db: JobTrackerDB,
  verdict: FeedbackRow["verdict"],
  email: { sender: string | null; subject: string | null; reason?: string | null },
  applicationId: number | null = null,
  now: Date = new Date(),
): Promise<void> {
  const address = senderAddress(email.sender ?? "");
  await db.feedback.add({
    createdAt: iso(now),
    verdict,
    senderEmail: address,
    senderDomain: address.slice(address.lastIndexOf("@") + 1),
    subject: email.subject ?? "",
    reason: email.reason ?? "",
    applicationId,
  });
}

/** The lower-cased address from "Name <address>" (learn.split_sender). */
export function senderAddress(sender: string): string {
  const text = sender ?? "";
  const address = text.includes("<") ? text.slice(text.lastIndexOf("<") + 1).replace(/>+$/, "") : text;
  return address.trim().toLowerCase();
}

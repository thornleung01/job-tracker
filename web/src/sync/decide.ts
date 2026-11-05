// The shared steps of reading one email: what to remember about it, and which application it belongs to.
import type { Message } from "../types";
import { BODY_LIMIT } from "../types";
import type { EmailRow, JobTrackerDB } from "../db/schema";
import { safeWebLink } from "../db/mailLink";
import { applyEvent, createApplication } from "../db/repo";
import { STAGE_FOR_EVENT } from "../db/stages";
import { addDays, iso } from "../db/time";
import { findApplication } from "./match";
import { pipeline } from "./pipeline";
import type { Classification } from "./pipelineTypes";
import { truncate } from "./text";

export const IGNORED_KEEP_DAYS = 30;

/** Keeps only the ID and date so the email isn't fetched or reprocessed. */
export async function rememberUnrelated(db: JobTrackerDB, accountId: number, msgId: string, when: string): Promise<void> {
  await db.emails.add({
    accountId, providerMsgId: msgId, threadId: null, receivedAt: when, sender: null, subject: null, body: null, related: false,
    event: null, confidence: null, applicationId: null, needsReview: false, webLink: null, bulk: false, hold: false, reason: null,
  });
}

export interface IgnoredInput {
  id: string;
  threadId: string | null;
  senderName: string;
  senderEmail: string;
  subject: string;
  body: string;
  webLink?: string | null;
  bulk?: boolean;
}

/** Mail a learned rule ignored stays restorable for a while: you can say "this was a real job". */
export async function rememberIgnored(
  db: JobTrackerDB, accountId: number, msg: IgnoredInput, when: string, reason: string, now: Date = new Date(),
): Promise<void> {
  const exists = await db.ignoredMail.where("[accountId+providerMsgId]").equals([accountId, msg.id]).count();
  if (!exists) {
    await db.ignoredMail.add({
      accountId, providerMsgId: msg.id, threadId: msg.threadId, receivedAt: when,
      sender: `${msg.senderName} <${msg.senderEmail}>`, subject: msg.subject, body: truncate(msg.body, BODY_LIMIT),
      webLink: safeWebLink(msg.webLink), reason, createdAt: iso(now), bulk: Boolean(msg.bulk),
    });
  }
  const cutoff = iso(addDays(now, -IGNORED_KEEP_DAYS));
  await db.ignoredMail.where("createdAt").below(cutoff).delete();
}

/** The Message a stored email was, as the classifier reads it. */
export function messageFromRow(row: Pick<EmailRow, "providerMsgId" | "threadId" | "sender" | "subject" | "receivedAt" | "body" | "bulk" | "webLink">): Message {
  const sender = row.sender ?? "";
  const cut = sender.indexOf("<");
  const name = cut < 0 ? sender : sender.slice(0, cut);
  const address = cut < 0 ? "" : sender.slice(cut + 1);
  return {
    id: row.providerMsgId,
    threadId: row.threadId ?? "",
    senderName: name.trim(),
    senderEmail: (address ? address.replace(/>+$/, "") : name).trim(),
    subject: row.subject ?? "",
    receivedAt: row.receivedAt,
    body: row.body ?? "",
    bulk: Boolean(row.bulk),
    webLink: row.webLink,
  };
}

/** Fills in a role on an application made without one, once an email names it. */
export async function fillRole(db: JobTrackerDB, appId: number, role: string, rkey: string): Promise<void> {
  if (!rkey) return;
  const app = await db.applications.get(appId);
  if (app && app.roleKey === "") await db.applications.update(appId, { role, roleKey: rkey });
}

/** Finds or makes the application a job email belongs to. Returns the application id (or null) and whether a human should look. */
export async function decide(
  db: JobTrackerDB, accountId: number, msg: Message, cls: Classification, when: string,
): Promise<{ appId: number | null; needsReview: boolean }> {
  const p = pipeline();
  const [company, role] = p.extractCompanyRole(msg);
  const ckey = p.companyKey(company);
  const rkey = p.roleKey(role);
  const event = cls.event;
  if (!event) throw new Error("A related email needs an event");

  const match = await findApplication(db, accountId, msg.threadId, ckey, rkey, event, role);
  let needsReview = cls.confidence === "low" || match.kind === "ambiguous";
  // Weak wording is fine when the mail clearly belongs to a conversation already being followed (same thread, or the
  // one open application at that company): a "heard back" can only add to what is known, never invent anything.
  if (cls.confidence === "low" && match.kind === "matched" && event === "heard_back") needsReview = false;
  let appId: number | null = null;

  if (!needsReview) {
    if (match.kind === "matched") {
      appId = match.applicationId;
    } else if (company === p.UNKNOWN_COMPANY) {
      needsReview = true;
    } else if (event !== "applied" && cls.confidence !== "high") {
      // "Interview" or "offer" somewhere in the text, with no application to attach it to: you decide.
      needsReview = true;
    } else {
      appId = await createApplication(db, { company, companyKey: ckey, role, roleKey: rkey, stage: STAGE_FOR_EVENT[event], when });
    }
    if (appId && match.kind === "matched") await fillRole(db, appId, role, rkey);
    if (appId) await applyEvent(db, appId, event, when);
  }
  return { appId, needsReview };
}

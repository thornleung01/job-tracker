// What you can do to applications and to Needs review, from the routes in jobtracker/web.py. Each action is one transaction.
import { ActionError } from "../db/errors";
import { cleanOfferDeadline, cleanOfferSalary } from "../db/offer";
import { cleanPostingUrl } from "../db/postingUrl";
import { EVENT_FOR_STAGE, isStage, type Stage } from "../db/stages";
import { applyEvent, clearEmail, createApplication, recordFeedback } from "../db/repo";
import { tx, type ApplicationRow, type JobTrackerDB } from "../db/schema";
import { isDayString, iso, localToday } from "../db/time";
import { MissingRecordError } from "./activity";
import { messageFromRow } from "./decide";
import * as learn from "./learn";
import { pipeline } from "./pipeline";
import { recheck, removeApplicationRow } from "./recheck";
import { MAX_ROUNDS } from "./rounds";
import { processMessage } from "./sync";
import { squeeze } from "./text";

export { ActionError };

const short = (text: string, limit = 400) => (text.length <= limit ? text : text.slice(0, limit - 1) + "…");

/** Turns the feedback so far into rules, then clears saved mail the new rules no longer believe. */
export async function learnedFromFeedback(db: JobTrackerDB): Promise<{ rules: string[]; cleared: number }> {
  const rules = await learn.rebuild(db);
  return { rules, cleared: rules.length ? (await recheck(db)).cleared : 0 };
}

/** The sentence shown after something was learned, or "" when nothing was. */
export function learnedNotice(rules: string[], cleared: number, prefix = ""): string {
  if (!rules.length) return prefix;
  let text = (prefix ? prefix + " " : "") + "Learned: " + rules.join(". ") + ".";
  if (cleared) text += ` Also cleared ${cleared} similar email${cleared !== 1 ? "s" : ""}.`;
  return short(text, 600);
}

// -- applications ---------------------------------------------------------------------------

export interface AddApplicationInput {
  company: string;
  role?: string;
  stage?: Stage;
  /** the day you applied, YYYY-MM-DD; empty for now */
  appliedOn?: string;
  /** the job posting's web address; optional, checked by cleanPostingUrl (throws ActionError) */
  url?: string;
}

/**
 * The timestamp for "I applied on this day" (YYYY-MM-DD). Days are compared as calendar days in the viewer's own timezone, so
 * today is never "in the future" whatever the hour in UTC. Today is stamped with the current time, any other day with noon.
 */
function appliedStamp(day: string, now: Date): string {
  if (!isDayString(day)) throw new ActionError("Enter the date as year-month-day, for example 2026-10-21.");
  if (day > localToday(now)) throw new ActionError("The date can't be in the future.");
  if (day < "1990-01-01") throw new ActionError("Enter a date from 1990 onward.");
  const noon = new Date(`${day}T12:00:00Z`);
  return iso(noon > now ? now : noon);       // never a time still ahead
}

/** Logs an application by hand. It is yours: its stage is locked and rechecks never rewrite it. */
export async function addApplication(db: JobTrackerDB, input: AddApplicationInput, now: Date = new Date()): Promise<number> {
  const p = pipeline();
  const company = squeeze(input.company).slice(0, 80);
  const role = squeeze(input.role).slice(0, 100) || p.UNKNOWN_ROLE;
  const stage = input.stage ?? "Applied";
  if (!company || !isStage(stage)) throw new ActionError("Enter a company name.");
  const postingUrl = cleanPostingUrl(input.url ?? "");
  // the day you applied, so logging something from last week lands in the right place
  const day = (input.appliedOn ?? "").trim();
  const when = day ? appliedStamp(day, now) : iso(now);
  return tx(db, () =>
    createApplication(db, { company, companyKey: p.companyKey(company), role, roleKey: p.roleKey(role), stage, when, manual: true, locked: true, postingUrl }),
  );
}

/**
 * Fix the company, role or posting link by hand. An edited application is yours: re-checks and syncs won't rewrite it.
 * `url` left out keeps the current link; an empty string clears it; anything else must pass cleanPostingUrl.
 */
export async function editApplication(db: JobTrackerDB, appId: number, company: string, role: string, url?: string): Promise<void> {
  const p = pipeline();
  if (!(await db.applications.get(appId))) throw new MissingRecordError(`No application ${appId}`);
  const cleanCompany = squeeze(company).slice(0, 80);
  const cleanRole = squeeze(role).slice(0, 100) || p.UNKNOWN_ROLE;
  if (!cleanCompany) throw new ActionError("Enter a company name.");
  const postingUrl = url === undefined ? undefined : cleanPostingUrl(url);
  await db.applications.update(appId, {
    company: cleanCompany, companyKey: p.companyKey(cleanCompany), role: cleanRole, roleKey: p.roleKey(cleanRole), manual: true,
    ...(postingUrl === undefined ? {} : { postingUrl: postingUrl || undefined }),
  });
}

/** Sets the stage by hand and locks it, so mail stops moving it. */
export async function setStage(db: JobTrackerDB, appId: number, stage: Stage, now: Date = new Date()): Promise<void> {
  if (!isStage(stage)) throw new ActionError("Unknown stage.");
  if (!(await db.applications.get(appId))) throw new MissingRecordError(`No application ${appId}`);
  await db.applications.update(appId, { stage, stageAt: iso(now), locked: true });
}

/** Puts a stage back exactly as it was, including whether it was locked: the Undo after a quick stage change. */
export async function restoreStage(db: JobTrackerDB, appId: number, before: { stage: Stage; stageAt: string | null; locked: boolean }): Promise<void> {
  if (!isStage(before.stage)) throw new ActionError("Unknown stage.");
  if (!(await db.applications.get(appId))) throw new MissingRecordError(`No application ${appId}`);
  await db.applications.update(appId, { stage: before.stage, stageAt: before.stageAt, locked: before.locked });
}

/** Changes the day you applied. Today is stamped with the current time and any other day with noon, as when adding by hand. */
export async function setAppliedOn(db: JobTrackerDB, appId: number, day: string, now: Date = new Date()): Promise<void> {
  const appliedAt = appliedStamp(day.trim(), now);
  if (!(await db.applications.get(appId))) throw new MissingRecordError(`No application ${appId}`);
  await db.applications.update(appId, { appliedAt, manual: true });
}

/** Sets the number of interview rounds by hand. `null` goes back to working it out from the emails and your steps. */
export async function setInterviewRounds(db: JobTrackerDB, appId: number, rounds: number | null): Promise<void> {
  if (rounds !== null && (!Number.isInteger(rounds) || rounds < 0 || rounds > MAX_ROUNDS)) throw new ActionError(`Enter a whole number from 0 to ${MAX_ROUNDS}.`);
  if (!(await db.applications.get(appId))) throw new MissingRecordError(`No application ${appId}`);
  await db.applications.update(appId, { interviewRounds: rounds ?? undefined });
}

/** Saves what the offer pays and the day to decide by. Either can be empty, and both empty clears the offer details. A past deadline is allowed. */
export async function setOfferDetails(db: JobTrackerDB, appId: number, details: { salary: string; deadline: string }): Promise<void> {
  const salary = cleanOfferSalary(details.salary);
  const deadline = cleanOfferDeadline(details.deadline);
  if (!(await db.applications.get(appId))) throw new MissingRecordError(`No application ${appId}`);
  await db.applications.update(appId, { offerSalary: salary || undefined, offerDeadline: deadline || undefined });
}

export async function unlockStage(db: JobTrackerDB, appId: number): Promise<void> {
  await db.applications.update(appId, { locked: false });
}

/**
 * Deletes an application. By default its saved emails are cleared too, so nothing can rebuild it from them. With
 * emails "review" they go back to Needs review instead, held there so that a sync does not re-attach them: that is for
 * when the application was a wrong grouping and its emails belong somewhere else.
 */
export async function deleteApplication(db: JobTrackerDB, appId: number, emails: "clear" | "review" = "clear"): Promise<void> {
  if (emails !== "clear" && emails !== "review") throw new ActionError("Unknown way to delete.");
  await tx(db, async () => {
    for (const e of await db.emails.where("applicationId").equals(appId).toArray()) {
      if (emails === "review") await db.emails.update(e.id, { applicationId: null, needsReview: true, hold: true });
      else await clearEmail(db, e.id);
    }
    await removeApplicationRow(db, appId);
  });
}

/** Folds one application into another: emails, notes, steps and people corrections move across. */
export async function mergeApplications(db: JobTrackerDB, appId: number, into: number): Promise<void> {
  const src = await db.applications.get(appId);
  const dst = await db.applications.get(into);
  if (!src || !dst || appId === into) throw new ActionError("Choose another application to merge into.");
  const appliedCandidates = [src.appliedAt, dst.appliedAt].filter((x): x is string => Boolean(x)).sort();
  const lastActivity = (src.lastActivity ?? "") > (dst.lastActivity ?? "") ? src.lastActivity : dst.lastActivity;
  const fields: Partial<ApplicationRow> = { lastActivity: lastActivity || null, appliedAt: appliedCandidates[0] ?? null };
  // A stage you set by hand wins (and stays locked), otherwise the later stage does.
  if (!dst.locked && (src.locked || (src.stageAt ?? "") > (dst.stageAt ?? ""))) {
    Object.assign(fields, { stage: src.stage, stageAt: src.stageAt, locked: src.locked });
  }
  // keep the target's posting link, otherwise take the source's
  if (!dst.postingUrl && src.postingUrl) fields.postingUrl = src.postingUrl;
  if (dst.interviewRounds === undefined && src.interviewRounds !== undefined) fields.interviewRounds = src.interviewRounds;
  if (!dst.offerSalary && src.offerSalary) fields.offerSalary = src.offerSalary;
  if (!dst.offerDeadline && src.offerDeadline) fields.offerDeadline = src.offerDeadline;
  await tx(db, async () => {
    await db.emails.where("applicationId").equals(appId).modify({ applicationId: into });
    await db.activity.where("applicationId").equals(appId).modify({ applicationId: into });
    await db.feedback.where("applicationId").equals(appId).modify({ applicationId: into });
    for (const edit of await db.contactEdits.where("key").startsWith(`${appId}|`).toArray()) {
      const moved = `${into}|${edit.key.slice(edit.key.indexOf("|") + 1)}`;
      if (!(await db.contactEdits.get(moved))) await db.contactEdits.put({ ...edit, key: moved });
      await db.contactEdits.delete(edit.key);
    }
    await db.applications.update(into, fields);
    await removeApplicationRow(db, appId);
  });
}

/** You are telling it this was never a job application: remove it, and learn from the emails that made it. */
export async function notAnApplication(db: JobTrackerDB, appId: number): Promise<{ company: string; rules: string[]; cleared: number }> {
  const app = await db.applications.get(appId);
  if (!app) throw new MissingRecordError(`No application ${appId}`);
  await tx(db, async () => {
    for (const e of (await db.emails.where("applicationId").equals(appId).toArray()).filter((x) => x.related)) {
      await recordFeedback(db, "not_job", e);
      await clearEmail(db, e.id);
    }
    await removeApplicationRow(db, appId);
  });
  return { company: app.company, ...(await learnedFromFeedback(db)) };
}

// -- Needs review ---------------------------------------------------------------------------

export type ReviewDecision =
  | { action: "dismiss" }
  | { action: "assign"; appId: number; stage?: Stage }
  | { action: "new"; company: string; role?: string; stage?: Stage };

/** Settles one email waiting in Needs review. Dismissing or assigning teaches the app (a feedback record, then rules). */
export async function resolveReview(db: JobTrackerDB, emailId: number, decision: ReviewDecision): Promise<{ rules: string[]; cleared: number }> {
  const p = pipeline();
  const stage = "stage" in decision && decision.stage ? decision.stage : "Applied";
  if (!isStage(stage)) throw new ActionError("Unknown stage.");
  await tx(db, async () => {
    const email = await db.emails.get(emailId);
    if (!email || !email.needsReview) throw new MissingRecordError(`No email ${emailId} waiting for review`);
    if (decision.action === "dismiss") {
      await recordFeedback(db, "not_job", email); // before its content is erased
      await db.emails.update(emailId, { needsReview: false, related: false, event: null, subject: null, body: null, sender: null, reason: null });
    } else if (decision.action === "assign" || decision.action === "new") {
      let appId: number;
      if (decision.action === "new") {
        const company = squeeze(decision.company);
        const role = squeeze(decision.role) || p.UNKNOWN_ROLE;
        if (!company) throw new ActionError("Enter a company name.");
        appId = await createApplication(db, { company, companyKey: p.companyKey(company), role, roleKey: p.roleKey(role), stage, when: email.receivedAt });
      } else {
        appId = decision.appId;
        if (!(await db.applications.get(appId))) throw new ActionError("Choose an application.");
      }
      // Record the stage you chose, so the flow chart reflects your decision.
      await db.emails.update(emailId, { applicationId: appId, needsReview: false, hold: false, event: EVENT_FOR_STAGE[stage] });
      await applyEvent(db, appId, EVENT_FOR_STAGE[stage], email.receivedAt);
      await recordFeedback(db, "job", email, appId);
    } else {
      throw new ActionError("Unknown action.");
    }
  });
  return learnedFromFeedback(db);
}

export type RestoreOutcome = "ignored" | "review" | "applied-to-application";

/**
 * You are telling it an email it ignored was a real job email: the rule that hid it is undone, and it is read again.
 * Returns what happened and a sentence to show.
 */
export async function ignoredIsReal(db: JobTrackerDB, ignoredId: number, now: Date = new Date()): Promise<{ outcome: RestoreOutcome; message: string }> {
  const row = await db.ignoredMail.get(ignoredId);
  if (!row) throw new MissingRecordError(`No ignored email ${ignoredId}`);
  await tx(db, async () => {
    await recordFeedback(db, "job", { sender: row.sender, subject: row.subject, reason: "" });
    const stored = await db.emails.where("[accountId+providerMsgId]").equals([row.accountId, row.providerMsgId]).first();
    if (stored && !stored.related) await db.emails.delete(stored.id);
    await db.ignoredMail.delete(ignoredId);
  });
  await learn.rebuild(db, now); // confirming the sender switches off the rules that hid it
  const msg = messageFromRow({
    providerMsgId: row.providerMsgId, threadId: row.threadId, sender: row.sender, subject: row.subject, receivedAt: row.receivedAt,
    body: row.body, bulk: row.bulk, webLink: row.webLink,
  });
  const outcome = await processMessage(db, row.accountId, { ...msg, webLink: row.webLink }, undefined, now);
  const message =
    outcome === "ignored" ? "Rule undone, but this email doesn't read like a job email, so it stays ignored."
    : outcome === "review" ? "Restored. It's in Needs review above, and the rule that hid it is gone."
    : "Restored and added to your applications. The rule that hid it is gone.";
  return { outcome: outcome as RestoreOutcome, message };
}

/** Switches a learned rule off. Throws MissingRecordError when there is no such rule. */
export async function undoRule(db: JobTrackerDB, ruleId: number): Promise<string> {
  if (!(await learn.undo(db, ruleId))) throw new MissingRecordError(`No rule ${ruleId}`);
  return "Rule removed. New emails are judged without it. Emails it already cleared stay cleared.";
}

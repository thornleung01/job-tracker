// What you can do to applications and to Needs review, from the routes in jobtracker/web.py. Every action that reads
// a row before it writes is one transaction, so what it read is still true when it writes (a second tab, or a sync,
// can't change the row in between).
import { ActionError, MissingRecordError } from "../db/errors";
import { MAX_COMPANY_CHARS, MAX_ROLE_CHARS } from "../db/limits";
import { cleanOfferDeadline, cleanOfferSalary } from "../db/offer";
import { cleanPostingUrl } from "../db/postingUrl";
import { EVENT_FOR_STAGE, isStage, type Stage } from "../db/stages";
import { applyEvent, clearEmail, createApplication, recordFeedback, requireApplication } from "../db/repo";
import { tx, type ApplicationRow, type JobTrackerDB } from "../db/schema";
import { iso, stampForDay } from "../db/time";
import { messageFromRow } from "./decide";
import * as learn from "./learn";
import { pipeline } from "./pipeline";
import { recheck, removeApplicationRow } from "./recheck";
import { MAX_ROUNDS } from "./rounds";
import { processMessage, type Outcome } from "./sync";
import { markDeleted } from "./trash";
import { plural, squeeze } from "./text";

export { ActionError, MissingRecordError };

const short = (text: string, limit: number) => (text.length <= limit ? text : text.slice(0, limit - 1) + "…");

/** Turns the feedback so far into rules, then clears saved mail the new rules no longer believe. */
export async function learnedFromFeedback(db: JobTrackerDB): Promise<{ rules: string[]; cleared: number }> {
  const rules = await learn.rebuild(db);
  return { rules, cleared: rules.length ? (await recheck(db)).cleared : 0 };
}

/** The sentence shown after something was learned, or "" when nothing was. */
export function learnedNotice(rules: string[], cleared: number, prefix = ""): string {
  if (!rules.length) return prefix;
  let text = (prefix ? prefix + " " : "") + "Learned: " + rules.join(". ") + ".";
  if (cleared) text += ` Also cleared ${plural(cleared, "similar email")}.`;
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

/** Changes some fields of one application, after checking in the same transaction that it still exists. */
async function updateApplication(db: JobTrackerDB, appId: number, fields: Partial<ApplicationRow>): Promise<void> {
  await db.transaction("rw", db.applications, async () => {
    await requireApplication(db, appId);
    await db.applications.update(appId, fields);
  });
}

/** Logs an application by hand. It is yours: its stage is locked and rechecks never rewrite it. */
export async function addApplication(db: JobTrackerDB, input: AddApplicationInput, now: Date = new Date()): Promise<number> {
  const p = pipeline();
  const company = squeeze(input.company).slice(0, MAX_COMPANY_CHARS);
  const role = squeeze(input.role).slice(0, MAX_ROLE_CHARS) || p.UNKNOWN_ROLE;
  const stage = input.stage ?? "Applied";
  if (!company || !isStage(stage)) throw new ActionError("Enter a company name.");
  const postingUrl = cleanPostingUrl(input.url ?? "");
  // the day you applied, so logging something from last week lands in the right place
  const day = (input.appliedOn ?? "").trim();
  const when = day ? stampForDay(day, now) : iso(now);
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
  const cleanCompany = squeeze(company).slice(0, MAX_COMPANY_CHARS);
  const cleanRole = squeeze(role).slice(0, MAX_ROLE_CHARS) || p.UNKNOWN_ROLE;
  if (!cleanCompany) throw new ActionError("Enter a company name.");
  const postingUrl = url === undefined ? undefined : cleanPostingUrl(url);
  await updateApplication(db, appId, {
    company: cleanCompany, companyKey: p.companyKey(cleanCompany), role: cleanRole, roleKey: p.roleKey(cleanRole), manual: true,
    ...(postingUrl === undefined ? {} : { postingUrl: postingUrl || undefined }),
  });
}

/** Sets the stage by hand and locks it, so mail stops moving it. */
export async function setStage(db: JobTrackerDB, appId: number, stage: Stage, now: Date = new Date()): Promise<void> {
  if (!isStage(stage)) throw new ActionError("Unknown stage.");
  await updateApplication(db, appId, { stage, stageAt: iso(now), locked: true });
}

/** Puts a stage back exactly as it was, including whether it was locked: the Undo after a quick stage change. */
export async function restoreStage(db: JobTrackerDB, appId: number, before: { stage: Stage; stageAt: string | null; locked: boolean }): Promise<void> {
  if (!isStage(before.stage)) throw new ActionError("Unknown stage.");
  await updateApplication(db, appId, { stage: before.stage, stageAt: before.stageAt, locked: before.locked });
}

/** Changes the day you applied. Stamped as when adding by hand (see stampForDay): it always reads back as the day you picked. */
export async function setAppliedOn(db: JobTrackerDB, appId: number, day: string, now: Date = new Date()): Promise<void> {
  await updateApplication(db, appId, { appliedAt: stampForDay(day.trim(), now), manual: true });
}

/** Sets the number of interview rounds by hand. `null` goes back to working it out from the emails and your steps. */
export async function setInterviewRounds(db: JobTrackerDB, appId: number, rounds: number | null): Promise<void> {
  if (rounds !== null && (!Number.isInteger(rounds) || rounds < 0 || rounds > MAX_ROUNDS)) throw new ActionError(`Enter a whole number from 0 to ${MAX_ROUNDS}.`);
  await updateApplication(db, appId, { interviewRounds: rounds ?? undefined });
}

/** Saves what the offer pays and the day to decide by. Either can be empty, and both empty clears the offer details. A past deadline is allowed. */
export async function setOfferDetails(db: JobTrackerDB, appId: number, details: { salary: string; deadline: string }): Promise<void> {
  const salary = cleanOfferSalary(details.salary);
  const deadline = cleanOfferDeadline(details.deadline);
  await updateApplication(db, appId, { offerSalary: salary || undefined, offerDeadline: deadline || undefined });
}

/** Lets mail move the stage again. */
export async function unlockStage(db: JobTrackerDB, appId: number): Promise<void> {
  await updateApplication(db, appId, { locked: false });
}

/**
 * Deletes an application. By default it goes to Recently deleted: it is hidden everywhere, but its emails, notes and steps
 * are kept for 30 days (see trash.ts), so you can restore it, and mail that arrives for it is kept with it, not turned into a
 * new application. With emails "review" it is removed for good now and its emails go back to Needs review, held there so
 * that a sync does not re-attach them: that is for when the application was a wrong grouping and its emails belong elsewhere.
 * Throws MissingRecordError when there is no such application (a deleted one counts as none).
 */
export async function deleteApplication(db: JobTrackerDB, appId: number, emails: "clear" | "review" = "clear", now: Date = new Date()): Promise<void> {
  // Public actions check what they are handed even when the types say it can't be wrong: the value can come from a stale page.
  if (emails !== "clear" && emails !== "review") throw new ActionError("Unknown way to delete.");
  await tx(db, async () => {
    if (emails === "clear") {
      await markDeleted(db, appId, now);
      return;
    }
    await requireApplication(db, appId);
    for (const e of await db.emails.where("applicationId").equals(appId).toArray()) {
      await db.emails.update(e.id, { applicationId: null, needsReview: true, hold: true });
    }
    await removeApplicationRow(db, appId);
  });
}

/** Folds one application into another: emails, notes, steps and people corrections move across. */
export async function mergeApplications(db: JobTrackerDB, appId: number, into: number): Promise<void> {
  // Both rows are read inside the transaction that writes, so a sync's newer lastActivity or a second tab's delete can't slip in between.
  await tx(db, async () => {
    const src = await db.applications.get(appId);
    const dst = await db.applications.get(into);
    if (!src || !dst || src.deletedAt || dst.deletedAt || appId === into) throw new ActionError("Choose another application to merge into.");
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
export async function notAnApplication(db: JobTrackerDB, appId: number, now: Date = new Date()): Promise<{ company: string; rules: string[]; cleared: number }> {
  const app = await tx(db, async () => {
    const found = await requireApplication(db, appId);
    for (const e of (await db.emails.where("applicationId").equals(appId).toArray()).filter((x) => x.related)) {
      await recordFeedback(db, "not_job", e, null, now);
      await clearEmail(db, e.id);
    }
    await removeApplicationRow(db, appId);
    return found;
  });
  return { company: app.company, ...(await learnedFromFeedback(db)) };
}

// -- Needs review ---------------------------------------------------------------------------

export type ReviewDecision =
  | { action: "dismiss" }
  | { action: "assign"; appId: number; stage?: Stage }
  | { action: "new"; company: string; role?: string; stage?: Stage };

/** Settles one email waiting in Needs review. Dismissing or assigning teaches the app (a feedback record, then rules). */
export async function resolveReview(
  db: JobTrackerDB, emailId: number, decision: ReviewDecision, now: Date = new Date(),
): Promise<{ rules: string[]; cleared: number }> {
  const p = pipeline();
  const stage = "stage" in decision && decision.stage ? decision.stage : "Applied";
  if (!isStage(stage)) throw new ActionError("Unknown stage.");
  await tx(db, async () => {
    const email = await db.emails.get(emailId);
    if (!email || !email.needsReview) throw new MissingRecordError(`No email ${emailId} waiting for review`);
    if (decision.action === "dismiss") {
      await recordFeedback(db, "not_job", email, null, now); // before its content is erased
      await clearEmail(db, emailId); // only its id and date stay, the same as for any other mail that isn't about a job
    } else if (decision.action === "assign" || decision.action === "new") {
      let appId: number;
      if (decision.action === "new") {
        const company = squeeze(decision.company);
        const role = squeeze(decision.role) || p.UNKNOWN_ROLE;
        if (!company) throw new ActionError("Enter a company name.");
        appId = await createApplication(db, { company, companyKey: p.companyKey(company), role, roleKey: p.roleKey(role), stage, when: email.receivedAt });
      } else {
        appId = decision.appId;
        const target = await db.applications.get(appId);
        if (!target || target.deletedAt) throw new ActionError("Choose an application.");
      }
      // Record the stage you chose, so the flow chart reflects your decision.
      await db.emails.update(emailId, { applicationId: appId, needsReview: false, hold: false, event: EVENT_FOR_STAGE[stage] });
      await applyEvent(db, appId, EVENT_FOR_STAGE[stage], email.receivedAt);
      await recordFeedback(db, "job", email, appId, now);
    } else {
      throw new ActionError("Unknown action.");
    }
  });
  return learnedFromFeedback(db);
}

export type RestoreOutcome = Outcome;

/** The sentence for what reading a restored email came to. A duplicate or a job alert can't normally happen here, but each still gets a true sentence. */
const RESTORE_MESSAGE: Record<Outcome, string> = {
  ignored: "Rule undone, but this email doesn't read like a job email, so it stays ignored.",
  review: "Restored. It's in Needs review above, and the rule that hid it is gone.",
  "applied-to-application": "Restored and added to your applications. The rule that hid it is gone.",
  duplicate: "The rule that hid it is gone. This email was already saved.",
  "job-alert": "The rule that hid it is gone, but this is a job alert, which isn't kept as an application.",
};

/**
 * You are telling it an email it ignored was a real job email: the rule that hid it is undone, and it is read again.
 * Returns what happened and a sentence to show.
 */
export async function ignoredIsReal(db: JobTrackerDB, ignoredId: number, now: Date = new Date()): Promise<{ outcome: RestoreOutcome; message: string }> {
  const row = await tx(db, async () => {
    const found = await db.ignoredMail.get(ignoredId);
    if (!found) throw new MissingRecordError(`No ignored email ${ignoredId}`);
    await recordFeedback(db, "job", { sender: found.sender, subject: found.subject, reason: "" }, null, now);
    const stored = await db.emails.where("[accountId+providerMsgId]").equals([found.accountId, found.providerMsgId]).first();
    if (stored && !stored.related) await db.emails.delete(stored.id);
    await db.ignoredMail.delete(ignoredId);
    return found;
  });
  await learn.rebuild(db, now); // confirming the sender switches off the rules that hid it
  const msg = messageFromRow({
    providerMsgId: row.providerMsgId, threadId: row.threadId, sender: row.sender, subject: row.subject, receivedAt: row.receivedAt,
    body: row.body, bulk: row.bulk, webLink: row.webLink,
  });
  const outcome = await processMessage(db, row.accountId, msg, undefined, now);
  return { outcome, message: RESTORE_MESSAGE[outcome] };
}

/** Switches a learned rule off. Throws MissingRecordError when there is no such rule. */
export async function undoRule(db: JobTrackerDB, ruleId: number): Promise<string> {
  if (!(await learn.undo(db, ruleId))) throw new MissingRecordError(`No rule ${ruleId}`);
  return "Rule removed. New emails are judged without it. Emails it already cleared stay cleared.";
}

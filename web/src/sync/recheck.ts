// Re-run today's rules over the job mail already stored, and undo what the rules no longer believe (jobtracker/recheck.py).
//
// Emails the rules once took for application updates (a newsletter that said "interview") are turned back into
// ordinary mail and removed from Needs review. An application is only removed when nothing you did is attached to it:
// it was made by a sync, you never locked or edited its stage, and you added no notes, steps, offer details, interview rounds or people corrections. Applications you made
// or touched are never changed.
import { applyEvent, clearEmail } from "../db/repo";
import { tx, type EmailRow, type JobTrackerDB } from "../db/schema";
import { byAsc } from "./compare";
import { decide, messageFromRow, rememberIgnored } from "./decide";
import { loadLearned } from "./learn";
import { isLive } from "./live";
import { pipeline } from "./pipeline";
import { CLASSIFY_CHUNK, yieldToMain } from "./yieldToMain";

export interface RecheckResult {
  checked: number;
  cleared: number;
  removed: number;
  settled: number;
  roles: number;
}

/** True when no one has edited this application: a sync made it and only a sync has moved it. A deleted one is not: it is yours to restore, so a recheck leaves it and its emails alone. */
async function isUntouched(db: JobTrackerDB, appId: number | null): Promise<boolean> {
  if (appId == null) return true;
  const app = await db.applications.get(appId);
  if (!app) return true;
  if (!isLive(app)) return false;
  const notes = await db.activity.where("applicationId").equals(appId).count();
  const letters = await db.documents.where("applicationId").equals(appId).count();
  // Offer details, interview rounds and people corrections are yours too, though none of them sets `manual`.
  const people = await db.contactEdits.where("key").startsWith(`${appId}|`).count();
  const typedIn = app.interviewRounds !== undefined || Boolean(app.offerSalary) || Boolean(app.offerDeadline);
  return !app.manual && !app.locked && notes === 0 && letters === 0 && people === 0 && !typedIn && app.resumeId === undefined && !app.postingText;
}

export async function recheck(db: JobTrackerDB, now: Date = new Date()): Promise<RecheckResult> {
  const rows = (await db.emails.orderBy("id").toArray()).filter((e) => e.related);
  const learned = await loadLearned(db);
  const p = pipeline();
  // Classifying is the slow part and needs no database, so it runs outside the transaction. What to do about each email
  // is decided inside it, from what is stored at that moment: a note or a stage lock added while this ran is still respected.
  // It runs in chunks with a yield between them, so the page stays responsive.
  const unbelieved: { row: EmailRow; reason: string }[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (i && i % CLASSIFY_CHUNK === 0) await yieldToMain();
    const cls = p.classify(messageFromRow(rows[i]), learned);
    if (!cls.related) unbelieved.push({ row: rows[i], reason: cls.reason });
  }

  let cleared = 0;
  let removed = 0;
  await tx(db, async () => {
    const touched = new Set<number>();
    const untouchedApp = new Map<number, boolean>();
    for (const { row, reason } of unbelieved) {
      const current = await db.emails.get(row.id);
      if (!current?.related) continue; // you settled it while this ran
      const appId = current.applicationId;
      if (appId != null) {
        if (!untouchedApp.has(appId)) untouchedApp.set(appId, await isUntouched(db, appId));
        if (!untouchedApp.get(appId)) continue;
      }
      if (reason.startsWith("learned:")) {
        // a learned rule did this: keep it restorable for a while
        const msg = messageFromRow(row);
        await rememberIgnored(
          db, row.accountId,
          { id: row.providerMsgId, threadId: row.threadId, senderName: msg.senderName, senderEmail: msg.senderEmail, subject: msg.subject,
            body: msg.body, webLink: row.webLink, bulk: row.bulk },
          row.receivedAt, reason, now,
        );
      }
      await clearEmail(db, row.id); // the same as dismissing it in Needs review
      cleared++;
      if (appId != null) touched.add(appId);
    }
    for (const appId of touched) {
      const left = (await db.emails.where("applicationId").equals(appId).toArray())
        .filter((e) => e.related)
        .sort((a, b) => byAsc<EmailRow>((e) => e.receivedAt)(a, b) || a.id - b.id);
      if (!left.length) {
        await removeApplicationRow(db, appId);
        removed++;
        continue;
      }
      // Some real mail remains: rebuild the stage from it, so a stage a newsletter pushed it to is undone.
      await db.applications.update(appId, { stage: "Applied", stageAt: null, appliedAt: null, lastActivity: left[0].receivedAt });
      for (const e of left) if (e.event) await applyEvent(db, appId, e.event, e.receivedAt);
    }
  });
  return { checked: rows.length, cleared, removed, settled: await settleReview(db), roles: await fillMissingRoles(db) };
}

/** Deletes an application row together with what is keyed to it: its notes and steps, its cover letter, people corrections, and the links from feedback and emails. */
export async function removeApplicationRow(db: JobTrackerDB, appId: number): Promise<void> {
  await db.activity.where("applicationId").equals(appId).delete();
  await db.documents.where("applicationId").equals(appId).delete(); // its cover letter and its tailored resume; the master and other resume versions stay
  await db.contactEdits.where("key").startsWith(`${appId}|`).delete();
  await db.feedback.where("applicationId").equals(appId).modify({ applicationId: null });
  await db.emails.where("applicationId").equals(appId).modify({ applicationId: null });
  await db.applications.delete(appId);
}

/**
 * Re-judge the emails waiting in Needs review with today's rules and today's applications. Many were unsure when they
 * arrived (there was no application for them yet) but belong to one now. Returns how many were settled.
 */
export async function settleReview(db: JobTrackerDB, opts: { skipIfUnchanged?: boolean } = {}): Promise<number> {
  if (opts.skipIfUnchanged && (await db.settings.get(SETTLE_MARK))?.value === (await settleFingerprint(db))) return 0;
  const learned = await loadLearned(db);
  const p = pipeline();
  // Only the waiting mail is read (the `review` index), and it is classified outside the transaction, in chunks that yield.
  const waiting = (await db.emails.where("review").equals(1).toArray())
    .filter((e) => e.needsReview && e.related && !e.hold)
    .sort((a, b) => byAsc<EmailRow>((e) => e.receivedAt)(a, b) || a.id - b.id);
  const judged: { row: EmailRow; msg: ReturnType<typeof messageFromRow>; cls: ReturnType<typeof p.classify> }[] = [];
  for (let i = 0; i < waiting.length; i++) {
    if (i && i % CLASSIFY_CHUNK === 0) await yieldToMain();
    const msg = messageFromRow(waiting[i]);
    const cls = p.classify(msg, learned);
    if (cls.related) judged.push({ row: waiting[i], msg, cls });
  }
  const settled = await tx(db, async () => {
    let n = 0;
    for (const { row: seen, msg, cls } of judged) {
      const row = await db.emails.get(seen.id);
      if (!row?.needsReview || !row.related || row.hold) continue; // you settled it while this ran
      const { appId, needsReview } = await decide(db, row.accountId, msg, cls, row.receivedAt);
      // Only a row that changed is written: every write makes the open pages read their data again.
      const same = row.event === cls.event && row.confidence === cls.confidence && row.reason === cls.reason && row.applicationId === appId && row.needsReview === needsReview;
      if (!same) await db.emails.update(row.id, { event: cls.event, confidence: cls.confidence, reason: cls.reason, applicationId: appId, needsReview });
      if (!needsReview) n++;
    }
    return n;
  });
  await db.settings.put({ key: SETTLE_MARK, value: await settleFingerprint(db) });
  return settled;
}

const SETTLE_MARK = "settleMark";

/**
 * What the last settle depended on besides new mail: every application's name, role, stage, lock and deleted state (a rename, a
 * restore, a merge or a stage change moves how waiting mail matches), which waiting mail is on hold, the rules in force and
 * how much mail waits. Unchanged since the last settle, and no new job mail, means judging the waiting mail again gives the same answers.
 */
async function settleFingerprint(db: JobTrackerDB): Promise<string> {
  const p = pipeline();
  const rules = (await db.learnedRules.toArray()).filter((r) => r.active).map((r) => r.id).sort((a, b) => a - b);
  const apps = (await db.applications.orderBy("id").toArray()).map((a) => [a.id, a.company, a.companyKey, a.role, a.roleKey, a.stage, a.locked, a.deletedAt ?? ""]);
  const waiting = await db.emails.where("review").equals(1).toArray();
  const held = waiting.filter((e) => e.hold).map((e) => e.id);
  return JSON.stringify([p.rulesVersion(), p.hashText(JSON.stringify(apps)), apps.length, rules, waiting.length, held.length, p.hashText(held.join(","))]);
}

/** Gives applications that have no role the one their saved emails name, now that the reader is better at finding it. */
export async function fillMissingRoles(db: JobTrackerDB): Promise<number> {
  const p = pipeline();
  return tx(db, async () => {
    let filled = 0;
    for (const app of (await db.applications.orderBy("id").toArray()).filter((a) => a.roleKey === "" && !a.manual && isLive(a))) {
      const mails = (await db.emails.where("applicationId").equals(app.id).toArray())
        .filter((e) => e.related)
        .sort((a, b) => byAsc<EmailRow>((e) => e.receivedAt)(a, b) || a.id - b.id);
      for (const row of mails) {
        const [, role] = p.extractCompanyRole(messageFromRow(row));
        if (role !== p.UNKNOWN_ROLE) {
          await db.applications.update(app.id, { role, roleKey: p.roleKey(role) });
          filled++;
          break;
        }
      }
    }
    return filled;
  });
}

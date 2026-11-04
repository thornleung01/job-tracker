// Re-run today's rules over the job mail already stored, and undo what the rules no longer believe (jobtracker/recheck.py).
//
// Emails the rules once took for application updates (a newsletter that said "interview") are turned back into
// ordinary mail and removed from Needs review. An application is only removed when nothing you did is attached to it:
// it was made by a sync, you never locked or edited its stage, and you added no notes or steps. Applications you made
// or touched are never changed.
import { applyEvent, clearEmail } from "../db/repo";
import { tx, type JobTrackerDB } from "../db/schema";
import { decide, messageFromRow, rememberIgnored } from "./decide";
import { loadLearned } from "./learn";
import { pipeline } from "./pipeline";

export interface RecheckResult {
  checked: number;
  cleared: number;
  removed: number;
  settled: number;
  roles: number;
}

/** True when no one has edited this application: a sync made it and only a sync has moved it. */
async function untouched(db: JobTrackerDB, appId: number | null): Promise<boolean> {
  if (appId == null) return true;
  const app = await db.applications.get(appId);
  if (!app) return true;
  const notes = await db.activity.where("applicationId").equals(appId).count();
  return !app.manual && !app.locked && notes === 0;
}

export async function recheck(db: JobTrackerDB, now: Date = new Date()): Promise<RecheckResult> {
  const rows = (await db.emails.orderBy("id").toArray()).filter((e) => e.related);
  const learned = await loadLearned(db);
  const p = pipeline();
  const cleared: number[] = [];
  const touched = new Set<number>();
  const why = new Map<number, string>();
  for (const row of rows) {
    const cls = p.classify(messageFromRow(row), learned);
    if (cls.related || !(await untouched(db, row.applicationId))) continue;
    cleared.push(row.id);
    if (cls.reason.startsWith("learned:")) why.set(row.id, cls.reason);
    if (row.applicationId) touched.add(row.applicationId);
  }

  let removed = 0;
  await tx(db, async () => {
    for (const row of rows) {
      const reason = why.get(row.id);
      if (reason === undefined) continue;
      // a learned rule did this: keep it restorable for a while
      const msg = messageFromRow(row);
      await rememberIgnored(
        db, row.accountId,
        { id: row.providerMsgId, threadId: row.threadId, senderName: msg.senderName, senderEmail: msg.senderEmail, subject: msg.subject,
          body: msg.body, webLink: row.webLink, bulk: row.bulk },
        row.receivedAt, reason, now,
      );
    }
    for (const id of cleared) await clearEmail(db, id); // the same as dismissing it in Needs review
    for (const appId of touched) {
      const left = (await db.emails.where("applicationId").equals(appId).toArray())
        .filter((e) => e.related)
        .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : a.id - b.id));
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
  return { checked: rows.length, cleared: cleared.length, removed, settled: await settleReview(db), roles: await fillMissingRoles(db) };
}

/** Deletes an application row together with what is keyed to it (the SQLite trigger and cascades). */
export async function removeApplicationRow(db: JobTrackerDB, appId: number): Promise<void> {
  await db.activity.where("applicationId").equals(appId).delete();
  await db.contactEdits.where("key").startsWith(`${appId}|`).delete();
  await db.feedback.where("applicationId").equals(appId).modify({ applicationId: null });
  await db.emails.where("applicationId").equals(appId).modify({ applicationId: null });
  await db.applications.delete(appId);
}

/**
 * Re-judge the emails waiting in Needs review with today's rules and today's applications. Many were unsure when they
 * arrived (there was no application for them yet) but belong to one now. Returns how many were settled.
 */
export async function settleReview(db: JobTrackerDB): Promise<number> {
  const learned = await loadLearned(db);
  const p = pipeline();
  return tx(db, async () => {
    let settled = 0;
    const waiting = (await db.emails.orderBy("receivedAt").toArray()).filter((e) => e.needsReview && e.related && !e.hold);
    for (const row of waiting) {
      const msg = messageFromRow(row);
      const cls = p.classify(msg, learned);
      if (!cls.related) continue;
      const { appId, needsReview } = await decide(db, row.accountId, msg, cls, row.receivedAt);
      await db.emails.update(row.id, { event: cls.event, confidence: cls.confidence, reason: cls.reason, applicationId: appId, needsReview });
      if (!needsReview) settled++;
    }
    return settled;
  });
}

/** Gives applications that have no role the one their saved emails name, now that the reader is better at finding it. */
export async function fillMissingRoles(db: JobTrackerDB): Promise<number> {
  const p = pipeline();
  return tx(db, async () => {
    let filled = 0;
    for (const app of (await db.applications.orderBy("id").toArray()).filter((a) => a.roleKey === "" && !a.manual)) {
      const mails = (await db.emails.where("applicationId").equals(app.id).toArray())
        .filter((e) => e.related)
        .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : a.id - b.id));
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

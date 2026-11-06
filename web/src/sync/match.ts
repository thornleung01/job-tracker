// Which application an email belongs to. The rules themselves are the golden-tested ones in pipeline/match.ts (the same
// function the fixtures run); this file only reads the database for them.
//
// Deleted applications (Recently deleted, see trash.ts) are kept apart: findApplication only ever sees live ones, so mail is
// never matched to, or merged into, an application you deleted. findDeletedApplication asks the same question of the deleted
// ones only. findApplicationOrDeleted puts the two together for decide.ts, with these rules:
//
//  1. A thread that belongs to a live application stays with it (the golden rule 1, as always).
//  2. A thread that belongs to a deleted application stays with it, even when another live application at the same company
//     would match by company and role. So a reply in a deleted application's thread never lands on a different live one.
//  3. Otherwise the golden company and role rules run over the live applications.
//  4. When they find nothing ("new", or "ambiguous" because the mail names no company), the same rules run over the deleted
//     applications, so follow-up mail (heard back, assessment, interview, offer, rejected) and mail with no decisive
//     event is kept with the deleted application: it comes back if you restore it and goes when it is erased, and it can
//     neither bring the application back nor start a duplicate of it.
//  5. EXCEPT an "applied" email ("we received your application"). That is the person applying again, so it is never kept
//     with a deleted application: rules 2 and 4 are skipped for it, and it starts a new live application (or joins a live
//     one by the golden rules). Keeping it with the deleted row would hide the new application and erase it at day 30.
import type { ApplicationRow, JobTrackerDB } from "../db/schema";
import type { EventName } from "../db/stages";
import { isLive } from "./live";
import { pipeline } from "./pipeline";
import type { Match } from "./pipelineTypes";

export type { Match };

export const sameRole = (aKey: string, bKey: string, aRole = "", bRole = ""): boolean => pipeline().sameRole(aKey, bKey, aRole, bRole);

/** The application the newest email in this thread that points at an application of the wanted kind belongs to. */
async function threadApplication(db: JobTrackerDB, accountId: number, threadId: string, deleted: boolean): Promise<number | null> {
  if (!threadId) return null;
  const rows = await db.emails.where("[accountId+threadId]").equals([accountId, threadId]).toArray();
  rows.sort((a, b) => (a.receivedAt === b.receivedAt ? b.id - a.id : a.receivedAt < b.receivedAt ? 1 : -1));
  for (const e of rows) {
    if (e.applicationId == null) continue;
    const app = await db.applications.get(e.applicationId);
    // An email whose application row is missing still counts as live: it is only ever matched to deleted ones on purpose.
    if ((app ? !isLive(app) : false) === deleted) return e.applicationId;
  }
  return null;
}

async function applicationsFor(db: JobTrackerDB, ckey: string, deleted: boolean): Promise<ApplicationRow[]> {
  const rows = await db.applications.where("companyKey").equals(ckey).toArray();
  return rows.filter((a) => isLive(a) !== deleted).sort((a, b) => a.id - b.id);
}

function find(
  db: JobTrackerDB, accountId: number, deleted: boolean, threadId: string, ckey: string, rkey: string, event: EventName | null, role: string,
): Promise<Match<number>> {
  return pipeline().findApplication(
    { threadApplication: (id) => threadApplication(db, accountId, id, deleted), applicationsFor: (key) => applicationsFor(db, key, deleted) },
    threadId, ckey, rkey, event, role,
  );
}

/** The live application an email belongs to. */
export function findApplication(
  db: JobTrackerDB, accountId: number, threadId: string, ckey: string, rkey: string,
  event: EventName | null = null, role = "",
): Promise<Match<number>> {
  return find(db, accountId, false, threadId, ckey, rkey, event, role);
}

/** The same question asked of deleted applications only. */
export function findDeletedApplication(
  db: JobTrackerDB, accountId: number, threadId: string, ckey: string, rkey: string,
  event: EventName | null = null, role = "",
): Promise<Match<number>> {
  return find(db, accountId, true, threadId, ckey, rkey, event, role);
}

/** True for the one event that starts something rather than adds to it. */
const startsApplication = (event: EventName | null): boolean => event === "applied";

/**
 * The application an email belongs to, live or deleted (rules in the header). A deleted application comes back as `matched`
 * like a live one, so the mail is kept with it; an "applied" email never gets one.
 */
export async function findApplicationOrDeleted(
  db: JobTrackerDB, accountId: number, threadId: string, ckey: string, rkey: string, event: EventName | null, role: string,
): Promise<Match<number>> {
  const live = await threadApplication(db, accountId, threadId, false);
  if (live != null) return { kind: "matched", applicationId: live };
  const reapplying = startsApplication(event);
  if (!reapplying) {
    const gone = await threadApplication(db, accountId, threadId, true);
    if (gone != null) return { kind: "matched", applicationId: gone };
  }
  // The thread has said all it can: from here on only the company and role rules (an empty thread id skips the thread step).
  const match = await findApplication(db, accountId, "", ckey, rkey, event, role);
  // "ambiguous" with no company is the one other answer a deleted application can improve on; ambiguity among live applications stays a question for you.
  if (!reapplying && (match.kind === "new" || (match.kind === "ambiguous" && !ckey))) {
    const gone = await findDeletedApplication(db, accountId, "", ckey, rkey, event, role);
    if (gone.kind === "matched") return gone;
  }
  return match;
}

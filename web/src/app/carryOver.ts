// Bringing the demo data over: before login the app stores everything in the one local database (LOCAL_DB_NAME). A
// signed-in person uses a per-user database, so that copy would be invisible. These functions read it, copy it across
// when the person asks, and delete it only when they confirm. Nothing here runs by itself.
import Dexie from "dexie";
import { LOCAL_DB_NAME } from "../config";
import { openDatabase, type JobTrackerDB } from "../db/schema";
import { exportAll, importAllIfEmpty } from "../portability";
import { isLive, liveApplications } from "../sync/live";

export type OpenDb = (name: string) => JobTrackerDB;

/**
 * Set once a bring-over has worked. The earlier copy belongs to nobody (it was saved before anyone logged in), so on a
 * shared browser it is offered to one account only. Holds no personal data.
 */
export const DONE_KEY = "jobtracker:carryover-done";

export function carryOverDone(): boolean {
  try {
    return window.localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return false;
  }
}

function markCarryOverDone(): void {
  try {
    window.localStorage.setItem(DONE_KEY, "1");
  } catch {
    // Storage can be blocked; the offer may then come back for another account.
  }
}

/** A bring-over that can't succeed however often it is retried. */
export class CarryOverError extends Error {
  constructor(message: string, name: string) {
    super(message);
    this.name = name;
  }
}

/** The account already has data. Importing replaces everything, so it is refused rather than merged. */
export class TargetNotEmptyError extends CarryOverError {
  constructor() {
    super("This account already has data, so nothing was copied.", "TargetNotEmptyError");
  }
}

/** The earlier copy is gone (removed in another tab) or has no applications. */
export class NothingToBringOverError extends CarryOverError {
  constructor() {
    super("There's nothing left to bring over. The earlier copy is no longer in this browser.", "NothingToBringOverError");
  }
}

/**
 * How many applications the local copy shows: the ones you haven't deleted, because this is the number the offer states
 * ("You have 3 applications saved in this browser"), and a copy that only holds Recently deleted applications has nothing
 * to offer. (A bring-over still copies the deleted ones along, like an export does.) Never creates the local database: a
 * missing one counts as 0.
 */
export async function localApplicationCount(open: OpenDb = openDatabase): Promise<number> {
  if (!(await Dexie.exists(LOCAL_DB_NAME))) return 0;
  const local = open(LOCAL_DB_NAME);
  try {
    return (await liveApplications(local)).length;
  } finally {
    local.close();
  }
}

/**
 * Copies the local database into `target` and returns how many applications came across (the ones you haven't deleted). The local copy is left as it
 * was. Throws TargetNotEmptyError if `target` holds anything at all (the check and the write are one transaction),
 * and NothingToBringOverError if the earlier copy is gone or has no applications. Opening a missing database would
 * create it, so its existence is checked right before opening.
 */
export async function bringOverLocalData(target: JobTrackerDB, open: OpenDb = openDatabase): Promise<number> {
  if (!(await Dexie.exists(LOCAL_DB_NAME))) throw new NothingToBringOverError();
  const local = open(LOCAL_DB_NAME);
  let count: number;
  try {
    const envelope = await exportAll(local);
    count = envelope.data.applications.filter(isLive).length;   // what the person will see, not the Recently deleted ones that come along
    if (count === 0) throw new NothingToBringOverError();
    if ((await importAllIfEmpty(target, envelope)) === null) throw new TargetNotEmptyError();
  } finally {
    local.close();
  }
  markCarryOverDone();
  return count;
}

/** Deletes the local database. Only call it after the person has confirmed. */
export async function removeLocalCopy(): Promise<void> {
  await Dexie.delete(LOCAL_DB_NAME);
}

// Bringing the demo data over: before login the app stores everything in the one local database (LOCAL_DB_NAME). A
// signed-in person uses a per-user database, so that copy would be invisible. These functions read it, copy it across
// when the person asks, and delete it only when they confirm. Nothing here runs by itself.
import Dexie from "dexie";
import { LOCAL_DB_NAME } from "../config";
import { openDatabase, type JobTrackerDB } from "../db/schema";
import { exportAll, importAll } from "../portability";

export type OpenDb = (name: string) => JobTrackerDB;

/** The account already has applications. Importing replaces everything, so it is refused rather than merged. */
export class TargetNotEmptyError extends Error {
  constructor() {
    super("This account already has applications, so nothing was copied.");
    this.name = "TargetNotEmptyError";
  }
}

/** How many applications the local copy holds. Never creates the local database: a missing one counts as 0. */
export async function localApplicationCount(open: OpenDb = openDatabase): Promise<number> {
  if (!(await Dexie.exists(LOCAL_DB_NAME))) return 0;
  const local = open(LOCAL_DB_NAME);
  try {
    return await local.applications.count();
  } finally {
    local.close();
  }
}

/**
 * Copies the local database into `target` and returns how many applications came across. The local copy is left as it
 * was. Throws TargetNotEmptyError if `target` has applications (checked again just before writing), because the import
 * replaces everything in it.
 */
export async function bringOverLocalData(target: JobTrackerDB, open: OpenDb = openDatabase): Promise<number> {
  if ((await target.applications.count()) > 0) throw new TargetNotEmptyError();
  const local = open(LOCAL_DB_NAME);
  try {
    const envelope = await exportAll(local);
    if ((await target.applications.count()) > 0) throw new TargetNotEmptyError();
    await importAll(target, envelope);
    return envelope.data.applications.length;
  } finally {
    local.close();
  }
}

/** Deletes the local database. Only call it after the person has confirmed. */
export async function removeLocalCopy(): Promise<void> {
  await Dexie.delete(LOCAL_DB_NAME);
}

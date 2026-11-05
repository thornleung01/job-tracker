import "fake-indexeddb/auto";
import type { Message } from "../../src/types";
import type { JobTrackerDB } from "../../src/db/schema";
import { createDbPool } from "../support/db";
import { upsertAccount } from "../../src/db/repo";

const pool = createDbPool("test");

/** A fresh, empty database with a unique name. */
export const freshDb = (): JobTrackerDB => pool.open();

export async function closeAll(): Promise<void> {
  pool.closeAll();
}

export async function dbWithAccount(): Promise<{ db: JobTrackerDB; acct: number }> {
  const db = freshDb();
  return { db, acct: await upsertAccount(db, "gmail", "me@gmail.com") };
}

/** A note on an application. The app can't write one any more, but imported data holds them, so tests seed the row directly. */
export async function seedNote(db: JobTrackerDB, applicationId: number, body: string, at = "2026-10-05T12:00:00Z"): Promise<void> {
  await db.activity.add({ applicationId, kind: "note", label: null, body, occurredAt: at, createdAt: at });
}

/** Like mk() in tests/test_pipeline.py: October 2026 at 09:00 UTC on `day`. */
export function mk(id: string, subject: string, body = "", sender = "Acme Careers <no-reply@greenhouse.io>", thread?: string, day = 1): Message {
  const [name, , rest] = [sender.split("<")[0], "<", sender.split("<")[1]];
  return {
    id, threadId: thread ?? id, senderName: name.trim(), senderEmail: (rest ?? "").replace(/>+$/, "").trim(), subject,
    receivedAt: new Date(Date.UTC(2026, 9, day, 9, 0)).toISOString(), body, webLink: null,
  };
}

/** Like mail() in the Python tests: noon on `day`, sender may be a bare address. */
export function mail(subject: string, body: string, sender: string, id = "m1", day = 1, thread?: string): Message {
  const hasName = sender.includes("<");
  const name = hasName ? sender.split("<")[0].trim() : "";
  const address = hasName ? sender.split("<")[1].replace(/>+$/, "") : sender;
  return {
    id, threadId: thread ?? id, senderName: name, senderEmail: address, subject,
    receivedAt: new Date(Date.UTC(2026, 9, day, 12, 0)).toISOString(), body, webLink: null,
  };
}

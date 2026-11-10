// Version 4: the `review`, `event` and [accountId+applicationId] indexes, the upgrade that fills `review`, and the hooks that keep it in step.
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/schema";
import { exportAll } from "../../src/portability";
import { reviewCount } from "../../src/sync/queries";
import { clearEmail } from "../../src/db/repo";
import { closeAll, freshDb } from "../sync/helpers";

afterEach(closeAll);

const MAIL = {
  accountId: 1, threadId: null, receivedAt: "2026-10-02T09:00:00Z", related: true, applicationId: null, subject: "Hello", sender: "jobs@acme.com", body: "Thanks",
  event: "applied" as const, confidence: "high" as const, reason: "", hold: false, bulk: false, webLink: null,
};

describe("upgrade from version 3 to 4", () => {
  it("keeps every email and marks exactly the ones waiting in Needs review", async () => {
    const name = `v3-${Date.now()}`;
    const old = new Dexie(name);
    old.version(1).stores({
      accounts: "++id, &[provider+address]",
      applications: "++id, companyKey, stage, lastActivity",
      emails: "++id, &[accountId+providerMsgId], [accountId+threadId], applicationId, receivedAt",
      activity: "++id, applicationId",
      feedback: "++id, applicationId",
      ignoredMail: "++id, &[accountId+providerMsgId], createdAt",
      learnedRules: "++id, &[kind+value]",
      contactEdits: "key",
      settings: "key",
    });
    old.version(2).stores({});
    old.version(3).stores({ documents: "++id, kind, applicationId" });
    await old.table("emails").bulkAdd([
      { ...MAIL, providerMsgId: "a", needsReview: true },
      { ...MAIL, providerMsgId: "b", needsReview: false, applicationId: 1, event: "interview" },
      { ...MAIL, providerMsgId: "c", needsReview: true },
    ]);
    old.close();

    const db = openDatabase(name);
    try {
      expect(db.verno).toBe(4);
      expect(await db.emails.count()).toBe(3);
      expect(await reviewCount(db)).toBe(2);
      expect((await db.emails.where("review").equals(1).toArray()).map((e) => e.providerMsgId)).toEqual(["a", "c"]);
      expect((await db.emails.where("event").equals("interview").toArray()).map((e) => e.providerMsgId)).toEqual(["b"]);
      expect(await db.emails.where("[accountId+applicationId]").equals([1, 1]).count()).toBe(1);
    } finally {
      db.close();
      await Dexie.delete(name);
    }
  });
});

describe("the review marker", () => {
  it("follows needsReview whichever way the email is written", async () => {
    const db = freshDb();
    const waiting = await db.emails.add({ ...MAIL, providerMsgId: "a", needsReview: true });
    const plain = await db.emails.add({ ...MAIL, providerMsgId: "b", needsReview: false });
    expect(await reviewCount(db)).toBe(1);
    await db.emails.update(plain, { needsReview: true });
    expect(await reviewCount(db)).toBe(2);
    await db.emails.update(waiting, { needsReview: false, applicationId: 5 });
    expect(await reviewCount(db)).toBe(1);
    await clearEmail(db, plain);
    expect(await reviewCount(db)).toBe(0);
    expect((await db.emails.get(plain))!.review).toBeUndefined();
    await db.emails.bulkAdd([{ ...MAIL, providerMsgId: "c", needsReview: true }, { ...MAIL, providerMsgId: "d", needsReview: true }]);
    expect(await reviewCount(db)).toBe(2);
  });

  it("is left out of an export", async () => {
    const db = freshDb();
    await db.emails.add({ ...MAIL, providerMsgId: "a", needsReview: true });
    const { data } = await exportAll(db);
    expect(data.emails).toHaveLength(1);
    expect("review" in data.emails[0]).toBe(false);
  });
});

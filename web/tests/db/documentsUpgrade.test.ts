// A version 2 database (before documents) opens at version 3 with every row intact and an empty, working documents table.
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/schema";

const APP = {
  company: "Acme", companyKey: "acme", role: "Analyst", roleKey: "analyst", stage: "Applied", stageAt: "2026-10-01T09:00:00Z",
  appliedAt: "2026-10-01T09:00:00Z", lastActivity: "2026-10-01T09:00:00Z", locked: false, manual: false,
};

describe("upgrade from version 2 to 3", () => {
  it("keeps every row, adds an empty documents table and answers its indexed queries", async () => {
    const name = `v2-${Date.now()}`;
    const old = new Dexie(name);
    const stores = {
      accounts: "++id, &[provider+address]",
      applications: "++id, companyKey, stage, lastActivity",
      emails: "++id, &[accountId+providerMsgId], [accountId+threadId], applicationId, receivedAt",
      activity: "++id, applicationId",
      feedback: "++id, applicationId",
      ignoredMail: "++id, &[accountId+providerMsgId], createdAt",
      learnedRules: "++id, &[kind+value]",
      contactEdits: "key",
      settings: "key",
    };
    old.version(1).stores(stores);
    old.version(2).stores({});
    await old.table("applications").bulkAdd([
      { ...APP, postingUrl: "https://example.com/acme" },
      { ...APP, company: "Beta", companyKey: "beta" },
    ]);
    await old.table("emails").add({
      accountId: 1, providerMsgId: "m1", threadId: "t1", receivedAt: "2026-10-02T09:00:00Z", related: true, needsReview: false, applicationId: 1,
      subject: "Hello", sender: "jobs@acme.com", body: "Thanks", event: "applied", confidence: "high", reason: "", hold: false, bulk: false, webLink: null,
    });
    await old.table("activity").add({ applicationId: 1, kind: "note", label: null, body: "Called", occurredAt: "2026-10-03T09:00:00Z", createdAt: "2026-10-03T09:00:00Z" });
    old.close();

    const db = openDatabase(name);
    try {
      expect(db.verno).toBe(4);
      const apps = await db.applications.orderBy("id").toArray();
      expect(apps.map((a) => a.company)).toEqual(["Acme", "Beta"]);
      expect(apps[0].postingUrl).toBe("https://example.com/acme");
      expect("postingUrl" in apps[1]).toBe(false);
      expect(apps.every((a) => !("resumeId" in a) && !("postingText" in a))).toBe(true);
      expect(await db.emails.count()).toBe(1);
      expect((await db.activity.toArray()).map((r) => r.body)).toEqual(["Called"]);

      expect(await db.documents.count()).toBe(0);
      const at = "2026-11-01T09:00:00Z";
      const resume = await db.documents.add({ kind: "resume", master: true, applicationId: null, title: "Master resume", sections: [], createdAt: at, updatedAt: at });
      const cover = await db.documents.add({ kind: "cover", master: false, applicationId: 1, title: "Cover letter", sections: [], createdAt: at, updatedAt: at });
      expect((await db.documents.where("kind").equals("resume").toArray()).map((d) => d.id)).toEqual([resume]);
      expect((await db.documents.where("kind").equals("cover").toArray()).map((d) => d.id)).toEqual([cover]);
      expect((await db.documents.where("applicationId").equals(1).toArray()).map((d) => d.id)).toEqual([cover]);
      expect(await db.documents.where("applicationId").equals(2).count()).toBe(0);
    } finally {
      db.close();
      await Dexie.delete(name);
    }
  });
});

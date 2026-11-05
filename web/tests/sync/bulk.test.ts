import { afterEach, describe, expect, it, vi } from "vitest";
import { addApp, addMail, cleanup, freshDb } from "../pages/applications/harness";
import { upsertAccount } from "../../src/db/repo";
import type { Stage } from "../../src/db/stages";
import { BULK_MAX, bulkDelete, bulkSetStage } from "../../src/sync/bulk";

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup();
});

const stages = async (db: ReturnType<typeof freshDb>, ids: number[]) => Promise.all(ids.map(async (id) => (await db.applications.get(id))?.stage));

describe("bulkSetStage", () => {
  it("sets the stage on each application and locks it, and says how many changed", async () => {
    const db = freshDb();
    const a = await addApp(db, "Acme", { stage: "Applied" });
    const b = await addApp(db, "Beta", { stage: "Rejected", locked: true });
    const c = await addApp(db, "Gamma", { stage: "Applied" });
    expect(await bulkSetStage(db, [a, b], "Interview", new Date("2026-10-30T12:00:00Z"))).toBe(2);
    const rows = await Promise.all([a, b, c].map((id) => db.applications.get(id)));
    expect(rows.map((r) => [r?.stage, r?.locked])).toEqual([["Interview", true], ["Interview", true], ["Applied", false]]);
    expect(rows[0]?.stageAt).toBe("2026-10-30T12:00:00Z");
  });

  it("skips ids that no longer exist and counts each application once", async () => {
    const db = freshDb();
    const a = await addApp(db, "Acme");
    expect(await bulkSetStage(db, [a, a, 9999, -1, 1.5], "Offer")).toBe(1);
    expect(await stages(db, [a])).toEqual(["Offer"]);
  });

  it("does nothing for an empty list", async () => {
    const db = freshDb();
    const a = await addApp(db, "Acme");
    expect(await bulkSetStage(db, [], "Offer")).toBe(0);
    expect(await stages(db, [a])).toEqual(["Applied"]);
  });

  it("refuses an unknown stage and a list over the cap, changing nothing", async () => {
    const db = freshDb();
    const a = await addApp(db, "Acme");
    await expect(bulkSetStage(db, [a], "Hired" as Stage)).rejects.toThrow(/stage/i);
    await expect(bulkSetStage(db, Array.from({ length: BULK_MAX + 1 }, (_, i) => i + 1), "Offer")).rejects.toThrow(/500/);
    expect(await bulkSetStage(db, Array.from({ length: BULK_MAX }, (_, i) => i + 1000), "Offer")).toBe(0);
    expect(await stages(db, [a])).toEqual(["Applied"]);
  });

  it("is all or nothing: a failure part way puts the first ones back", async () => {
    const db = freshDb();
    const ids = [await addApp(db, "Acme"), await addApp(db, "Beta"), await addApp(db, "Gamma")];
    const real = db.applications.update.bind(db.applications);
    let calls = 0;
    vi.spyOn(db.applications, "update").mockImplementation(((...args: Parameters<typeof real>) => {
      if (++calls === 2) throw new Error("disk full");
      return real(...args);
    }) as never);
    await expect(bulkSetStage(db, ids, "Offer")).rejects.toThrow("disk full");
    vi.restoreAllMocks();
    expect(await stages(db, ids)).toEqual(["Applied", "Applied", "Applied"]);
    expect((await db.applications.get(ids[0]))?.locked).toBe(false);
  });
});

describe("bulkDelete", () => {
  it("deletes the applications and clears their emails, and leaves the others alone", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const a = await addApp(db, "Acme");
    const b = await addApp(db, "Beta");
    const keep = await addApp(db, "Keep");
    const mailA = await addMail(db, account, a);
    const mailB = await addMail(db, account, b);
    const mailKeep = await addMail(db, account, keep);
    await db.activity.add({ applicationId: a, kind: "note", label: null, body: "Called", occurredAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" });
    expect(await bulkDelete(db, [a, b])).toBe(2);
    expect((await db.applications.toArray()).map((x) => x.id)).toEqual([keep]);
    for (const id of [mailA, mailB]) {
      const mail = await db.emails.get(id);
      expect([mail?.applicationId, mail?.subject, mail?.body, mail?.related]).toEqual([null, null, null, false]);
    }
    expect((await db.emails.get(mailKeep))?.applicationId).toBe(keep);
    expect(await db.activity.count()).toBe(0);
  });

  it("skips ids that no longer exist and does nothing for an empty list", async () => {
    const db = freshDb();
    const a = await addApp(db, "Acme");
    expect(await bulkDelete(db, [])).toBe(0);
    expect(await bulkDelete(db, [9999, a, a])).toBe(1);
    expect(await db.applications.count()).toBe(0);
  });

  it("refuses a list over the cap, deleting nothing", async () => {
    const db = freshDb();
    await addApp(db, "Acme");
    await expect(bulkDelete(db, Array.from({ length: BULK_MAX + 1 }, (_, i) => i + 1))).rejects.toThrow(/500/);
    expect(await db.applications.count()).toBe(1);
  });

  it("is all or nothing: a failure part way keeps every application and email", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const ids = [await addApp(db, "Acme"), await addApp(db, "Beta")];
    const mails = [await addMail(db, account, ids[0]), await addMail(db, account, ids[1])];
    const real = db.applications.delete.bind(db.applications);
    let calls = 0;
    vi.spyOn(db.applications, "delete").mockImplementation(((...args: Parameters<typeof real>) => {
      if (++calls === 2) throw new Error("disk full");
      return real(...args);
    }) as never);
    await expect(bulkDelete(db, ids)).rejects.toThrow("disk full");
    vi.restoreAllMocks();
    expect(await db.applications.count()).toBe(2);
    expect((await Promise.all(mails.map((id) => db.emails.get(id)))).map((m) => [m?.applicationId, m?.subject !== null])).toEqual([[ids[0], true], [ids[1], true]]);
  });
});

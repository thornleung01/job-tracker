import { afterEach, describe, expect, it, vi } from "vitest";
import { addApp, addMail, cleanup, freshDb } from "../pages/applications/harness";
import { upsertAccount } from "../../src/db/repo";
import type { Stage } from "../../src/db/stages";
import { setStage } from "../../src/sync/actions";
import { BULK_MAX, bulkDelete, bulkRestore, bulkRestoreStages, bulkSetStage } from "../../src/sync/bulk";

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup();
});

/** `count` real applications, added in one go. Returns their ids. */
async function seedMany(db: ReturnType<typeof freshDb>, count: number): Promise<number[]> {
  const first = await addApp(db, "Row 0");
  const { id: _id, ...rest } = (await db.applications.get(first))!;
  const more = await db.applications.bulkAdd(Array.from({ length: count - 1 }, (_, i) => ({ ...rest, company: `Row ${i + 1}`, companyKey: `row${i + 1}` })) as never, { allKeys: true });
  return [first, ...(more as number[])];
}

/** How many applications are live (not in Recently deleted). */
const liveCount = async (db: ReturnType<typeof freshDb>) => (await db.applications.toArray()).filter((a) => !a.deletedAt).length;

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

  it("writes the same fields as setStage", async () => {
    const db = freshDb();
    const a = await addApp(db, "Acme", { stage: "Applied" });
    const b = await addApp(db, "Beta", { stage: "Applied" });
    const now = new Date("2026-10-30T12:00:00Z");
    await bulkSetStage(db, [a], "Interview", now);
    await setStage(db, b, "Interview", now);
    const [x, y] = await Promise.all([a, b].map((id) => db.applications.get(id)));
    expect([x?.stage, x?.stageAt, x?.locked]).toEqual([y?.stage, y?.stageAt, y?.locked]);
  });

  it("changes exactly 500 real applications in one call", async () => {
    const db = freshDb();
    const ids = await seedMany(db, BULK_MAX);
    expect(await bulkSetStage(db, ids, "Offer")).toBe(BULK_MAX);
    expect(await db.applications.where("stage").equals("Offer").count()).toBe(BULK_MAX);
  });

  it("skips NaN, Infinity and fractions, and counts only the real application", async () => {
    const db = freshDb();
    const a = await addApp(db, "Acme");
    expect(await bulkSetStage(db, [NaN, Infinity, -Infinity, 0.5, a, 2.5], "Offer")).toBe(1);
    expect(await stages(db, [a])).toEqual(["Offer"]);
  });

  it("refuses 501 distinct ids and changes nothing, even when some are real", async () => {
    const db = freshDb();
    const a = await addApp(db, "Acme");
    const ids = [a, ...Array.from({ length: BULK_MAX }, (_, i) => i + 5000)];
    await expect(bulkSetStage(db, ids, "Offer")).rejects.toThrow(/500/);
    expect(await stages(db, [a])).toEqual(["Applied"]);
    expect((await db.applications.get(a))?.locked).toBe(false);
  });

  it("is all or nothing: a failure inside the transaction changes nothing", async () => {
    const db = freshDb();
    const ids = [await addApp(db, "Acme"), await addApp(db, "Beta"), await addApp(db, "Gamma")];
    vi.spyOn(db.applications, "where").mockImplementationOnce(() => { throw new Error("boom"); });
    await expect(bulkSetStage(db, ids, "Offer")).rejects.toThrow("boom");
    vi.restoreAllMocks();
    expect(await stages(db, ids)).toEqual(["Applied", "Applied", "Applied"]);
    expect((await db.applications.get(ids[0]))?.locked).toBe(false);
  });
});

describe("bulkRestoreStages", () => {
  it("puts back each stage, stamp and lock exactly, in one call", async () => {
    const db = freshDb();
    const a = await addApp(db, "Acme", { stage: "Applied" });
    const b = await addApp(db, "Beta", { stage: "Rejected", locked: true });
    await db.applications.update(b, { stageAt: "2026-01-01T00:00:00Z" });
    const before = await Promise.all([a, b].map(async (id) => { const r = (await db.applications.get(id))!; return { id, stage: r.stage, stageAt: r.stageAt, locked: r.locked }; }));
    await bulkSetStage(db, [a, b], "Offer");
    expect(await bulkRestoreStages(db, before)).toBe(2);
    const after = await Promise.all([a, b].map((id) => db.applications.get(id)));
    expect(after.map((r) => ({ id: r?.id, stage: r?.stage, stageAt: r?.stageAt, locked: r?.locked }))).toEqual(before);
  });

  it("skips ids that are gone, and ids that aren't whole numbers", async () => {
    const db = freshDb();
    const a = await addApp(db, "Acme");
    const was = { stage: "Rejected" as Stage, stageAt: null, locked: false };
    expect(await bulkRestoreStages(db, [{ id: a, ...was }, { id: 9999, ...was }, { id: NaN, ...was }, { id: 1.5, ...was }])).toBe(1);
    expect(await stages(db, [a])).toEqual(["Rejected"]);
    expect(await bulkRestoreStages(db, [])).toBe(0);
  });

  it("refuses an unknown stage or more than 500, changing nothing", async () => {
    const db = freshDb();
    const a = await addApp(db, "Acme");
    const was = { stage: "Offer" as Stage, stageAt: null, locked: true };
    await expect(bulkRestoreStages(db, [{ id: a, ...was }, { id: a + 1, ...was, stage: "Hired" as Stage }])).rejects.toThrow(/stage/i);
    await expect(bulkRestoreStages(db, [{ id: a, ...was }, ...Array.from({ length: BULK_MAX }, (_, i) => ({ id: i + 5000, ...was }))])).rejects.toThrow(/500/);
    expect(await stages(db, [a])).toEqual(["Applied"]);
  });

  it("is all or nothing", async () => {
    const db = freshDb();
    const ids = [await addApp(db, "Acme"), await addApp(db, "Beta")];
    const real = db.applications.update.bind(db.applications);
    let calls = 0;
    vi.spyOn(db.applications, "update").mockImplementation(((...args: Parameters<typeof real>) => {
      if (++calls === 2) throw new Error("disk full");
      return real(...args);
    }) as never);
    await expect(bulkRestoreStages(db, ids.map((id) => ({ id, stage: "Offer" as Stage, stageAt: null, locked: true })))).rejects.toThrow("disk full");
    vi.restoreAllMocks();
    expect(await stages(db, ids)).toEqual(["Applied", "Applied"]);
  });
});

describe("bulkDelete", () => {
  it("moves the applications to Recently deleted with their emails and notes kept, and leaves the others alone", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const a = await addApp(db, "Acme");
    const b = await addApp(db, "Beta");
    const keep = await addApp(db, "Keep");
    const mailA = await addMail(db, account, a);
    const mailB = await addMail(db, account, b);
    const mailKeep = await addMail(db, account, keep);
    const note = (applicationId: number) => ({ applicationId, kind: "note" as const, label: null, body: "Called", occurredAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" });
    await db.activity.bulkAdd([note(a), note(a), note(b), note(keep)]);
    expect(await bulkDelete(db, [a, b], new Date("2026-10-30T12:00:00Z"))).toBe(2);
    expect((await db.applications.toArray()).filter((x) => !x.deletedAt).map((x) => x.id)).toEqual([keep]);
    expect((await db.applications.toArray()).filter((x) => x.deletedAt).map((x) => [x.id, x.deletedAt])).toEqual([[a, "2026-10-30T12:00:00Z"], [b, "2026-10-30T12:00:00Z"]]);
    for (const [id, app] of [[mailA, a], [mailB, b]] as const) {
      const mail = await db.emails.get(id);
      expect([mail?.applicationId, mail?.subject, mail?.related]).toEqual([app, "We got your application", true]);
    }
    expect((await db.emails.get(mailKeep))?.applicationId).toBe(keep);
    expect((await db.activity.toArray()).map((x) => x.applicationId)).toEqual([a, a, b, keep]);
  });

  it("is undone by bulkRestore, which brings back the same ids with their emails and notes, and skips live and erased ids", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const a = await addApp(db, "Acme");
    const b = await addApp(db, "Beta");
    const live = await addApp(db, "Live");
    const mail = await addMail(db, account, a);
    await bulkDelete(db, [a, b]);
    expect(await liveCount(db)).toBe(1);
    expect(await bulkRestore(db, [])).toBe(0);
    expect(await bulkRestore(db, [a, b, live, 9999, NaN, a])).toBe(2);
    expect(await liveCount(db)).toBe(3);
    expect((await db.applications.get(a))).not.toHaveProperty("deletedAt");
    expect((await db.emails.get(mail))?.applicationId).toBe(a);
    expect(await bulkRestore(db, [a])).toBe(0);
  });

  it("treats a deleted application as no such application for the other bulk actions", async () => {
    const db = freshDb();
    const a = await addApp(db, "Acme", { stage: "Applied" });
    const b = await addApp(db, "Beta", { stage: "Applied" });
    await bulkDelete(db, [a]);
    expect(await bulkDelete(db, [a])).toBe(0);
    expect(await bulkSetStage(db, [a, b], "Offer")).toBe(1);
    expect(await stages(db, [a, b])).toEqual(["Applied", "Offer"]);
    expect(await bulkRestoreStages(db, [{ id: a, stage: "Rejected", stageAt: null, locked: true }])).toBe(0);
    expect(await stages(db, [a])).toEqual(["Applied"]);
  });

  it("deletes exactly 500 real applications in one call", async () => {
    const db = freshDb();
    const ids = await seedMany(db, BULK_MAX);
    expect(await bulkDelete(db, ids)).toBe(BULK_MAX);
    expect(await liveCount(db)).toBe(0);
  });

  it("skips NaN, Infinity and fractions", async () => {
    const db = freshDb();
    const a = await addApp(db, "Acme");
    expect(await bulkDelete(db, [NaN, Infinity, 0.5, a, a + 0.5])).toBe(1);
    expect(await liveCount(db)).toBe(0);
  });

  it("refuses 501 distinct ids and deletes nothing, even when some are real", async () => {
    const db = freshDb();
    const a = await addApp(db, "Acme");
    await expect(bulkDelete(db, [a, ...Array.from({ length: BULK_MAX }, (_, i) => i + 5000)])).rejects.toThrow(/500/);
    expect(await db.applications.count()).toBe(1);
  });

  it("skips ids that no longer exist and does nothing for an empty list", async () => {
    const db = freshDb();
    const a = await addApp(db, "Acme");
    expect(await bulkDelete(db, [])).toBe(0);
    expect(await bulkDelete(db, [9999, a, a])).toBe(1);
    expect(await liveCount(db)).toBe(0);
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
    const real = db.applications.update.bind(db.applications);
    let calls = 0;
    vi.spyOn(db.applications, "update").mockImplementation(((...args: Parameters<typeof real>) => {
      if (++calls === 2) throw new Error("disk full");
      return real(...args);
    }) as never);
    await expect(bulkDelete(db, ids)).rejects.toThrow("disk full");
    vi.restoreAllMocks();
    expect(await liveCount(db)).toBe(2);
    expect((await Promise.all(mails.map((id) => db.emails.get(id)))).map((m) => [m?.applicationId, m?.subject !== null])).toEqual([[ids[0], true], [ids[1], true]]);
  });
});

// Port of tests/test_activity.py (the non-web parts).
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityError, MissingRecordError, STEP_GROUPS, addNote, addStep, deleteEntry, history } from "../../src/sync/activity";
import { applyEvent, createApplication, upsertAccount } from "../../src/db/repo";
import { STAGES } from "../../src/db/stages";
import { iso, localToday } from "../../src/db/time";
import { processMessages } from "../../src/sync/sync";
import { mergeApplications, deleteApplication } from "../../src/sync/actions";
import { closeAll, dbWithAccount, freshDb, mk } from "./helpers";

afterEach(closeAll);

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
function day(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localToday(d);
}

async function makeApp(db: ReturnType<typeof freshDb>, o: { stage?: "Applied" | "Rejected" | "Interview"; applied?: number; stageAgo?: number; company?: string } = {}) {
  const company = o.company ?? "Acme";
  const id = await createApplication(db, {
    company, companyKey: company.toLowerCase(), role: "Analyst", roleKey: "analyst", stage: o.stage ?? "Applied", when: iso(daysAgo(o.applied ?? 10)),
  });
  if (o.stageAgo !== undefined) await db.applications.update(id, { stageAt: iso(daysAgo(o.stageAgo)) });
  return id;
}

describe("notes", () => {
  it("validates and trims", async () => {
    const db = freshDb();
    const a = await makeApp(db);
    for (const bad of ["", "   \n ", null]) await expect(addNote(db, a, bad)).rejects.toThrow(/Write a note/);
    await expect(addNote(db, a, "x".repeat(2001))).rejects.toThrow(/2000/);
    const before = (await db.applications.get(a))!.lastActivity!;
    await addNote(db, a, "  Spoke to Sam, send CV Friday  ");
    const row = (await db.activity.toArray())[0];
    expect([row.kind, row.body]).toEqual(["note", "Spoke to Sam, send CV Friday"]);
    expect((await db.applications.get(a))!.lastActivity! > before).toBe(true);
  });

  it("throws MissingRecordError for a missing application", async () => {
    const db = freshDb();
    await expect(addNote(db, 999, "hi")).rejects.toBeInstanceOf(MissingRecordError);
    await expect(addStep(db, 999, "Interview")).rejects.toBeInstanceOf(MissingRecordError);
  });
});

describe("steps", () => {
  it("validates the label and the date, saving nothing half-done", async () => {
    const db = freshDb();
    const a = await makeApp(db);
    for (const bad of ["   ", "", null, "Coffee chat", "x".repeat(61), "Interview; DROP TABLE activity"]) {
      await expect(addStep(db, a, bad)).rejects.toThrow(/Choose a step from the list/);
    }
    await expect(addStep(db, a, "Phone screen", "21/10/2026")).rejects.toThrow(/year-month-day/);
    await expect(addStep(db, a, "Phone screen", day(-1))).rejects.toThrow(/future/);
    await expect(addStep(db, a, "Phone screen", "2026-02-30")).rejects.toBeInstanceOf(ActivityError);
    expect(await db.activity.count()).toBe(0);
  });

  it("moves forward without locking", async () => {
    const db = freshDb();
    const a = await makeApp(db);
    expect(await addStep(db, a, "  interview ", day(3))).toBe(true);
    const row = (await db.applications.get(a))!;
    expect([row.stage, row.locked]).toEqual(["Interview", false]);
    expect(row.stageAt!.startsWith(day(3))).toBe(true);
    expect(row.lastActivity!.startsWith(day(3))).toBe(true);
    expect((await db.activity.toArray())[0].label).toBe("Interview");
  });

  it("can move backwards when newer", async () => {
    const db = freshDb();
    const a = await makeApp(db, { stage: "Rejected", stageAgo: 5 });
    expect(await addStep(db, a, "Interview", day(0), "Rejection was a mistake")).toBe(true);
    expect((await db.applications.get(a))!.stage).toBe("Interview");
  });

  it("treats an older date as history only", async () => {
    const db = freshDb();
    const a = await makeApp(db, { stage: "Interview", stageAgo: 2 });
    expect(await addStep(db, a, "Heard back", day(8))).toBe(false);
    expect((await db.applications.get(a))!.stage).toBe("Interview");
    expect(await db.activity.count()).toBe(1);
  });

  it("backfills the applied date", async () => {
    const db = freshDb();
    const a = await makeApp(db, { applied: 3 });
    await addStep(db, a, "Applied", day(9));
    expect((await db.applications.get(a))!.appliedAt!.startsWith(day(9))).toBe(true);
  });

  it("keeps the stage for a custom label but counts it as activity", async () => {
    const db = freshDb();
    const a = await makeApp(db);
    expect(await addStep(db, a, "Phone   screen", day(1), "30 min with Sam")).toBe(false);
    const row = (await db.applications.get(a))!;
    expect(row.stage).toBe("Applied");
    expect(row.lastActivity!.startsWith(day(1))).toBe(true);
    const step = (await db.activity.toArray())[0];
    expect([step.label, step.body]).toEqual(["Phone screen", "30 min with Sam"]);
  });

  it("accepts only presets, in canonical wording", async () => {
    const db = freshDb();
    const a = await makeApp(db);
    const every = STEP_GROUPS.flatMap((g) => [...g.steps]);
    expect(every.slice(0, 6)).toEqual([...STAGES]);
    expect(new Set(every).size).toBe(every.length);
    for (const label of every) await addStep(db, a, label.toUpperCase(), day(1));
    expect((await db.activity.orderBy("id").toArray()).map((r) => r.label)).toEqual(every);
  });

  it("lets a later email move a step-logged stage forward", async () => {
    const db = freshDb();
    const a = await makeApp(db);
    await addStep(db, a, "Heard back", day(0));
    expect(await applyEvent(db, a, "interview", iso(new Date(Date.now() + 3_600_000)))).toBe(true);
    expect((await db.applications.get(a))!.stage).toBe("Interview");
  });
});

describe("deleting and history", () => {
  it("keeps a stage change when its step is deleted, and refuses another application's entry", async () => {
    const db = freshDb();
    const a = await makeApp(db);
    await addStep(db, a, "Interview", day(1));
    const stepId = (await db.activity.toArray())[0].id;
    expect(await deleteEntry(db, a, stepId)).toBe(true);
    expect((await db.applications.get(a))!.stage).toBe("Interview");
    expect(await deleteEntry(db, a, stepId)).toBe(false);
    const other = await makeApp(db, { company: "Initech" });
    await addNote(db, other, "mine");
    expect(await deleteEntry(db, a, (await db.activity.toArray())[0].id)).toBe(false);
  });

  it("merges emails and notes newest first, with a limit", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessages(db, acct, [mk("e1", "Thank you for applying to Acme", "", undefined, undefined, 1)]);
    const a = (await db.applications.toArray())[0].id;
    await addNote(db, a, "latest note");
    let h = await history(db, a);
    expect(h.items.map((e) => e.kind)).toEqual(["note", "email"]);
    expect(h.total).toBe(2);
    expect([h.items[1].title, h.items[1].detail]).toEqual(["Thank you for applying to Acme", "applied"]);
    h = await history(db, a, 20, false);
    expect(h.items.map((e) => e.kind)).toEqual(["note"]);
    for (let i = 0; i < 5; i++) await addNote(db, a, `n${i}`);
    h = await history(db, a, 3);
    expect([h.items.length, h.total]).toEqual([3, 7]);
  });

  it("moves notes on a merge and removes them on a delete", async () => {
    const db = freshDb();
    const a = await makeApp(db);
    const b = await makeApp(db, { company: "Acme Inc" });
    await addNote(db, a, "on a");
    await addNote(db, b, "on b");
    await mergeApplications(db, a, b);
    expect(new Set((await db.activity.where("applicationId").equals(b).toArray()).map((r) => r.body))).toEqual(new Set(["on a", "on b"]));
    await deleteApplication(db, b);
    expect(await db.activity.count()).toBe(0);
  });
});

it("two accounts keep their own mailbox links", async () => {
  const db = freshDb();
  const g = await upsertAccount(db, "gmail", "me@gmail.com");
  await processMessages(db, g, [mk("e1", "Thank you for applying to Acme", "", undefined, "thr1", 1)]);
  const a = (await db.applications.toArray())[0].id;
  const email = (await history(db, a)).items.find((i) => i.kind === "email")!;
  expect(email.open?.url).toBe("https://mail.google.com/mail/?authuser=me%40gmail.com#all/thr1");
  expect(email.account).toBe("Gmail me@gmail.com");
});

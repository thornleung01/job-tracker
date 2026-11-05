import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication } from "../../src/db/repo";
import { STAGES, type Stage } from "../../src/db/stages";
import { iso } from "../../src/db/time";
import { FOLLOW_UP_DAYS, needsFollowUp } from "../../src/sync/followUp";
import { listApplications, stageCounts } from "../../src/sync/queries";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

// the app tsconfig has no Node types; the tests run in Node
declare const process: { env: Record<string, string | undefined> };

describe("needsFollowUp", () => {
  it("waits a week", () => {
    expect(FOLLOW_UP_DAYS).toBe(7);
  });

  it.each(["Applied", "Heard back"] as Stage[])("%s needs one at 7 days but not at 6", (stage) => {
    expect(needsFollowUp(stage, 6)).toBe(false);
    expect(needsFollowUp(stage, 7)).toBe(true);
    expect(needsFollowUp(stage, 30)).toBe(true);
    expect(needsFollowUp(stage, 0)).toBe(false);
  });

  it.each(["Assessment", "Interview", "Offer", "Rejected"] as Stage[])("%s never needs one", (stage) => {
    for (const days of [0, 6, 7, 400]) expect(needsFollowUp(stage, days)).toBe(false);
  });

  it("never needs one when the last activity is unknown", () => {
    for (const stage of STAGES) expect(needsFollowUp(stage, null)).toBe(false);
  });
});

describe("the follow-up filter", () => {
  // Not exactly 12:00:00Z: that time is read as a day someone picked (db/time.ts), which is the same day in every zone and would
  // make "6 days ago" 7 calendar days in zones east of UTC+12.
  const NOW = new Date("2026-11-05T12:30:00Z");
  const ago = (days: number) => iso(new Date(NOW.getTime() - days * 86_400_000));

  async function seed() {
    const db = freshDb();
    const add = async (company: string, stage: Stage, last: number | null, locked = false) => {
      const id = await createApplication(db, { company, companyKey: company.toLowerCase(), role: "Analyst", roleKey: "analyst", stage, when: ago(30) });
      await db.applications.update(id, { lastActivity: last === null ? null : ago(last), locked });
    };
    await add("Quiet applied", "Applied", 7);
    await add("Fresh applied", "Applied", 6);
    await add("Quiet heard", "Heard back", 20);
    await add("Quiet by hand", "Applied", 9, true);
    await add("Quiet interview", "Interview", 40);
    await add("Quiet rejected", "Rejected", 40);
    await add("Quiet offer", "Offer", 40);
    await add("Quiet assessment", "Assessment", 40);
    await add("Unknown", "Applied", null);
    return db;
  }
  const names = async (db: Awaited<ReturnType<typeof seed>>, q: Parameters<typeof listApplications>[1] = {}) =>
    (await listApplications(db, { now: NOW, sort: "company", dir: "asc", ...q })).map((r) => r.company);

  it("flags each row on its own stage and idle days", async () => {
    const rows = await listApplications(await seed(), { now: NOW });
    const flagged = rows.filter((r) => r.followUp).map((r) => r.company).sort();
    expect(flagged).toEqual(["Quiet applied", "Quiet by hand", "Quiet heard"]);
  });

  it("keeps only those rows, including ones you set by hand", async () => {
    expect(await names(await seed(), { followUp: true })).toEqual(["Quiet applied", "Quiet by hand", "Quiet heard"]);
  });

  it("shows every row when the filter is off", async () => {
    expect((await names(await seed(), { followUp: false })).length).toBe(9);
    expect((await names(await seed())).length).toBe(9);
  });

  it("narrows within a stage and with search", async () => {
    const db = await seed();
    expect(await names(db, { followUp: true, stage: "Heard back" })).toEqual(["Quiet heard"]);
    expect(await names(db, { followUp: true, stage: "Interview" })).toEqual([]);
    expect(await names(db, { followUp: true, q: "hand" })).toEqual(["Quiet by hand"]);
  });

  it("leaves the stage counts alone", async () => {
    const counts = await stageCounts(await seed());
    expect([counts.Applied, counts["Heard back"], counts.Interview]).toEqual([4, 1, 1]);
  });
});

describe("idle days are calendar days", () => {
  it("count a quiet evening as a whole day, so a follow-up shows up on the date the list says it is a week", async () => {
    const before = process.env.TZ;
    process.env.TZ = "America/Toronto";
    try {
      const db = freshDb();
      // last activity at 9 pm on Oct 29 in Toronto; it is 9 am on Nov 5: 6.5 days have passed, and the calendar says 7
      const id = await createApplication(db, { company: "Acme", companyKey: "acme", role: "Analyst", roleKey: "analyst", stage: "Applied", when: "2026-10-30T01:00:00Z" });
      const [row] = await listApplications(db, { now: new Date("2026-11-05T14:00:00Z") });
      expect([row.id, row.idleDays, row.followUp]).toEqual([id, 7, true]);
      const [sooner] = await listApplications(db, { now: new Date("2026-11-05T04:00:00Z") }); // 11 pm on Nov 4: only 6 calendar days
      expect([sooner.idleDays, sooner.followUp]).toEqual([6, false]);
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it("are never negative, so a stamp a little ahead of the clock is today", async () => {
    const db = freshDb();
    await createApplication(db, { company: "Acme", companyKey: "acme", role: "Analyst", roleKey: "analyst", stage: "Applied", when: "2026-11-06T12:00:00Z" });
    const [row] = await listApplications(db, { now: new Date("2026-11-05T12:00:00Z") });
    expect(row.idleDays).toBe(0);
  });
});

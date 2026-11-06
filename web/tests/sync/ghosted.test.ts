import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication } from "../../src/db/repo";
import { STAGES, type Stage } from "../../src/db/stages";
import { iso } from "../../src/db/time";
import { FOLLOW_UP_DAYS, GHOSTED_DAYS, isGhosted, needsFollowUp } from "../../src/sync/followUp";
import { listApplications } from "../../src/sync/queries";
import { sankey } from "../../src/sync/stats";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

describe("the ghosted rule", () => {
  it("is 30 days, and the nudge window is 7 to 29", () => {
    expect([FOLLOW_UP_DAYS, GHOSTED_DAYS]).toEqual([7, 30]);
  });

  it.each(["Applied", "Heard back"] as Stage[])("%s is ghosted at 30 days, not at 29, and nudged at 29, not at 30", (stage) => {
    expect(isGhosted(stage, 29)).toBe(false);
    expect(needsFollowUp(stage, 29)).toBe(true);
    expect(isGhosted(stage, 30)).toBe(true);
    expect(needsFollowUp(stage, 30)).toBe(false);
    expect(isGhosted(stage, 365)).toBe(true);
    expect(isGhosted(stage, 0)).toBe(false);
  });

  it("is never both: every idle count is at most one of nudge or ghosted", () => {
    for (const stage of STAGES) for (let days = 0; days < 400; days++) expect(needsFollowUp(stage, days) && isGhosted(stage, days)).toBe(false);
  });

  it.each(["Assessment", "Interview", "Offer", "Rejected"] as Stage[])("%s is never ghosted", (stage) => {
    for (const days of [0, 29, 30, 400]) expect(isGhosted(stage, days)).toBe(false);
  });

  it("never counts an unknown idle time", () => {
    for (const stage of STAGES) expect(isGhosted(stage, null)).toBe(false);
  });
});

describe("in the list", () => {
  const NOW = new Date("2026-11-05T12:30:00Z");
  const ago = (days: number) => iso(new Date(NOW.getTime() - days * 86_400_000));

  async function seed() {
    const db = freshDb();
    const add = async (company: string, stage: Stage, last: number | null) => {
      const id = await createApplication(db, { company, companyKey: company.toLowerCase(), role: "Analyst", roleKey: "analyst", stage, when: ago(90) });
      await db.applications.update(id, { lastActivity: last === null ? null : ago(last) });
    };
    await add("Nudge 29", "Applied", 29);
    await add("Ghost 30", "Applied", 30);
    await add("Ghost heard", "Heard back", 80);
    await add("Quiet interview", "Interview", 80);
    await add("Fresh", "Applied", 3);
    await add("Unknown", "Applied", null);
    return db;
  }
  const names = async (db: Awaited<ReturnType<typeof seed>>, q: Parameters<typeof listApplications>[1] = {}) =>
    (await listApplications(db, { now: NOW, sort: "company", dir: "asc", ...q })).map((r) => r.company);

  it("flags a row as followUp or ghosted, never both", async () => {
    const rows = await listApplications(await seed(), { now: NOW });
    const flags = Object.fromEntries(rows.map((r) => [r.company, [r.followUp, r.ghosted]]));
    expect(flags["Nudge 29"]).toEqual([true, false]);
    expect(flags["Ghost 30"]).toEqual([false, true]);
    expect(flags["Ghost heard"]).toEqual([false, true]);
    expect(flags["Quiet interview"]).toEqual([false, false]);
    expect(flags["Fresh"]).toEqual([false, false]);
    expect(flags["Unknown"]).toEqual([false, false]);
  });

  it("the Needs follow-up filter keeps 7 to 29 days only, so ghosted rows leave it", async () => {
    expect(await names(await seed(), { followUp: true })).toEqual(["Nudge 29"]);
  });

  it("the No reply filter keeps ghosted rows only", async () => {
    expect(await names(await seed(), { ghosted: true })).toEqual(["Ghost 30", "Ghost heard"]);
  });

  it("with both filters on, a row in either shows", async () => {
    expect(await names(await seed(), { followUp: true, ghosted: true })).toEqual(["Ghost 30", "Ghost heard", "Nudge 29"]);
  });

  it("leaves Flow's No response yet bucket as it was: stage and replies decide it, not the ghosted rule", async () => {
    const db = await seed();
    const node = (await sankey(db)).nodes.find((n) => n.id === "No response yet");
    // Applied rows with no reply: Nudge 29, Ghost 30, Fresh and Unknown, whatever their idle time
    expect(node?.value).toBe(4);
  });
});

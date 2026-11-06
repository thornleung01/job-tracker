// The Statistics numbers beyond the funnel: timings, pace, monthly reply rate and what is waiting.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplication, setSetting } from "../../src/db/repo";
import type { ApplicationRow, EmailRow } from "../../src/db/schema";
import type { Stage } from "../../src/db/stages";
import { dayOf, daysBetween, localDay, startOfWeek } from "../../src/db/time";
import { addStep } from "../../src/sync/activity";
import { setGoal } from "../../src/sync/goal";
import { listApplications } from "../../src/sync/queries";
import { sankey, type StageEvent } from "../../src/sync/stats";
import {
  MAX_MONTHS, MAX_WEEKS, MIN_SAMPLE, monthlyRates, nearestRank, paceNote, paceOf, speedOf, spread, statistics, timingOf, waitingOf,
} from "../../src/sync/statistics";
import { markDeleted } from "../../src/sync/trash";
import { closeAll, dbWithAccount, freshDb } from "./helpers";

afterEach(closeAll);

let nextId = 1;
const app = (over: Partial<ApplicationRow> = {}): ApplicationRow => ({
  id: nextId++, company: "Acme", companyKey: "acme", role: "Dev", roleKey: "dev", stage: "Applied", stageAt: null, appliedAt: "2026-10-01T12:00:00Z",
  lastActivity: "2026-10-01T12:00:00Z", locked: false, manual: false, ...over,
});
const ev = (stage: string, at: string): StageEvent => ({ stage, at });
const events = (...rows: [ApplicationRow, StageEvent[]][]) => new Map(rows.map(([a, list]) => [a.id, list]));

/** Thursday, November 5 2026, mid-afternoon in Toronto and UTC alike. Monday weeks: Nov 2 to Nov 8 is the current one. */
const NOW = new Date("2026-11-05T19:00:00Z");

describe("spread", () => {
  it("picks real values by nearest rank", () => {
    expect(nearestRank([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(nearestRank([1, 2, 3, 4], 50)).toBe(2);
    expect(nearestRank([1, 2, 3, 4, 5], 25)).toBe(2);
    expect(nearestRank([1, 2, 3, 4, 5], 75)).toBe(4);
    expect(spread([9, 1, 5, 3, 7])).toEqual({ n: 5, median: 5, p25: 3, p75: 7 });
  });

  it("says there isn't enough under the minimum", () => {
    expect(MIN_SAMPLE).toBe(3);
    expect(spread([])).toEqual({ n: 0, median: null, p25: null, p75: null });
    expect(spread([4, 6])).toEqual({ n: 2, median: null, p25: null, p75: null });
    expect(spread([4, 6, 8]).median).toBe(6);
  });
});

describe("timingOf", () => {
  const applied = "2026-10-01T12:00:00Z"; // a picked day: Oct 1
  it("measures from the applied day to the first reply, interview and outcome", () => {
    const a = app({ appliedAt: applied, stage: "Offer" });
    const t = timingOf(a, [ev("Applied", "2026-10-01T13:00:00Z"), ev("Heard back", "2026-10-04T15:00:00Z"), ev("Interview", "2026-10-09T15:00:00Z"), ev("Interview", "2026-10-15T15:00:00Z"), ev("Offer", "2026-10-20T15:00:00Z")], "UTC");
    expect(t).toEqual({ reply: 3, interview: 8, outcome: 19 });
  });

  it("counts any stage other than Applied as the first reply, whatever order the events arrive in", () => {
    const a = app({ stage: "Rejected" });
    expect(timingOf(a, [ev("Rejected", "2026-10-12T10:00:00Z"), ev("Assessment", "2026-10-06T10:00:00Z")], "UTC").reply).toBe(5);
  });

  it("gives an outcome only to an application that is at Offer or Rejected now", () => {
    const events1 = [ev("Heard back", "2026-10-03T10:00:00Z"), ev("Offer", "2026-10-10T10:00:00Z")];
    expect(timingOf(app({ stage: "Interview" }), events1, "UTC").outcome).toBeNull();
    expect(timingOf(app({ stage: "Offer" }), events1, "UTC").outcome).toBe(9);
    expect(timingOf(app({ stage: "Rejected" }), [ev("Rejected", "2026-10-02T10:00:00Z")], "UTC").outcome).toBe(1);
  });

  it("takes the earliest of an Offer and a Rejected event, and has no outcome for a terminal stage with no dated terminal event", () => {
    const both = [ev("Offer", "2026-10-10T10:00:00Z"), ev("Rejected", "2026-10-20T10:00:00Z")];
    expect(timingOf(app({ stage: "Rejected" }), both, "UTC").outcome).toBe(9);
    expect(timingOf(app({ stage: "Offer" }), [ev("Heard back", "2026-10-03T10:00:00Z")], "UTC")).toMatchObject({ reply: 2, outcome: null });
  });

  it("skips an event whose time can't be read", () => {
    expect(timingOf(app({ stage: "Interview" }), [ev("Interview", "not a time"), ev("Interview", "2026-10-09T10:00:00Z")], "UTC").interview).toBe(8);
  });

  it("has nothing for an application with no applied day, and nothing for stages with no dated evidence", () => {
    expect(timingOf(app({ appliedAt: null }), [ev("Heard back", "2026-10-03T10:00:00Z")], "UTC")).toEqual({ reply: null, interview: null, outcome: null });
    expect(timingOf(app({ stage: "Interview" }), [], "UTC")).toEqual({ reply: null, interview: null, outcome: null });
    expect(timingOf(app(), [ev("Applied", "2026-10-02T10:00:00Z")], "UTC")).toEqual({ reply: null, interview: null, outcome: null });
  });

  it("counts a stage dated before the applied day as day 0", () => {
    expect(timingOf(app({ stage: "Interview" }), [ev("Interview", "2026-09-20T10:00:00Z")], "UTC")).toMatchObject({ reply: 0, interview: 0 });
  });

  it("reads a picked day and an instant by the day each stands for", () => {
    // A step logged for Oct 6 is stored at noon UTC and is Oct 6 in every zone.
    expect(timingOf(app(), [ev("Heard back", "2026-10-06T12:00:00Z")], "Pacific/Kiritimati").reply).toBe(5);
    expect(timingOf(app(), [ev("Heard back", "2026-10-06T12:00:00Z")], "Etc/GMT+12").reply).toBe(5);
  });
});

describe("speedOf", () => {
  it("collects each timing across applications and hides a median that rests on too few", () => {
    const rows = [1, 2, 3, 4].map((d) => app({ stage: d === 4 ? "Offer" : "Applied" }));
    const evs = events(
      [rows[0], [ev("Heard back", "2026-10-02T10:00:00Z")]],
      [rows[1], [ev("Heard back", "2026-10-03T10:00:00Z")]],
      [rows[2], [ev("Heard back", "2026-10-04T10:00:00Z"), ev("Interview", "2026-10-08T10:00:00Z")]],
      [rows[3], [ev("Heard back", "2026-10-05T10:00:00Z"), ev("Interview", "2026-10-07T10:00:00Z"), ev("Offer", "2026-10-12T10:00:00Z")]],
    );
    const s = speedOf(rows, evs, "UTC");
    expect(s.reply).toEqual({ n: 4, median: 2, p25: 1, p75: 3 });
    expect(s.interview).toEqual({ n: 2, median: null, p25: null, p75: null });
    expect(s.outcome.n).toBe(1);
  });
});

describe("paceOf", () => {
  const at = (day: string) => `${day}T12:00:00Z`;
  const rowsOn = (...days: string[]) => days.map((d) => ({ appliedAt: at(d) }));

  it("buckets days into Monday to Sunday weeks and ends with the current week", () => {
    // Sun Nov 1 is the last day of the week that started Oct 26; Mon Nov 2 starts the current one.
    const p = paceOf(rowsOn("2026-10-26", "2026-11-01", "2026-11-02", "2026-11-05", "2026-11-05"), 30, null, NOW, "UTC")!;
    expect(p.weeks).toHaveLength(5);
    expect(p.weeks.map((w) => w.start)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]);
    expect(p.weeks.map((w) => w.count)).toEqual([0, 0, 0, 2, 3]);
    expect(p.weeks.map((w) => w.current)).toEqual([false, false, false, false, true]);
    expect(p.weeks[4].end).toBe("2026-11-08");
  });

  it("shows ceil(days / 7) weeks for each period, and every live application counts whatever its age", () => {
    const many = rowsOn("2026-02-02", "2026-11-03");
    for (const [days, weeks] of [[30, 5], [90, 13], [180, 26]] as const) expect(paceOf(many, days, null, NOW, "UTC")!.weeks).toHaveLength(weeks);
    // The first application sits well outside 30 days, so it is simply not in view.
    expect(paceOf(many, 30, null, NOW, "UTC")!.weeks.reduce((n, w) => n + w.count, 0)).toBe(1);
  });

  it("runs from the first application's week for all time, at most a year", () => {
    expect(paceOf(rowsOn("2026-09-01"), 0, null, NOW, "UTC")!.weeks).toHaveLength(10); // Aug 31 through Nov 2
    const long = paceOf(rowsOn("2020-03-03", "2026-11-03"), 0, null, NOW, "UTC")!;
    expect(long.weeks).toHaveLength(MAX_WEEKS);
    expect(long.weeks[MAX_WEEKS - 1].current).toBe(true);
  });

  it("is null when no application in view has an applied day", () => {
    expect(paceOf([], 0, null, NOW, "UTC")).toBeNull();
    expect(paceOf([{ appliedAt: null }], 0, null, NOW, "UTC")).toBeNull();
    expect(paceOf(rowsOn("2026-03-03"), 30, null, NOW, "UTC")).toBeNull();
  });

  it("leaves out an applied day in the future", () => {
    expect(paceOf(rowsOn("2026-11-20"), 0, null, NOW, "UTC")).toBeNull();
    expect(paceOf(rowsOn("2026-11-20", "2026-11-04"), 30, null, NOW, "UTC")!.weeks.reduce((n, w) => n + w.count, 0)).toBe(1);
  });

  it("averages the weeks that are over, or the current week alone when it is the only one", () => {
    const p = paceOf([...rowsOn("2026-10-26", "2026-10-27", "2026-10-28"), ...rowsOn("2026-11-02")], 14, null, NOW, "UTC")!;
    expect(p.weeks.map((w) => w.count)).toEqual([3, 1]); // weeks of Oct 26 and Nov 2
    expect(p.perWeek).toBe(3); // the unfinished current week doesn't pull it down
    expect(paceOf(rowsOn("2026-11-02", "2026-11-03"), 0, null, NOW, "UTC")!.perWeek).toBe(2);
    expect(paceOf([...rowsOn("2026-10-26", "2026-10-27", "2026-11-02")], 14, null, NOW, "UTC")!.perWeek).toBe(2);
    expect(paceOf([...rowsOn("2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"), ...rowsOn("2026-10-19", "2026-10-20", "2026-10-21"), ...rowsOn("2026-11-02")], 21, null, NOW, "UTC")!.perWeek).toBe(3.5);
  });

  it("finds the best week, the latest of equals", () => {
    const p = paceOf(rowsOn("2026-10-12", "2026-10-13", "2026-10-26", "2026-10-27", "2026-11-02"), 30, null, NOW, "UTC")!;
    expect(p.best).toMatchObject({ start: "2026-10-26", count: 2 });
  });

  it("counts the goal streak back from this week once it is met, otherwise from last week", () => {
    const week = (start: string, n: number) => Array.from({ length: n }, (_, i) => ({ appliedAt: at(shiftWithin(start, i)) }));
    const shiftWithin = (start: string, i: number) => `${start.slice(0, 8)}${String(Number(start.slice(8)) + i).padStart(2, "0")}`;
    // Weeks Oct 12, 19, 26 have 3, 3, 3 and the current week has 1: the streak runs back from last week.
    const base = [...week("2026-10-12", 3), ...week("2026-10-19", 3), ...week("2026-10-26", 3), ...week("2026-11-02", 1)];
    expect(paceOf(base, 30, 3, NOW, "UTC")!.streak).toBe(3);
    // Once this week has met it too, it counts as well.
    expect(paceOf([...base, ...week("2026-11-02", 2)], 30, 3, NOW, "UTC")!.streak).toBe(4);
    // One short week breaks the run.
    expect(paceOf([...week("2026-10-12", 3), ...week("2026-10-19", 2), ...week("2026-10-26", 3)], 30, 3, NOW, "UTC")!.streak).toBe(1);
    // No goal, no streak.
    expect(paceOf(base, 30, null, NOW, "UTC")!.streak).toBe(0);
  });

  it("writes one line under the chart", () => {
    const rows = rowsOn("2026-10-12", "2026-10-13", "2026-10-19", "2026-10-20", "2026-10-26", "2026-10-27");
    expect(paceNote(paceOf(rows, 30, 2, NOW, "UTC")!)).toBe("Goal met 3 weeks in a row");
    expect(paceNote(paceOf(rows, 30, null, NOW, "UTC")!)).toBe("Best week: 2");
    expect(paceNote(paceOf(rows, 30, 5, NOW, "UTC")!)).toBe("Best week: 2");
    expect(paceNote(paceOf(rowsOn("2026-10-12", "2026-10-13", "2026-10-19", "2026-10-20", "2026-10-26"), 30, 2, NOW, "UTC")!)).toBe("Best week: 2");
    // One week at the goal is a streak of 1, which isn't worth a sentence: only 2 or more is.
    const one = paceOf(rowsOn("2026-10-12", "2026-10-26", "2026-10-27", "2026-11-02"), 30, 2, NOW, "UTC")!;
    expect(one.streak).toBe(1);
    expect(paceNote(one)).toBe("Best week: 2");
    // A hand-built pace with no best week and no streak has nothing to say.
    expect(paceNote({ weeks: [], goal: null, perWeek: 0, best: null, streak: 0 })).toBeNull();
  });

  it("can start weeks on Sunday", () => {
    const p = paceOf(rowsOn("2026-11-01", "2026-11-02"), 14, null, NOW, "UTC", 0)!;
    expect(p.weeks.map((w) => w.start)).toEqual(["2026-10-25", "2026-11-01"]);
    expect(p.weeks.map((w) => w.count)).toEqual([0, 2]);
  });
});

describe("monthlyRates", () => {
  const on = (day: string, stage: Stage = "Applied") => app({ appliedAt: `${day}T12:00:00Z`, stage });

  it("is empty until two months have applications", () => {
    expect(monthlyRates([], new Map(), NOW, "UTC")).toEqual([]);
    expect(monthlyRates([on("2026-10-03"), on("2026-10-20")], new Map(), NOW, "UTC")).toEqual([]);
  });

  it("counts a reply by the stage now or by any stage an event showed, and rounds halves to even", () => {
    const a = on("2026-08-03");
    const b = on("2026-08-04");
    const c = on("2026-08-05", "Interview"); // set by hand: no events, but the stage proves a reply
    const d = on("2026-08-06");
    const e = on("2026-09-02");
    const rows = monthlyRates([a, b, c, d, e], events([a, [ev("Heard back", "2026-08-09T10:00:00Z")]], [b, [ev("Applied", "2026-08-04T10:00:00Z")]]), NOW, "UTC");
    expect(rows[0]).toEqual({ month: "2026-08", applied: 4, heardBack: 2, pct: 50, settling: false });
    expect(rows[1]).toMatchObject({ month: "2026-09", applied: 1, heardBack: 0, pct: 0 });
    const thirds = monthlyRates([on("2026-08-01", "Heard back"), on("2026-08-02", "Heard back"), on("2026-08-03"), on("2026-09-01")], new Map(), NOW, "UTC");
    expect(thirds[0].pct).toBe(67);
    const half = monthlyRates([...Array.from({ length: 8 }, (_, i) => on(`2026-08-${String(i + 1).padStart(2, "0")}`, i === 0 ? "Heard back" : "Applied")), on("2026-09-01")], new Map(), NOW, "UTC");
    expect(half[0].pct).toBe(12); // 12.5 goes to the even neighbour
  });

  it("fills a month with no applications and marks it with no rate", () => {
    const rows = monthlyRates([on("2026-07-10"), on("2026-09-10")], new Map(), NOW, "UTC");
    expect(rows.map((r) => [r.month, r.applied, r.pct])).toEqual([["2026-07", 1, 0], ["2026-08", 0, null], ["2026-09", 1, 0]]);
  });

  it("marks the months where replies are still arriving", () => {
    const rows = monthlyRates([on("2026-07-10"), on("2026-08-10"), on("2026-09-10"), on("2026-10-10"), on("2026-11-02")], new Map(), NOW, "UTC");
    // On Nov 5 September ended 36 days ago, October ended 5 days ago and November isn't over.
    expect(rows.map((r) => [r.month, r.settling])).toEqual([["2026-07", false], ["2026-08", false], ["2026-09", false], ["2026-10", true], ["2026-11", true]]);
    // Exactly 30 days after the month's last day it is no longer settling.
    expect(monthlyRates([on("2026-09-10"), on("2026-10-10")], new Map(), new Date("2026-11-29T19:00:00Z"), "UTC")[1].settling).toBe(true);
    expect(monthlyRates([on("2026-09-10"), on("2026-10-10")], new Map(), new Date("2026-11-30T19:00:00Z"), "UTC")[1].settling).toBe(false);
  });

  it("leaves out an application dated in the future", () => {
    expect(monthlyRates([on("2026-10-03"), on("2026-09-03"), on("2026-12-20")], new Map(), NOW, "UTC").map((m) => m.month)).toEqual(["2026-09", "2026-10"]);
  });

  it("leaves out an application with no applied day, and keeps the latest two years", () => {
    expect(monthlyRates([app({ appliedAt: null }), on("2026-10-01")], new Map(), NOW, "UTC")).toEqual([]);
    const rows = monthlyRates([on("2020-01-10"), on("2026-10-10")], new Map(), NOW, "UTC");
    expect(rows).toHaveLength(MAX_MONTHS);
    expect(rows[MAX_MONTHS - 1].month).toBe("2026-10");
  });
});

describe("waitingOf", () => {
  const idle = (days: number, stage: Stage = "Applied") => app({ stage, lastActivity: new Date(NOW.getTime() - days * 86_400_000).toISOString() });

  it("splits waiting applications by how long they have been quiet", () => {
    const rows = [idle(0), idle(6), idle(7), idle(29), idle(30), idle(90), idle(10, "Heard back")];
    expect(waitingOf(rows, NOW, "UTC")).toEqual({ fresh: 2, followUp: 3, ghosted: 2 });
  });

  it("ignores stages that aren't waiting and applications with no activity day", () => {
    const rows = [idle(40, "Interview"), idle(40, "Assessment"), idle(40, "Offer"), idle(40, "Rejected"), app({ lastActivity: null })];
    expect(waitingOf(rows, NOW, "UTC")).toEqual({ fresh: 0, followUp: 0, ghosted: 0 });
  });

  it("matches the filters on the list", async () => {
    const db = freshDb();
    const now = new Date();
    for (const [i, days] of [0, 3, 8, 15, 29, 31, 60].entries()) {
      const id = await createApplication(db, { company: `Co ${i}`, companyKey: `co${i}`, role: "R", roleKey: "r", stage: "Applied", when: new Date(now.getTime() - days * 86_400_000).toISOString() });
      await db.applications.update(id, { lastActivity: new Date(now.getTime() - days * 86_400_000).toISOString() });
    }
    const rows = await db.applications.toArray();
    const w = waitingOf(rows, now);
    expect((await listApplications(db, { followUp: true, now })).length).toBe(w.followUp);
    expect((await listApplications(db, { ghosted: true, now })).length).toBe(w.ghosted);
    expect(w.fresh + w.followUp + w.ghosted).toBe(7);
  });
});

describe("statistics", () => {
  async function seed() {
    const { db, acct } = await dbWithAccount();
    const make = async (company: string, when: string, stage: Stage = "Applied") =>
      createApplication(db, { company, companyKey: company.toLowerCase(), role: "Dev", roleKey: "dev", stage, when });
    const a = await make("Acme", "2026-10-01T12:00:00Z");
    const b = await make("Initech", "2026-10-02T12:00:00Z");
    const c = await make("Hooli", "2026-10-26T12:00:00Z");
    const d = await make("Pied Piper", "2026-11-03T12:00:00Z");
    const mail = (applicationId: number, receivedAt: string, event: EmailRow["event"], n: number): EmailRow => ({
      id: n, accountId: acct, providerMsgId: `m${n}`, threadId: `t${n}`, receivedAt, sender: "x <x@y.com>", subject: "s", body: "", related: true, event,
      confidence: "high", applicationId, needsReview: false, webLink: null, bulk: false, hold: false, reason: null,
    });
    await db.emails.bulkAdd([
      mail(a, "2026-10-04T15:00:00Z", "heard_back", 1), mail(a, "2026-10-09T15:00:00Z", "interview", 2), mail(a, "2026-10-20T15:00:00Z", "offer", 3),
      mail(b, "2026-10-06T15:00:00Z", "rejected", 4),
    ]);
    await db.applications.update(a, { stage: "Offer" });
    await db.applications.update(b, { stage: "Rejected" });
    return { db, acct, ids: { a, b, c, d } };
  }
  const opts = { now: NOW, timeZone: "UTC" };

  it("gives the funnel exactly as sankey does, plus the rest from the same applications", async () => {
    const { db } = await seed();
    const s = await statistics(db, opts);
    expect(s.flow).toEqual(await sankey(db, opts));
    expect(s.flow.total).toBe(4);
    expect(s.speed.reply).toEqual({ n: 2, median: null, p25: null, p75: null });
    expect(s.speed.outcome.n).toBe(2);
    expect(s.pace!.weeks.reduce((n, w) => n + w.count, 0)).toBe(4);
    expect(s.waiting).toEqual({ fresh: 1, followUp: 1, ghosted: 0 }); // Hooli (10 days quiet) and Pied Piper (2 days) are waiting; the other two are decided
  });

  it("uses the same applications for the funnel and the timings when the period filters", async () => {
    const { db } = await seed();
    const s = await statistics(db, { ...opts, days: 30 });
    expect(s.flow).toEqual(await sankey(db, { ...opts, days: 30 }));
    expect(s.flow.total).toBe(2); // only the two applied in the last 30 days (Oct 26 and Nov 3)
    expect(s.speed.reply.n).toBe(0);
    // The pace chart still counts every application in its weeks, and what is waiting is about right now.
    expect(s.pace!.weeks).toHaveLength(5);
    expect(s.pace!.weeks.reduce((n, w) => n + w.count, 0)).toBe(2);
  });

  it("keeps Pace and Waiting now to the whole account while the period narrows the funnel, speed and monthly chart", async () => {
    const { db, ids } = await seed();
    const old = await createApplication(db, { company: "Ancient", companyKey: "ancient", role: "Dev", roleKey: "dev", stage: "Applied", when: "2026-08-01T12:00:00Z" });
    await db.applications.update(old, { lastActivity: "2026-08-01T12:00:00Z" });
    const s = await statistics(db, { ...opts, days: 30 });
    expect(s.flow.total).toBe(2); // Ancient is outside the 30 days, like Acme and Initech
    expect(s.waiting).toEqual({ fresh: 1, followUp: 1, ghosted: 1 }); // but it is still waiting, and long ghosted
    expect(s.pace!.weeks.reduce((n, w) => n + w.count, 0)).toBe(2); // pace counts weeks in view, so Ancient's August week isn't one of them
    expect(s.monthly.map((m) => m.month)).toEqual(["2026-10", "2026-11"]); // the monthly chart follows the period: Ancient's August is out
    const all = await statistics(db, { ...opts, days: 0 });
    expect(all.waiting).toEqual(s.waiting);
    expect(all.monthly.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(ids.a).toBeGreaterThan(0);
  });

  it("combines an account with a period", async () => {
    const { db, acct } = await seed();
    const s = await statistics(db, { ...opts, account: acct, days: 30 });
    expect(s.flow).toEqual(await sankey(db, { ...opts, account: acct, days: 30 }));
    expect(s.flow.total).toBe(0); // Acme and Initech have mail in the account, but both were applied over 30 days ago
    expect((await statistics(db, { ...opts, account: acct, days: 90 })).flow.total).toBe(2);
  });

  it("counts a logged step as dated evidence", async () => {
    const { db, ids } = await seed();
    await addStep(db, ids.c, "Interview", "2026-10-30", "", NOW);
    const s = await statistics(db, opts);
    expect(s.flow.interviews).toBe(2);
    const day = dayOf((await db.activity.toArray()).find((r) => r.applicationId === ids.c)!.occurredAt, "UTC");
    expect(day).toBe("2026-10-30");
    expect(s.speed.interview.n).toBe(2);
  });

  it("leaves out an application you deleted, and its mail", async () => {
    const { db, ids } = await seed();
    await markDeleted(db, ids.a, NOW);
    const s = await statistics(db, opts);
    expect(s.flow.total).toBe(3);
    expect(s.speed.outcome.n).toBe(1);
    expect(s.pace!.weeks.reduce((n, w) => n + w.count, 0)).toBe(3);
  });

  it("filters by account, for the funnel and the pace alike", async () => {
    const { db, acct } = await seed();
    const all = await statistics(db, { ...opts, account: acct });
    // Only Acme and Initech have mail in the account.
    expect(all.flow.total).toBe(2);
    expect(all.pace!.weeks.reduce((n, w) => n + w.count, 0)).toBe(2);
    expect((await statistics(db, { ...opts, account: acct + 1 })).pace).toBeNull();
  });

  it("carries the weekly goal into the pace", async () => {
    const { db } = await seed();
    expect((await statistics(db, opts)).pace!.goal).toBeNull();
    await setGoal(db, 2);
    expect((await statistics(db, opts)).pace!.goal).toBe(2);
    await setSetting(db, "weeklyGoal", { perWeek: 0 });
    expect((await statistics(db, opts)).pace!.goal).toBeNull();
  });

  it("is empty and unbroken with no applications", async () => {
    const s = await statistics(freshDb(), opts);
    expect(s.flow.total).toBe(0);
    expect([s.pace, s.monthly, s.waiting]).toEqual([null, [], { fresh: 0, followUp: 0, ghosted: 0 }]);
    expect(s.speed.reply.n).toBe(0);
  });

  it("reads the emails once, however many statistics it builds", async () => {
    const { db } = await seed();
    const read = vi.spyOn(db.emails, "toArray");
    await statistics(db, opts);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("stays quick at a thousand applications and twenty thousand emails", async () => {
    const { db, acct } = await dbWithAccount();
    const apps = Array.from({ length: 1000 }, (_, i) => ({
      company: `Co ${i}`, companyKey: `co${i}`, role: "Dev", roleKey: "dev", stage: (i % 3 ? "Heard back" : "Applied") as Stage, stageAt: null,
      appliedAt: new Date(Date.UTC(2025, 5, 1) + i * 12 * 3_600_000).toISOString(), lastActivity: "2026-10-01T12:00:00Z", locked: false, manual: false,
    }));
    const ids = (await db.applications.bulkAdd(apps as never, { allKeys: true })) as number[];
    const events = ["applied", "heard_back", "interview", null] as const;
    await db.emails.bulkAdd(Array.from({ length: 20_000 }, (_, i) => ({
      accountId: acct, providerMsgId: `m${i}`, threadId: `t${i}`, receivedAt: new Date(Date.UTC(2025, 5, 2) + i * 3_600_000).toISOString(), sender: null, subject: null, body: null,
      related: true, event: events[i % 4], confidence: "high", applicationId: ids[i % 1000], needsReview: false, webLink: null, bulk: false, hold: false, reason: null,
    })) as never);
    const started = Date.now();
    const s = await statistics(db, { now: NOW, timeZone: "UTC" });
    expect(Date.now() - started).toBeLessThan(20_000); // a loose bound: it only has to catch something that became quadratic
    expect(s.flow.total).toBe(1000);
    expect(s.speed.reply.n).toBe(500); // the apps whose emails are heard back or interview
    expect(s.speed.interview.n).toBe(250);
    expect(s.pace!.weeks).toHaveLength(MAX_WEEKS);
    expect(s.monthly.length).toBeGreaterThan(5);
  });
});

describe("in other time zones", () => {
  const FIXED: string[] = Array.from({ length: 27 }, (_, i) => {
    const h = i - 12;
    return h === 0 ? "UTC" : `Etc/GMT${h > 0 ? "-" : "+"}${Math.abs(h)}`;
  });
  const ZONES = [...FIXED, "America/Toronto", "America/St_Johns", "Australia/Sydney", "Australia/Lord_Howe", "Pacific/Apia", "Pacific/Chatham", "Asia/Kathmandu"];
  const HOUR = 3_600_000;

  it("reads a Toronto evening as that evening's day, which is what makes a Sunday night belong to the week before", () => {
    // 9 pm on Sunday Nov 1 in Toronto is already Monday Nov 2 in UTC.
    const when = "2026-11-02T02:00:00Z";
    expect(dayOf(when, "America/Toronto")).toBe("2026-11-01");
    const toronto = paceOf([{ appliedAt: when }], 14, null, NOW, "America/Toronto")!;
    expect(toronto.weeks.map((w) => [w.start, w.count])).toEqual([["2026-10-26", 1], ["2026-11-02", 0]]);
    const utc = paceOf([{ appliedAt: when }], 14, null, NOW, "UTC")!;
    expect(utc.weeks.map((w) => [w.start, w.count])).toEqual([["2026-10-26", 0], ["2026-11-02", 1]]);
  });

  it("measures days between applying and a reply by the viewer's calendar days, in every zone", () => {
    const applied = new Date("2026-10-31T23:30:00Z").getTime();
    for (const zone of ZONES) {
      for (let h = 0; h <= 80; h += 7) {
        const reply = new Date(applied + h * HOUR).toISOString();
        const a = app({ appliedAt: new Date(applied).toISOString() });
        const expected = Math.max(0, daysBetween(localDay(applied, zone), localDay(reply, zone)));
        const t = timingOf(a, h === 0 ? [] : [ev("Heard back", reply)], zone);
        expect(t.reply, `${zone} +${h}h`).toBe(h === 0 ? null : expected);
      }
    }
  });

  it("buckets an applied instant into the week of its viewer-local day, in every zone, across the clock change", () => {
    const starts = ["2026-03-07T00:00:00Z", "2026-03-08T00:00:00Z", "2026-10-31T00:00:00Z", "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"];
    for (const zone of ZONES) {
      for (const start of starts) {
        for (let h = 0; h < 72; h += 5) {
          const instant = new Date(new Date(start).getTime() + h * HOUR);
          const now = new Date(instant.getTime() + 20 * 86_400_000);
          const p = paceOf([{ appliedAt: instant.toISOString() }], 90, null, now, zone)!;
          expect(p, `${zone} ${instant.toISOString()}`).not.toBeNull();
          const hit = p.weeks.filter((w) => w.count === 1);
          expect(hit.map((w) => w.start), `${zone} ${instant.toISOString()}`).toEqual([startOfWeek(localDay(instant, zone))]);
        }
      }
    }
  });

  it("puts an application in the month of its viewer-local applied day, in every zone", () => {
    const edge = "2026-09-30T23:30:00Z"; // Sept 30 in the west, Oct 1 in the east
    for (const zone of ZONES) {
      const day = localDay(new Date(edge), zone);
      const rows = monthlyRates([app({ appliedAt: edge }), app({ appliedAt: "2026-08-10T12:00:00Z" })], new Map(), NOW, zone);
      expect(rows[rows.length - 1].month, zone).toBe(day.slice(0, 7));
    }
  });
});

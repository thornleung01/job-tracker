import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "../../src/db/errors";
import { WEEKLY_GOAL_MAX } from "../../src/db/limits";
import { createApplication } from "../../src/db/repo";
import { stampForDay } from "../../src/db/time";
import { clearGoal, loadGoal, loadWeeklyProgress, sanitizeGoal, setGoal, weekOf, weeklyProgress } from "../../src/sync/goal";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const applied = (...days: (string | null)[]) => days.map((d) => ({ appliedAt: d === null ? null : `${d}T12:00:00Z` }));

describe("the week", () => {
  it("runs Monday to Sunday by default", () => {
    // 2026-11-05 is a Thursday
    expect(weekOf("2026-11-05")).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(weekOf("2026-11-02")).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(weekOf("2026-11-08")).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(weekOf("2026-11-09")).toEqual({ start: "2026-11-09", end: "2026-11-15" });
  });
  it("can start on Sunday or Saturday, numbered like Date.getDay() (0 is Sunday)", () => {
    expect(weekOf("2026-11-05", 0)).toEqual({ start: "2026-11-01", end: "2026-11-07" });
    expect(weekOf("2026-11-01", 0)).toEqual({ start: "2026-11-01", end: "2026-11-07" });
    expect(weekOf("2026-11-07", 6)).toEqual({ start: "2026-11-07", end: "2026-11-13" });
    expect(weekOf("2026-11-06", 6)).toEqual({ start: "2026-10-31", end: "2026-11-06" });
  });
  it("crosses the end of a year and a leap day without a gap", () => {
    // Thursday 2026-12-31: the week began Monday 12-28 and ends Sunday 2027-01-03
    expect(weekOf("2026-12-31")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(weekOf("2027-01-01")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(weekOf("2028-03-01")).toEqual({ start: "2028-02-28", end: "2028-03-05" });
    expect(weekOf("2024-03-01")).toEqual({ start: "2024-02-26", end: "2024-03-03" });
  });
});

describe("weeklyProgress", () => {
  const now = new Date("2026-11-05T15:00:00Z");

  it("counts this week's applied days and nothing else", () => {
    const p = weeklyProgress(applied("2026-11-01", "2026-11-02", "2026-11-04", "2026-11-08", "2026-11-09", null), 5, now, 1, "America/Toronto");
    expect(p).toMatchObject({ count: 3, goal: 5, percent: 60, done: false, start: "2026-11-02", end: "2026-11-08" });
  });
  it("is done at the goal, and the bar stops at 100", () => {
    const p = weeklyProgress(applied("2026-11-02", "2026-11-03", "2026-11-04"), 2, now, 1, "America/Toronto");
    expect([p.count, p.percent, p.done]).toEqual([3, 100, true]);
  });
  it("skips deleted applications when the field exists", () => {
    const rows = [{ appliedAt: "2026-11-03T12:00:00Z" }, { appliedAt: "2026-11-03T12:00:00Z", deletedAt: "2026-11-04T12:00:00Z" }];
    expect(weeklyProgress(rows, 3, now, 1, "America/Toronto").count).toBe(1);
  });
  it("counts across a year boundary", () => {
    const p = weeklyProgress(applied("2026-12-29", "2027-01-02", "2027-01-04"), 5, new Date("2027-01-01T17:00:00Z"), 1, "America/Toronto");
    expect([p.start, p.end, p.count]).toEqual(["2026-12-28", "2027-01-03", 2]);
  });
  it("a day you picked counts on that day in every zone, an instant on the day it fell on in the viewer's", () => {
    // 11 pm Sunday 2026-11-08 in Toronto is Monday 2026-11-09 04:00 UTC: Sunday for a person in Toronto, Monday in UTC
    const instant = [{ appliedAt: "2026-11-09T04:00:00Z" }];
    const sundayWeek = new Date("2026-11-08T18:00:00Z");
    expect(weeklyProgress(instant, 5, sundayWeek, 1, "America/Toronto").count).toBe(1);
    expect(weeklyProgress(instant, 5, new Date("2026-11-09T18:00:00Z"), 1, "America/Toronto").count).toBe(0);
    expect(weeklyProgress(instant, 5, new Date("2026-11-09T18:00:00Z"), 1, "UTC").count).toBe(1);
    // a picked day (noon UTC) reads back as the day picked even where UTC is a different day
    const picked = [{ appliedAt: stampForDay("2026-11-02", new Date("2026-11-05T12:30:00Z"), "Pacific/Kiritimati") }];
    for (const tz of ["America/Toronto", "Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC", "Asia/Kolkata"]) {
      expect(weeklyProgress(picked, 5, new Date("2026-11-05T09:00:00Z"), 1, tz).count).toBe(1);
    }
  });
  it.each(["America/Toronto", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kolkata", "UTC"])("rolls the week over at local midnight in %s", (tz) => {
    // an application picked on Monday 2026-11-09, viewed one minute before and after local Monday midnight
    const rows = applied("2026-11-09");
    const midnightLocal = (day: string): Date => {
      // find the instant that is 00:00 local on `day` by walking from noon UTC
      for (let half = -28; half <= 28; half++) {
        const t = new Date(Date.parse(`${day}T00:00:00Z`) - half * 1_800_000);
        const hm = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
        if (hm.startsWith(day) && hm.endsWith("00:00")) return t;
      }
      throw new Error("no midnight");
    };
    const mid = midnightLocal("2026-11-09").getTime();
    expect(weeklyProgress(rows, 5, new Date(mid - 60_000), 1, tz).count).toBe(0);
    expect(weeklyProgress(rows, 5, new Date(mid + 60_000), 1, tz).count).toBe(1);
  });
});

describe("the stored goal", () => {
  it("is off by default", async () => {
    const db = freshDb();
    expect(await loadGoal(db)).toBeNull();
    expect(await loadWeeklyProgress(db)).toBeNull();
  });
  it("saves a whole number from 1 to 50, and 0 or empty removes it", async () => {
    const db = freshDb();
    expect(await setGoal(db, "5")).toBe(5);
    expect(await loadGoal(db)).toBe(5);
    expect(await setGoal(db, WEEKLY_GOAL_MAX)).toBe(WEEKLY_GOAL_MAX);
    expect(await setGoal(db, "")).toBeNull();
    expect(await loadGoal(db)).toBeNull();
    await setGoal(db, 3);
    await clearGoal(db);
    expect(await loadGoal(db)).toBeNull();
  });
  it.each(["51", "-1", "2.5", "abc", "1e2", " 5x"])("refuses %s", async (bad) => {
    const db = freshDb();
    await expect(setGoal(db, bad)).rejects.toBeInstanceOf(ActionError);
    expect(await loadGoal(db)).toBeNull();
  });
  it("takes its largest goal from the limit, not from a fixed number of digits", async () => {
    vi.resetModules();
    vi.doMock("../../src/db/limits", async (original) => ({ ...(await original<typeof import("../../src/db/limits")>()), WEEKLY_GOAL_MAX: 1200 }));
    try {
      const goal = await import("../../src/sync/goal");
      const db = freshDb();
      expect(await goal.setGoal(db, "1200")).toBe(1200);
      expect(await goal.loadGoal(db)).toBe(1200);
      await expect(goal.setGoal(db, "1201")).rejects.toThrow("Enter a whole number from 1 to 1200.");
      await expect(goal.setGoal(db, "12x")).rejects.toThrow("Enter a whole number from 1 to 1200.");
    } finally {
      vi.doUnmock("../../src/db/limits");
      vi.resetModules();
    }
  });
  it("reads a bad stored value as no goal", () => {
    for (const bad of [0, 51, 1.5, "5", null, { perWeek: "x" }, { perWeek: 99 }, [], undefined]) expect(sanitizeGoal(bad)).toBeNull();
    expect(sanitizeGoal({ perWeek: 7 })).toBe(7);
  });
  it("counts the database's applications, not deleted ones", async () => {
    const db = freshDb();
    await setGoal(db, 4);
    const mk = (company: string) => createApplication(db, { company, companyKey: company, role: "R", roleKey: "r", stage: "Applied", when: new Date().toISOString() });
    await mk("a");
    const gone = await mk("b");
    await db.applications.update(gone, { deletedAt: new Date().toISOString() });
    const p = await loadWeeklyProgress(db, new Date(), 1);
    expect([p?.goal, p?.count]).toEqual([4, 1]);
  });
});

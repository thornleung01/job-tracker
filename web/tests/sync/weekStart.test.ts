// One week for the whole app: the weekly goal's week and the calendar's first column both start on WEEK_START (db/time.ts), numbered
// 0 (Sunday) to 6 (Saturday). Changing that one line must move both, so these tests check that they can't drift apart.
import { afterEach, describe, expect, it, vi } from "vitest";
import { WEEKDAY_NAMES } from "../../src/db/dayText";
import { WEEK_START, shiftDay, weekdayOf } from "../../src/db/time";
import { monthGrid } from "../../src/sync/calendarGrid";
import { weekOf, weeklyProgress } from "../../src/sync/goal";

afterEach(() => {
  vi.doUnmock("../../src/db/time");
  vi.resetModules();
});

const MONTHS = ["2026-02", "2026-11", "2026-12", "2027-01", "2028-02", "2028-03"];

describe("the goal's week and the calendar's week", () => {
  it("are the same week for every day and every first weekday", () => {
    for (let first = 0; first < 7; first++) {
      for (const month of MONTHS) {
        const grid = monthGrid(month, first);
        for (const row of grid) {
          expect(weekdayOf(row[0]), `${month} from ${first}`).toBe(first);
          for (const day of row) {
            const week = weekOf(day, first);
            expect([week.start, week.end], `${day} from ${first}`).toEqual([row[0], row[6]]);
            // the goal counts an application applied on `day` in the week the calendar draws it in
            const p = weeklyProgress([{ appliedAt: `${day}T12:00:00Z` }], 3, new Date(`${day}T15:00:00Z`), first, "UTC");
            expect([p.start, p.end, p.count], `${day} from ${first}`).toEqual([row[0], row[6], 1]);
          }
        }
      }
    }
  });

  it("both start on Monday today, from the one constant", () => {
    expect(WEEK_START).toBe(1);
    expect(weekOf("2026-11-05").start).toBe("2026-11-02");
    expect(monthGrid("2026-11")[0][0]).toBe("2026-10-26");
    expect(weekdayOf(monthGrid("2026-11")[0][0])).toBe(WEEK_START);
    expect(WEEKDAY_NAMES[WEEK_START]).toBe("Monday");
  });

  it("move together when WEEK_START changes: the week and the first column both follow", async () => {
    for (const first of [0, 1, 3, 6]) {
      vi.resetModules();
      vi.doMock("../../src/db/time", async (original) => ({ ...(await original<typeof import("../../src/db/time")>()), WEEK_START: first }));
      const goal = await import("../../src/sync/goal");
      const grid = await import("../../src/sync/calendarGrid");
      const time = await import("../../src/db/time");
      const expected = time.startOfWeek("2026-11-05", first);
      expect(time.weekdayOf(expected)).toBe(first);
      // no argument given: each reads the constant
      expect(goal.weekOf("2026-11-05").start, `goal from ${first}`).toBe(expected);
      expect(goal.weeklyProgress([], 3, new Date("2026-11-05T15:00:00Z"), undefined, "UTC").start, `progress from ${first}`).toBe(expected);
      expect(time.weekdayOf(grid.monthGrid("2026-11")[0][0]), `grid from ${first}`).toBe(first);
      expect(grid.gridRange("2026-11").from, `range from ${first}`).toBe(grid.monthGrid("2026-11", first)[0][0]);
      // and the grid's row holding that day starts where the goal's week does
      const row = grid.monthGrid("2026-11").find((w) => w.includes("2026-11-05"))!;
      expect(row[0]).toBe(expected);
      expect(row[6]).toBe(shiftDay(expected, 6));
    }
  });
});

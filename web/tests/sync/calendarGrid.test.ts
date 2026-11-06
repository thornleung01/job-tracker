import { describe, expect, it } from "vitest";
import { MONTHS } from "../../src/db/dayText";
import { WEEK_START, daysInMonth } from "../../src/db/time";
import { gridRange, monthGrid, monthTitle, parseMonth, shiftMonth } from "../../src/sync/calendarGrid";

// the app tsconfig has no Node types; the tests run in Node
declare const process: { env: Record<string, string | undefined> };

const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const flat = (weeks: string[][]) => weeks.flat();

describe("monthGrid", () => {
  it("starts on Monday by default", () => {
    expect(WEEK_START).toBe(1);
    expect(monthGrid("2026-11")).toEqual(monthGrid("2026-11", 1));
    expect(monthGrid("2026-11")[0][0]).toBe("2026-10-26");   // November 1, 2026 is a Sunday: a Monday-first week reaches back 6 days
  });

  it("shows exactly 4 weeks for a common February that starts on the first weekday", () => {
    const sunday = monthGrid("2026-02", 0);   // February 1, 2026 is a Sunday and the month has 28 days
    expect(sunday).toHaveLength(4);
    expect(sunday[0][0]).toBe("2026-02-01");
    expect(sunday[3][6]).toBe("2026-02-28");
    const monday = monthGrid("2027-02", 1);   // February 1, 2027 is a Monday
    expect(monday).toHaveLength(4);
    expect(monday[3][6]).toBe("2027-02-28");
  });

  it("has a 29th of February in a leap year and none in a common year", () => {
    expect(flat(monthGrid("2028-02", 0))).toContain("2028-02-29");
    expect(flat(monthGrid("2028-02", 0)).filter((d) => d.startsWith("2028-02"))).toHaveLength(29);
    expect(flat(monthGrid("2026-02", 0)).filter((d) => d.startsWith("2026-02"))).toHaveLength(28);
    expect(flat(monthGrid("2100-02", 0)).filter((d) => d.startsWith("2100-02"))).toHaveLength(28);   // a century that isn't a leap year
    expect(flat(monthGrid("2000-02", 0)).filter((d) => d.startsWith("2000-02"))).toHaveLength(29);
  });

  it("runs from December into January", () => {
    const weeks = monthGrid("2026-12", 1);   // December 1, 2026 is a Tuesday
    expect(weeks[0]).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
    expect(weeks).toHaveLength(5);
    expect(weeks[4]).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
    expect(monthGrid("2027-01", 1)[0][0]).toBe("2026-12-28");
  });

  it("gives a different first column for a Sunday start and a Monday start", () => {
    expect(monthGrid("2026-10", 0)[0]).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(monthGrid("2026-10", 1)[0]).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(monthGrid("2026-10", 6)[0][0]).toBe("2026-09-26");   // Saturday start
  });

  it("needs 5 or 6 weeks when the month starts late in the week", () => {
    expect(monthGrid("2026-11", 0)).toHaveLength(5);
    expect(monthGrid("2026-11", 1)).toHaveLength(6);   // starts on the last column: 6 + 30 days
    expect(monthGrid("2026-08", 0)).toHaveLength(6);   // August 1, 2026 is a Saturday: 6 + 31 days
    expect(monthGrid("2026-10", 0)).toHaveLength(5);
  });

  it("is consistent for every month from 1990 to 2100 and every week start", () => {
    for (let y = 1990; y <= 2100; y++) {
      for (let m = 1; m <= 12; m++) {
        const month = `${y}-${String(m).padStart(2, "0")}`;
        const size = daysInMonth(y, m);
        for (let start = 0; start < 7; start++) {
          const weeks = monthGrid(month, start);
          const days = flat(weeks);
          const label = `${month} from ${start}`;
          expect(weeks.every((w) => w.length === 7), label).toBe(true);
          expect(weeks.length, label).toBeGreaterThanOrEqual(4);
          expect(weeks.length, label).toBeLessThanOrEqual(6);
          expect(weekdayOf(days[0]), label).toBe(start);
          expect(days.filter((d) => d.startsWith(month)), label).toHaveLength(size);
          // consecutive days, and no week made only of other months' days
          for (let i = 1; i < days.length; i++) expect(Date.parse(days[i]) - Date.parse(days[i - 1]), label).toBe(86_400_000);
          expect(weeks[0].some((d) => d.startsWith(month)), label).toBe(true);
          expect(weeks[weeks.length - 1].some((d) => d.startsWith(month)), label).toBe(true);
        }
      }
    }
  });

  it("gives the same days whatever zone the process is in", () => {
    const before = process.env.TZ;
    const expected = JSON.stringify([monthGrid("2026-03", 1), monthGrid("2026-11", 0), monthGrid("2026-10", 1)]);
    try {
      for (const zone of ["America/Toronto", "Pacific/Kiritimati", "Etc/GMT+12", "Australia/Lord_Howe", "Pacific/Apia", "UTC"]) {
        process.env.TZ = zone;
        expect(JSON.stringify([monthGrid("2026-03", 1), monthGrid("2026-11", 0), monthGrid("2026-10", 1)]), zone).toBe(expected);
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});

describe("gridRange", () => {
  it("runs from the first cell to the last cell, which reach into the next and previous months", () => {
    expect(gridRange("2026-11", 1)).toEqual({ from: "2026-10-26", to: "2026-12-06" });
    expect(gridRange("2026-11", 0)).toEqual({ from: "2026-11-01", to: "2026-12-05" });
    expect(gridRange("2026-12", 1)).toEqual({ from: "2026-11-30", to: "2027-01-03" });
    expect(gridRange("2026-02", 0)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("matches the grid it describes", () => {
    for (const month of ["2026-03", "2027-01", "2028-02"]) {
      const days = flat(monthGrid(month));
      expect(gridRange(month)).toEqual({ from: days[0], to: days[days.length - 1] });
    }
  });
});

describe("shiftMonth", () => {
  it("moves forward and back, across years", () => {
    expect(shiftMonth("2026-11", 1)).toBe("2026-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftMonth("2026-11", 14)).toBe("2028-01");
    expect(shiftMonth("2026-11", -11)).toBe("2025-12");
    expect(shiftMonth("2026-11", -23)).toBe("2024-12");
    expect(shiftMonth("2026-11", 0)).toBe("2026-11");
    expect(shiftMonth("2026-01", -12)).toBe("2025-01");
  });

  it("round-trips", () => {
    for (const n of [1, 5, 12, 13, 100, 1200]) expect(shiftMonth(shiftMonth("2026-07", n), -n)).toBe("2026-07");
  });
});

describe("parseMonth", () => {
  const TODAY = "2026-11-05";

  it("keeps a real month", () => {
    expect(parseMonth("2026-03", TODAY)).toBe("2026-03");
    expect(parseMonth("2026-12", TODAY)).toBe("2026-12");
    expect(parseMonth("1990-01", TODAY)).toBe("1990-01");
    expect(parseMonth("2100-12", TODAY)).toBe("2100-12");
  });

  it("falls back to the month of today for anything else", () => {
    for (const bad of [null, undefined, "", "soon", "2026-13", "2026-00", "2026-3", "2026-03-01", "26-03", " 2026-03", "2026-03 ", "2026/03", "20260-03"]) {
      expect(parseMonth(bad, TODAY), String(bad)).toBe("2026-11");
    }
  });

  it("moves a year outside 1990 to 2100 to the nearest month inside it", () => {
    expect(parseMonth("1989-12", TODAY)).toBe("1990-01");
    expect(parseMonth("0001-06", TODAY)).toBe("1990-01");
    expect(parseMonth("2101-01", TODAY)).toBe("2100-12");
    expect(parseMonth("9999-06", TODAY)).toBe("2100-12");
  });
});

describe("monthTitle", () => {
  it("writes the month name and year", () => {
    expect(monthTitle("2026-11")).toBe("November 2026");
    expect(monthTitle("2027-01")).toBe("January 2027");
    expect(MONTHS).toHaveLength(12);
    expect(monthTitle("1990-12")).toBe("December 1990");
  });
});

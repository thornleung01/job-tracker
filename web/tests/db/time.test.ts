// One rule for "which day is this?" (see the comment in src/db/time.ts). The rule is checked two ways:
//  - under real process time zones, through the real actions, list, detail text and CSV;
//  - in a sweep that hands the helpers an explicit IANA zone, so every zone from UTC-12 to UTC+14 is covered whatever
//    zone this machine is in (Intl takes a zone name; changing TZ would not reach a formatter that already exists).
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { dayText } from "../../src/db/dayText";
import { WEEK_START, dayOf, daysBetween, daysInMonth, idleDaysSince, iso, localDay, localToday, shiftDay, stampForDay, startOfWeek, weekdayOf } from "../../src/db/time";
import { applicationsToCsv, csvFilename, type CsvRow } from "../../src/portability/csv";
import { addApplication, setAppliedOn } from "../../src/sync/actions";
import { processMessages } from "../../src/sync/sync";
import { listApplications } from "../../src/sync/queries";
import { closeAll, dbWithAccount, mk } from "../sync/helpers";

afterEach(closeAll);

// the app tsconfig has no Node types; the tests run in Node
declare const process: { env: Record<string, string | undefined> };

/** Runs `fn` with the process in another time zone (Node re-reads TZ for Date, which is what the app's local-day code uses). */
async function inZone<T>(zone: string, fn: () => Promise<T> | T): Promise<T> {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

/** Every whole-hour offset from UTC-12 to UTC+14 as a fixed IANA zone, with its offset in hours. Etc/GMT+5 means UTC-5. */
const FIXED_ZONES: [string, number][] = Array.from({ length: 27 }, (_, i) => {
  const hours = i - 12;
  return [hours === 0 ? "UTC" : `Etc/GMT${hours > 0 ? "-" : "+"}${Math.abs(hours)}`, hours];
});
/** Real zones with daylight saving and odd offsets, where a fixed offset would hide a mistake. */
const REAL_ZONES = [
  "America/Toronto", "America/Vancouver", "America/St_Johns", "Europe/London", "Asia/Kolkata", "Asia/Kathmandu", "Australia/Sydney",
  "Australia/Lord_Howe", "Pacific/Auckland", "Pacific/Chatham", "Pacific/Apia", "Pacific/Kiritimati", "Pacific/Pago_Pago",
];

const HOUR = 3_600_000;
const addDay = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 24 * HOUR).toISOString().slice(0, 10);
const day2 = (ms: number, hours: number): string => new Date(ms + hours * HOUR).toISOString().slice(0, 10);

describe("localDay", () => {
  it("is the calendar day an instant falls on in a fixed-offset zone (checked against plain arithmetic)", () => {
    const start = Date.parse("2026-10-20T00:00:00Z");
    for (const [zone, hours] of FIXED_ZONES) {
      for (let i = 0; i < 96; i++) {
        const at = start + i * 30 * 60_000;
        expect(localDay(new Date(at), zone), `${zone} at ${new Date(at).toISOString()}`).toBe(day2(at, hours));
      }
    }
  });

  it("follows daylight saving in a real zone", () => {
    // Toronto switched to standard time on 2026-11-01 at 06:00 UTC
    expect(localDay("2026-11-01T05:30:00Z", "America/Toronto")).toBe("2026-11-01"); // 01:30 EDT
    expect(localDay("2026-11-02T04:30:00Z", "America/Toronto")).toBe("2026-11-01"); // 23:30 EST
    expect(localDay("2026-11-02T05:30:00Z", "America/Toronto")).toBe("2026-11-02"); // 00:30 EST
  });

  it("reads the process zone when none is given, and localToday agrees", async () => {
    await inZone("America/Toronto", () => {
      const at = new Date("2026-10-22T01:00:00Z");
      expect(localDay(at)).toBe("2026-10-21");
      expect(localToday(at)).toBe("2026-10-21");
    });
    await inZone("Pacific/Kiritimati", () => expect(localToday(new Date("2026-10-21T10:00:00Z"))).toBe("2026-10-22"));
  });

  it("refuses a value that is not a time", () => {
    expect(() => localDay("nope")).toThrow(RangeError);
  });
});

describe("dayOf", () => {
  it("reads a picked day (noon UTC) and a plain day by their date, in any zone", () => {
    for (const zone of ["America/Toronto", "Pacific/Kiritimati", "Etc/GMT+12", "Asia/Kolkata"]) {
      expect(dayOf("2026-10-21T12:00:00Z", zone)).toBe("2026-10-21");
      expect(dayOf("2026-10-21", zone)).toBe("2026-10-21");
    }
  });

  it("reads any other time as the day it falls on for the viewer", () => {
    expect(dayOf("2026-10-22T01:00:00Z", "America/Toronto")).toBe("2026-10-21");
    expect(dayOf("2026-10-21T22:00:00Z", "Australia/Sydney")).toBe("2026-10-22");
    expect(dayOf("2026-10-21T23:30:00Z", "Pacific/Kiritimati")).toBe("2026-10-22");
  });

  it("is empty for nothing or for text that is not a time", () => {
    expect([dayOf(null), dayOf(undefined), dayOf(""), dayOf("soon")]).toEqual(["", "", "", ""]);
  });
});

describe("stampForDay", () => {
  it("round-trips the picked day in every zone from UTC-12 to UTC+14, at every hour of the day", () => {
    const start = Date.parse("2026-10-20T00:00:00Z");
    for (const [zone] of [...FIXED_ZONES, ...REAL_ZONES.map((z) => [z])]) {
      for (let i = 0; i < 96; i++) {
        const now = new Date(start + i * 30 * 60_000);
        const today = localToday(now, zone as string);
        for (const back of [0, 1, 2, 10, 400]) {
          const picked = addDay(today, -back);
          const stamp = stampForDay(picked, now, zone as string);
          expect(dayOf(stamp, zone as string), `${zone} now=${iso(now)} picked=${picked} stamp=${stamp}`).toBe(picked);
          expect(dayText(stamp, "plain", now, zone as string)).toBe(dayText(picked, "plain", now));
        }
      }
    }
  });

  it("stamps today with the current time, so it sorts among today's mail, and any other day with noon UTC", () => {
    const now = new Date("2026-10-21T22:00:00Z");
    expect(stampForDay("2026-10-22", now, "Australia/Sydney")).toBe("2026-10-21T22:00:00Z");
    expect(stampForDay("2026-10-21", now, "Australia/Sydney")).toBe("2026-10-21T12:00:00Z");
  });

  it("moves a 'now' that is exactly noon UTC by a second, so it isn't mistaken for a picked day", () => {
    const now = new Date("2026-10-20T12:00:00.400Z"); // 00:00 on Oct 21 at UTC+12
    const stamp = stampForDay("2026-10-21", now, "Etc/GMT-12");
    expect(stamp).toBe("2026-10-20T12:00:01Z");
    expect(dayOf(stamp, "Etc/GMT-12")).toBe("2026-10-21");
  });

  it("never stamps a time that is still ahead by more than the zone's head start", () => {
    // Kiritimati at 00:30 on Oct 22 (10:30 UTC on Oct 21): yesterday is Oct 21, whose noon UTC is 90 minutes away. It still reads as Oct 21.
    const now = new Date("2026-10-21T10:30:00Z");
    expect(stampForDay("2026-10-21", now, "Pacific/Kiritimati")).toBe("2026-10-21T12:00:00Z");
    expect(idleDaysSince("2026-10-21T12:00:00Z", now, "Pacific/Kiritimati")).toBe(1);
  });

  it("refuses a day that is not real, in the future, or before 1990", () => {
    const now = new Date("2026-10-21T12:00:00Z");
    expect(() => stampForDay("21/10/2026", now, "UTC")).toThrow(/year-month-day/);
    expect(() => stampForDay("2026-02-30", now, "UTC")).toThrow(/year-month-day/);
    expect(() => stampForDay("2026-10-22", now, "UTC")).toThrow(/future/);
    expect(() => stampForDay("1989-12-31", now, "UTC")).toThrow(/1990/);
    expect(stampForDay("1990-01-01", now, "UTC")).toBe("1990-01-01T12:00:00Z");
  });

  it("judges 'the future' by the viewer's day, not the UTC day", () => {
    const now = new Date("2026-10-21T22:00:00Z"); // Oct 22 in Sydney, Oct 21 in Toronto
    expect(() => stampForDay("2026-10-22", now, "America/Toronto")).toThrow(/future/);
    expect(stampForDay("2026-10-22", now, "Australia/Sydney")).toBe("2026-10-21T22:00:00Z");
  });
});

describe("idleDaysSince", () => {
  it("counts calendar days in the viewer's zone, so a late-evening mail is not a day older than it looks", () => {
    // a mail at 21:00 Toronto on Oct 14, looked at 09:00 Toronto on Oct 21: seven calendar days, though 6.5 days have passed
    const mail = "2026-10-15T01:00:00Z";
    const now = new Date("2026-10-21T13:00:00Z");
    expect(idleDaysSince(mail, now, "America/Toronto")).toBe(7);
  });

  it("is never negative: a day stamp a little ahead of the clock is today", () => {
    const now = new Date("2026-10-21T10:30:00Z");
    expect(idleDaysSince("2026-10-22T12:00:00Z", now, "Pacific/Kiritimati")).toBe(0);
    expect(idleDaysSince("2027-01-01T00:00:00Z", now, "UTC")).toBe(0);
  });

  it("is null when there is no usable time", () => {
    expect([idleDaysSince(null), idleDaysSince(undefined), idleDaysSince("soon")]).toEqual([null, null, null]);
  });
});

describe("daysBetween", () => {
  it("counts calendar days across months and years, and is negative backwards", () => {
    expect(daysBetween("2026-10-12", "2026-10-12")).toBe(0);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2026-10-19", "2026-10-12")).toBe(-7);
  });
});

describe("a 9 pm Toronto email, from sync to the list, the detail text and the CSV", () => {
  // 2026-10-22T01:00:00Z is 9 pm on Oct 21 in Toronto
  const evening = { ...mk("e1", "Thank you for applying to Acme"), receivedAt: "2026-10-22T01:00:00Z" };

  it("is Oct 21 everywhere it is shown, and the export is named for today's date", async () => {
    await inZone("America/Toronto", async () => {
      const { db, acct } = await dbWithAccount();
      await processMessages(db, acct, [evening], new Date("2026-10-22T01:30:00Z"));
      const [row] = await listApplications(db, { now: new Date("2026-10-22T01:30:00Z") });
      expect(row.appliedAt).toBe("2026-10-22T01:00:00Z");
      expect(dayText(row.appliedAt, "short", new Date("2026-10-22T01:30:00Z"))).toBe("Oct 21");
      expect(dayText(row.appliedAt)).toBe("October 21, 2026");
      expect(row.idleDays).toBe(0);
      const csv = applicationsToCsv([{ ...row, nEmails: 1, rounds: null } as CsvRow]);
      expect(csv.split("\r\n")[1]).toBe("Acme,Unknown role,Applied,2026-10-21,2026-10-21,1,,,,,");
      expect(csvFilename(new Date("2026-10-22T01:30:00Z"))).toBe("job-tracker-applications-2026-10-21.csv");
    });
  });

  it("is already Oct 22 for someone in Sydney, where it is the next morning", async () => {
    await inZone("Australia/Sydney", () => {
      expect(dayText("2026-10-22T01:00:00Z", "plain")).toBe("Oct 22");
      expect(csvFilename(new Date("2026-10-22T01:30:00Z"))).toBe("job-tracker-applications-2026-10-22.csv");
    });
  });
});

describe("a day you pick by hand", () => {
  it("reads back as that day when logged in the morning in Sydney, where UTC is still yesterday", async () => {
    await inZone("Australia/Sydney", async () => {
      const { db } = await dbWithAccount();
      const now = new Date("2026-10-21T22:00:00Z"); // 09:00 on Oct 22 in Sydney
      const today = await addApplication(db, { company: "Acme", appliedOn: "2026-10-22" }, now);
      const yesterday = await addApplication(db, { company: "Beta", appliedOn: "2026-10-21" }, now);
      expect(dayText((await db.applications.get(today))!.appliedAt, "plain")).toBe("Oct 22");
      expect(dayText((await db.applications.get(yesterday))!.appliedAt, "plain")).toBe("Oct 21");
      await setAppliedOn(db, yesterday, "2026-10-22", now);
      expect(dayText((await db.applications.get(yesterday))!.appliedAt, "plain")).toBe("Oct 22");
      expect(csvDay((await db.applications.get(yesterday))!.appliedAt)).toBe("2026-10-22");
    });
  });

  it("reads back as that day on Kiritimati (UTC+14), also just after midnight when noon UTC is still ahead", async () => {
    await inZone("Pacific/Kiritimati", async () => {
      const { db } = await dbWithAccount();
      const now = new Date("2026-10-21T10:30:00Z"); // 00:30 on Oct 22 there
      const id = await addApplication(db, { company: "Acme", appliedOn: "2026-10-21" }, now);
      expect(dayText((await db.applications.get(id))!.appliedAt, "plain", now)).toBe("Oct 21");
    });
  });
});

/** The CSV's day for a stored time. */
function csvDay(value: string | null): string {
  return dayOf(value);
}

describe("shiftDay", () => {
  it("moves a day forward and back by calendar days", () => {
    expect(shiftDay("2026-11-05", 0)).toBe("2026-11-05");
    expect(shiftDay("2026-11-05", 1)).toBe("2026-11-06");
    expect(shiftDay("2026-11-05", -5)).toBe("2026-10-31");
    expect(shiftDay("2026-11-05", 7)).toBe("2026-11-12");
    expect(shiftDay("2026-11-05", 30)).toBe("2026-12-05");
  });

  it("crosses month and year ends", () => {
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2027-01-01", -1)).toBe("2026-12-31");
    expect(shiftDay("2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftDay("2026-10-25", 7)).toBe("2026-11-01");
  });

  it("knows leap days", () => {
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDay("2028-02-29", 1)).toBe("2028-03-01");
    expect(shiftDay("2026-02-28", 1)).toBe("2026-03-01");
    expect(shiftDay("2028-03-01", -1)).toBe("2028-02-29");
    expect(shiftDay("2027-02-28", 366)).toBe("2028-02-29");
    expect(shiftDay("2100-02-28", 1)).toBe("2100-03-01");
  });

  it("agrees with daysBetween", () => {
    for (const n of [-400, -31, -1, 0, 1, 29, 30, 365, 1000]) expect(daysBetween("2026-03-08", shiftDay("2026-03-08", n))).toBe(n);
  });

  it("is the same in every zone, including across daylight saving changes", async () => {
    for (const zone of [...REAL_ZONES, "Etc/GMT-14", "Etc/GMT+12"]) {
      await inZone(zone, () => {
        expect(shiftDay("2026-03-07", 1), zone).toBe("2026-03-08");
        expect(shiftDay("2026-03-08", 1), zone).toBe("2026-03-09");
        expect(shiftDay("2026-10-31", 1), zone).toBe("2026-11-01");
        expect(shiftDay("2026-11-01", 1), zone).toBe("2026-11-02");
        expect(shiftDay("2026-04-05", 7), zone).toBe("2026-04-12");   // Sydney and Lord Howe end daylight saving
        expect(shiftDay("2026-10-04", -7), zone).toBe("2026-09-27");   // Sydney starts it
      });
    }
  });
});

describe("daysInMonth", () => {
  it("gives the length of each month", () => {
    expect(Array.from({ length: 12 }, (_, i) => daysInMonth(2026, i + 1))).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  });

  it("counts a leap February in leap years only", () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it("is the same in every zone", async () => {
    for (const zone of ["America/Toronto", "Pacific/Kiritimati", "Etc/GMT+12", "Australia/Lord_Howe"]) {
      await inZone(zone, () => {
        expect(daysInMonth(2026, 3), zone).toBe(31);
        expect(daysInMonth(2028, 2), zone).toBe(29);
        expect(daysInMonth(2026, 12), zone).toBe(31);
      });
    }
  });
});

describe("weekdayOf and startOfWeek", () => {
  it("numbers the weekdays like Date.getDay(): 0 is Sunday", () => {
    // 2026-11-01 is a Sunday
    expect(Array.from({ length: 7 }, (_, i) => weekdayOf(shiftDay("2026-11-01", i)))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOf("2028-02-29")).toBe(2);   // a leap day, a Tuesday
    expect(weekdayOf("1990-01-01")).toBe(1);
  });

  it("starts the week on Monday unless told otherwise", () => {
    expect(WEEK_START).toBe(1);
    expect(startOfWeek("2026-11-05")).toBe("2026-11-02");   // a Thursday
    expect(startOfWeek("2026-11-02")).toBe("2026-11-02");
    expect(startOfWeek("2026-11-08")).toBe("2026-11-02");   // the Sunday ends the week
    expect(startOfWeek("2026-11-09")).toBe("2026-11-09");
  });

  it("takes any weekday as the first, crossing a year end and a leap day", () => {
    expect(startOfWeek("2026-11-05", 0)).toBe("2026-11-01");
    expect(startOfWeek("2026-11-05", 6)).toBe("2026-10-31");
    expect(startOfWeek("2027-01-01", 1)).toBe("2026-12-28");
    expect(startOfWeek("2028-03-01", 1)).toBe("2028-02-28");
    expect(startOfWeek("2028-03-01", 3)).toBe("2028-03-01");
    for (let first = 0; first < 7; first++) {
      for (let i = 0; i < 14; i++) {
        const day = shiftDay("2026-12-27", i);
        const start = startOfWeek(day, first);
        expect(weekdayOf(start), `${day} from ${first}`).toBe(first);
        expect(daysBetween(start, day) >= 0 && daysBetween(start, day) < 7, `${day} from ${first}`).toBe(true);
      }
    }
  });

  it("is the same in every zone, including across daylight saving changes", async () => {
    for (const zone of [...REAL_ZONES, "Etc/GMT-14", "Etc/GMT+12"]) {
      await inZone(zone, () => {
        expect(startOfWeek("2026-03-08"), zone).toBe("2026-03-02");   // the day clocks go forward in Toronto
        expect(startOfWeek("2026-11-01"), zone).toBe("2026-10-26");   // the day they go back
        expect(weekdayOf("2026-03-08"), zone).toBe(0);
      });
    }
  });
});

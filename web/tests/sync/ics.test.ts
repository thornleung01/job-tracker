import { describe, expect, it, vi } from "vitest";
import { icsFilename, icsForInterviews, type IcsEvent } from "../../src/sync/ics";

const NOW = new Date("2026-11-05T15:04:09Z");
const BASE = "https://me.github.io/job-tracker/";
const ev = (o: Partial<IcsEvent> = {}): IcsEvent => ({ appId: 7, company: "Acme", role: "Analyst", stage: "Interview", day: "2026-11-12", ...o });
const make = (events: IcsEvent[]) => icsForInterviews(events, NOW, BASE);

/** The physical lines (CRLF-separated) and the logical lines (after unfolding), the way a calendar app reads the file. */
const physical = (ics: string) => ics.split("\r\n");
const logical = (ics: string) => ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter((l) => l !== "");
const octets = (s: string) => new TextEncoder().encode(s).length;
const prop = (ics: string, name: string) => logical(ics).filter((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));

describe("icsForInterviews: shape", () => {
  it("is a CRLF-ended VCALENDAR with the calendar properties and no bare LF", () => {
    const ics = make([ev()]);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(prop(ics, "CALSCALE")).toEqual(["CALSCALE:GREGORIAN"]);
    expect(prop(ics, "PRODID")).toHaveLength(1);
  });

  it("writes one all-day entry per interview day with the next day as the end", () => {
    const ics = make([ev(), ev({ appId: 8, company: "Beta", day: "2026-11-13" })]);
    expect(logical(ics).filter((l) => l === "BEGIN:VEVENT")).toHaveLength(2);
    expect(prop(ics, "DTSTART")).toEqual(["DTSTART;VALUE=DATE:20261112", "DTSTART;VALUE=DATE:20261113"]);
    expect(prop(ics, "DTEND")).toEqual(["DTEND;VALUE=DATE:20261113", "DTEND;VALUE=DATE:20261114"]);
    expect(prop(ics, "DTSTAMP")).toEqual(["DTSTAMP:20261105T150409Z", "DTSTAMP:20261105T150409Z"]);
  });

  it("names the company and role, and the stage and a link back in the description", () => {
    const ics = make([ev()]);
    expect(prop(ics, "SUMMARY")).toEqual(["SUMMARY:Interview: Acme - Analyst"]);
    expect(prop(ics, "DESCRIPTION")).toEqual([`DESCRIPTION:Stage: Interview\\nOpen in Job Tracker: https://me.github.io/job-tracker/#/app/7`.replace(/,/g, "\\,")]);
  });

  it("leaves the role out when it is unknown or empty, and the stage when it is empty", () => {
    expect(prop(make([ev({ role: "Unknown role" })]), "SUMMARY")).toEqual(["SUMMARY:Interview: Acme"]);
    expect(prop(make([ev({ role: "  " })]), "SUMMARY")).toEqual(["SUMMARY:Interview: Acme"]);
    expect(prop(make([ev({ stage: "" })]), "DESCRIPTION")[0]).toBe("DESCRIPTION:Open in Job Tracker: https://me.github.io/job-tracker/#/app/7");
  });

  it("has no entries for an empty list, and the file is still well formed", () => {
    const ics = make([]);
    expect(ics).toBe(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Job Tracker//Interviews//EN", "CALSCALE:GREGORIAN", "END:VCALENDAR", ""].join("\r\n"));
  });

  it("uses the site address from the config by default", () => {
    expect(icsForInterviews([ev()], NOW)).toMatch(/#\/app\/7\r\n/);
  });

  it("sorts by day, then by application", () => {
    const ics = make([ev({ appId: 9, day: "2026-12-01" }), ev({ appId: 5, day: "2026-11-12" }), ev({ appId: 3, day: "2026-11-12" })]);
    expect(prop(ics, "UID")).toEqual(["UID:jobtracker-3-20261112@job-tracker", "UID:jobtracker-5-20261112@job-tracker", "UID:jobtracker-9-20261201@job-tracker"]);
  });
});

describe("icsForInterviews: UID", () => {
  it("is stable for an application and day, whatever else changes", () => {
    const a = prop(make([ev()]), "UID");
    const b = icsForInterviews([ev({ company: "Renamed", role: "Other", stage: "Offer" })], new Date("2030-01-01T00:00:00Z"), "https://x.test/");
    expect(prop(b, "UID")).toEqual(a);
    expect(a).toEqual(["UID:jobtracker-7-20261112@job-tracker"]);
  });

  it("differs between days and between applications", () => {
    const uids = prop(make([ev(), ev({ day: "2026-11-13" }), ev({ appId: 8 })]), "UID");
    expect(new Set(uids).size).toBe(3);
  });

  it("makes one entry for the same application and day given twice", () => {
    expect(prop(make([ev(), ev()]), "UID")).toHaveLength(1);
  });
});

describe("icsForInterviews: all-day date maths", () => {
  it.each([
    ["2026-11-30", "20261130", "20261201"],
    ["2026-12-31", "20261231", "20270101"],
    ["2028-02-28", "20280228", "20280229"],
    ["2028-02-29", "20280229", "20280301"],
    ["2027-02-28", "20270228", "20270301"],
    ["2026-01-31", "20260131", "20260201"],
    ["2099-12-31", "20991231", "21000101"],
  ])("%s ends on the next day", (day, start, end) => {
    const ics = make([ev({ day })]);
    expect(prop(ics, "DTSTART")).toEqual([`DTSTART;VALUE=DATE:${start}`]);
    expect(prop(ics, "DTEND")).toEqual([`DTEND;VALUE=DATE:${end}`]);
  });

  it("gives the same file in every time zone", () => {
    const days = ["2026-03-08", "2026-11-01", "2026-12-31", "2028-02-29", "2026-11-12"];
    const events = days.map((day, i) => ev({ appId: i + 1, day }));
    try {
      const files = ["UTC", "America/Toronto", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kolkata", "Pacific/Chatham", "Australia/Lord_Howe"].map((tz) => {
        vi.stubEnv("TZ", tz);
        return icsForInterviews(events, NOW, BASE);
      });
      expect(new Set(files).size).toBe(1);
      expect(prop(files[0], "DTEND")).toContain("DTEND;VALUE=DATE:20280301");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("leaves out a day that isn't a real date or an application that isn't a number", () => {
    const ics = make([ev({ day: "2027-02-29" }), ev({ day: "2026-13-01" }), ev({ day: "soon" }), ev({ day: "" }), ev({ appId: Number.NaN }), ev({ appId: -1 }), ev({ appId: 1.5 })]);
    expect(prop(ics, "UID")).toEqual([]);
  });
});

describe("icsForInterviews: escaping and folding", () => {
  it("escapes backslashes, semicolons, commas and line breaks in text", () => {
    const ics = make([ev({ company: "Smith, Jones; & Co \\ Ltd", role: "a\nb\r\nc\rd" })]);
    expect(prop(ics, "SUMMARY")).toEqual(["SUMMARY:Interview: Smith\\, Jones\\; & Co \\\\ Ltd - a b c d"]);
  });

  it("folds a long line at 75 octets with a space starting each continuation, and unfolds to the original", () => {
    const role = "Principal Staff Senior Distinguished Machine Learning Platform Reliability Engineer".repeat(1);
    const ics = make([ev({ company: "Acme Corporation International Holdings Limited", role })]);
    const lines = physical(ics);
    expect(lines.some((l) => l.startsWith(" "))).toBe(true);
    for (const l of lines) expect(octets(l)).toBeLessThanOrEqual(75);
    expect(prop(ics, "SUMMARY")).toEqual([`SUMMARY:Interview: Acme Corporation International Holdings Limited - ${role}`]);
  });

  it("never folds inside a character, however many octets it takes", () => {
    const company = "\u{1F600}é中".repeat(20);
    const ics = make([ev({ company, role: "" })]);
    for (const l of physical(ics)) expect(octets(l)).toBeLessThanOrEqual(75);
    expect(ics).not.toContain("\ufffd");
    expect(prop(ics, "SUMMARY")).toEqual([`SUMMARY:Interview: ${company}`]);
    // Every physical line must itself be valid text: re-encoding it loses nothing.
    for (const l of physical(ics)) expect(new TextDecoder().decode(new TextEncoder().encode(l))).toBe(l);
  });

  it("folds exactly at the limit: a 75-octet line is not folded, a 76-octet line is", () => {
    const base = "SUMMARY:Interview: ".length;
    const exact = make([ev({ company: "x".repeat(75 - base), role: "" })]);
    expect(physical(exact).filter((l) => l.startsWith("SUMMARY"))[0]).toHaveLength(75);
    const after = (ics: string) => physical(ics)[physical(ics).findIndex((l) => l.startsWith("SUMMARY")) + 1];
    expect(after(exact)).toMatch(/^DESCRIPTION:/);
    const over = make([ev({ company: "x".repeat(76 - base), role: "" })]);
    expect(after(over)).toBe(" x");
  });
});

describe("icsForInterviews: untrusted text", () => {
  const HOSTILE = [
    "Acme\r\nATTENDEE:mailto:evil@example.com",
    "Acme\nDTSTART;VALUE=DATE:19700101",
    "Acme\rEND:VEVENT\r\nBEGIN:VEVENT",
    "Acme\u2028X-EVIL:1",
    "Acme\u0085X-EVIL:1",
    "Acme\u0000X-EVIL:1",
    "Acme\u202eevil",
  ];

  it.each(HOSTILE)("cannot add a property through the company %j", (company) => {
    const ics = make([ev({ company })]);
    expect(logical(ics).filter((l) => l.startsWith("BEGIN:VEVENT"))).toHaveLength(1);
    expect(logical(ics).filter((l) => l.startsWith("END:VEVENT"))).toHaveLength(1);
    expect(logical(ics).filter((l) => l.startsWith("ATTENDEE") || l.startsWith("X-EVIL"))).toEqual([]);
    expect(prop(ics, "DTSTART")).toEqual(["DTSTART;VALUE=DATE:20261112"]);
    expect(ics).not.toMatch(/[\u0000\u0085\u2028\u2029\u202e]/);
  });

  it.each(HOSTILE)("cannot add a property through the role or stage %j", (text) => {
    const ics = make([ev({ role: text, stage: text })]);
    expect(logical(ics).filter((l) => l.startsWith("ATTENDEE") || l.startsWith("X-EVIL"))).toEqual([]);
    expect(prop(ics, "DTSTART")).toHaveLength(1);
  });

  it("cannot add a property through the site address", () => {
    const ics = icsForInterviews([ev()], NOW, "https://x.test/\r\nATTENDEE:mailto:evil@example.com#");
    expect(logical(ics).filter((l) => l.startsWith("ATTENDEE"))).toEqual([]);
  });

  it("cuts the company and role to the limits the app saves", () => {
    const ics = make([ev({ company: "C".repeat(500), role: "R".repeat(500) })]);
    const summary = prop(ics, "SUMMARY")[0];
    expect(summary).toBe(`SUMMARY:Interview: ${"C".repeat(80)} - ${"R".repeat(100)}`);
  });

  it("copes with text that isn't text at all", () => {
    const odd = { appId: 7, company: null, role: undefined, stage: 5, day: "2026-11-12" } as unknown as IcsEvent;
    expect(prop(make([odd]), "SUMMARY")).toEqual(["SUMMARY:Interview"]);
  });
});

describe("icsFilename", () => {
  it("names the file after the day", () => {
    expect(icsFilename("2026-11-12")).toBe("job-tracker-interview-2026-11-12.ics");
  });
});

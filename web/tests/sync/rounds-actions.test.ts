import { afterEach, describe, expect, it } from "vitest";
import { addApp, cleanup, freshDb } from "../pages/applications/harness";
import { addApplication, mergeApplications, setAppliedOn, setInterviewRounds } from "../../src/sync/actions";
import { lowerMeridiem } from "../../src/components/TimeText";

afterEach(cleanup);

describe("setAppliedOn", () => {
  it("refuses an implausible year, a future day and a malformed day", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme");
    await expect(setAppliedOn(db, id, "1985-05-05")).rejects.toThrow(/1990/);
    await expect(setAppliedOn(db, id, "2999-01-01")).rejects.toThrow(/future/);
    await expect(setAppliedOn(db, id, "next week")).rejects.toThrow(/year-month-day/);
  });
});

describe("addApplication dates", () => {
  it("shares the day rules with setAppliedOn", async () => {
    const db = freshDb();
    await expect(addApplication(db, { company: "Acme", appliedOn: "1985-05-05" })).rejects.toThrow(/1990/);
    await expect(addApplication(db, { company: "Acme", appliedOn: "2999-01-01" })).rejects.toThrow(/future/);
    const id = await addApplication(db, { company: "Acme", appliedOn: "2026-01-15" });
    expect((await db.applications.get(id))?.appliedAt).toBe("2026-01-15T12:00:00Z");
  });
});

describe("setInterviewRounds", () => {
  it("keeps a number you typed through a merge when the other application has none", async () => {
    const db = freshDb();
    const from = await addApp(db, "Acme");
    const into = await addApp(db, "Acme Inc");
    await setInterviewRounds(db, from, 3);
    await mergeApplications(db, from, into);
    expect((await db.applications.get(into))?.interviewRounds).toBe(3);
    await setInterviewRounds(db, into, null);
    expect((await db.applications.get(into))?.interviewRounds).toBeUndefined();
  });
});

describe("lowerMeridiem", () => {
  it.each([
    ["10:05 AM", "10:05 am"],
    ["10:05 PM", "10:05 pm"],
    ["10:05 a.m.", "10:05 am"],
    ["Oct 21, 11:05 p.m. EDT", "Oct 21, 11:05 pm EDT"],
    ["TEAM meeting", "TEAM meeting"],
    ["10:05\u202fPM", "10:05 pm"],            // Intl's narrow no-break space
    ["10:05PM", "10:05 pm"],
    ["9 a.m. and 5 p.m.", "9 am and 5 pm"],     // two in one line, each keeps its own digit
    ["Oct 21, 9:05 AM – 10:05 AM", "Oct 21, 9:05 am – 10:05 am"],
    ["AM or PM", "AM or PM"],                   // no digit before it: left alone
    ["5 amazing days", "5 amazing days"],
    ["at 9 AMs", "at 9 AMs"],
  ])("%s", (input, expected) => expect(lowerMeridiem(input)).toBe(expected));

  // Older Safari (before 16.4) throws a SyntaxError on a lookbehind and the whole bundle fails to run.
  it("is written without a regular-expression lookbehind", () => {
    expect(lowerMeridiem.toString()).not.toMatch(/\(\?<[=!]/);
  });
});

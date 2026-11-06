import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication } from "../../src/db/repo";
import type { Stage } from "../../src/db/stages";
import { localDay, shiftDay } from "../../src/db/time";
import {
  calendarEvents, calendarSteps, KIND_ORDER, type CalendarEvent, type CalendarKind, type CalendarRow, type CalendarStep,
} from "../../src/sync/calendar";
import { gridRange, monthGrid } from "../../src/sync/calendarGrid";
import { listApplications } from "../../src/sync/queries";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

// the app tsconfig has no Node types; the tests run in Node
declare const process: { env: Record<string, string | undefined> };

/** Runs `fn` with the process in another time zone (the app reads days from Date's local getters). */
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

const TODAY = "2026-11-05";
const RANGE = { from: "2026-10-01", to: "2026-11-30" };

let nextId = 0;
const row = (o: Partial<CalendarRow> = {}): CalendarRow => ({
  id: ++nextId, company: "Acme", role: "Analyst", stage: "Applied", appliedAt: null, lastActivity: null, followUp: false, interviewDays: [], ...o,
});
const step = (applicationId: number, label: string, occurredAt: string): CalendarStep => ({ applicationId, label, occurredAt });

const all = (events: Map<string, CalendarEvent[]>): CalendarEvent[] => [...events.values()].flat();
const kinds = (events: Map<string, CalendarEvent[]>, day: string): CalendarKind[] => (events.get(day) ?? []).map((e) => e.kind);
const labels = (events: Map<string, CalendarEvent[]>, day: string): string[] => (events.get(day) ?? []).map((e) => e.label);

describe("interview events", () => {
  it("puts an interview on every interview day, past and future, with a label and the application's details", () => {
    const r = row({ company: "Acme", role: "Analyst", stage: "Interview", interviewDays: ["2026-10-20", "2026-11-05", "2026-11-12"] });
    const events = calendarEvents([r], [], TODAY, RANGE);
    expect(all(events).map((e) => [e.day, e.kind, e.label, e.past])).toEqual([
      ["2026-10-20", "interview", "Interview", true], ["2026-11-05", "interview", "Interview", false], ["2026-11-12", "interview", "Interview", false],
    ]);
    expect(events.get("2026-11-12")![0]).toMatchObject({ appId: r.id, company: "Acme", role: "Analyst", stage: "Interview", day: "2026-11-12" });
  });

  it("hides today and future interviews for a Rejected or Offer application, and keeps the past ones", () => {
    for (const stage of ["Rejected", "Offer"] as Stage[]) {
      const events = calendarEvents([row({ stage, interviewDays: ["2026-10-20", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-20"] })], [], TODAY, RANGE);
      expect(all(events).map((e) => e.day), stage).toEqual(["2026-10-20", "2026-11-04"]);
    }
  });

  it("keeps future interviews for every other stage", () => {
    for (const stage of ["Applied", "Heard back", "Assessment", "Interview"] as Stage[]) {
      const events = calendarEvents([row({ stage, interviewDays: ["2026-11-20"] })], [], TODAY, RANGE);
      expect(kinds(events, "2026-11-20"), stage).toContain("interview");
    }
  });
});

describe("applied events", () => {
  it("puts one on the day you applied, as a picked day or as an instant in your zone", () => {
    const picked = calendarEvents([row({ appliedAt: "2026-10-21T12:00:00Z" })], [], TODAY, RANGE);
    expect(all(picked).filter((e) => e.kind === "applied").map((e) => [e.day, e.label])).toEqual([["2026-10-21", "Applied"]]);
    const instant = "2026-10-22T03:00:00Z";
    const events = calendarEvents([row({ appliedAt: instant })], [], TODAY, RANGE);
    expect(kinds(events, localDay(instant))).toContain("applied");
  });

  it("has none when the applied day is unknown", () => {
    expect(all(calendarEvents([row({ appliedAt: null, stage: "Interview" })], [], TODAY, RANGE))).toEqual([]);
  });
});

describe("offer events", () => {
  it("shows the decision deadline at Offer, even when it has passed", () => {
    const events = calendarEvents([row({ stage: "Offer", offerDeadline: "2026-11-20" }), row({ stage: "Offer", offerDeadline: "2026-10-15" })], [], TODAY, RANGE);
    expect(labels(events, "2026-11-20")).toEqual(["Offer decision due"]);
    expect(events.get("2026-10-15")![0]).toMatchObject({ kind: "offer", past: true });
    expect(events.get("2026-11-20")![0].past).toBe(false);
  });

  it("shows nothing at any other stage, or for a deadline that isn't a real day", () => {
    for (const stage of ["Applied", "Heard back", "Assessment", "Interview", "Rejected"] as Stage[]) {
      expect(kinds(calendarEvents([row({ stage, offerDeadline: "2026-11-20" })], [], TODAY, RANGE), "2026-11-20"), stage).not.toContain("offer");
    }
    for (const bad of ["2026-02-30", "soon", "", "2026-11-20T10:00:00Z"]) {
      expect(all(calendarEvents([row({ stage: "Offer", offerDeadline: bad })], [], TODAY, RANGE)).filter((e) => e.kind === "offer"), bad).toEqual([]);
    }
    expect(all(calendarEvents([row({ stage: "Offer" })], [], TODAY, RANGE))).toEqual([]);
  });
});

describe("follow-up events", () => {
  it("falls on the last activity plus 7 days, labelled 'due' when it is ahead", () => {
    const events = calendarEvents([row({ stage: "Applied", lastActivity: "2026-11-02T12:00:00Z" })], [], TODAY, RANGE);
    expect(all(events).map((e) => [e.day, e.kind, e.label, e.past])).toEqual([["2026-11-09", "followUp", "Follow up due", false]]);
  });

  it("is due today when the last activity was 7 days ago", () => {
    const events = calendarEvents([row({ lastActivity: "2026-10-29T12:00:00Z", followUp: true })], [], TODAY, RANGE);
    expect(all(events).map((e) => [e.day, e.label, e.past])).toEqual([["2026-11-05", "Follow up due", false]]);
  });

  it("says 'was due' once the day has passed and the Follow up? tag shows", () => {
    const events = calendarEvents([row({ stage: "Heard back", lastActivity: "2026-10-20T12:00:00Z", followUp: true })], [], TODAY, RANGE);
    expect(all(events).map((e) => [e.day, e.label, e.past])).toEqual([["2026-10-27", "Follow up was due", true]]);
  });

  it("keeps 'due' for a past day when the tag doesn't show", () => {
    const events = calendarEvents([row({ lastActivity: "2026-10-20T12:00:00Z", followUp: false })], [], TODAY, RANGE);
    expect(labels(events, "2026-10-27")).toEqual(["Follow up due"]);
  });

  it("uses the applied day when there is no last activity", () => {
    const events = calendarEvents([row({ appliedAt: "2026-11-01T12:00:00Z", lastActivity: null })], [], TODAY, RANGE);
    expect(all(events).filter((e) => e.kind === "followUp").map((e) => e.day)).toEqual(["2026-11-08"]);
  });

  it("is one event per application, not one per week", () => {
    const events = calendarEvents([row({ lastActivity: "2026-10-01T12:00:00Z", followUp: true })], [], TODAY, { from: "2026-01-01", to: "2026-12-31" });
    expect(all(events).filter((e) => e.kind === "followUp")).toHaveLength(1);
  });

  it("only appears for Applied and Heard back", () => {
    for (const stage of ["Assessment", "Interview", "Offer", "Rejected"] as Stage[]) {
      expect(all(calendarEvents([row({ stage, lastActivity: "2026-11-02T12:00:00Z" })], [], TODAY, RANGE)).filter((e) => e.kind === "followUp"), stage).toEqual([]);
    }
    for (const stage of ["Applied", "Heard back"] as Stage[]) {
      expect(all(calendarEvents([row({ stage, lastActivity: "2026-11-02T12:00:00Z" })], [], TODAY, RANGE)).filter((e) => e.kind === "followUp"), stage).toHaveLength(1);
    }
  });

  it("crosses month and year ends", () => {
    const events = calendarEvents([row({ lastActivity: "2026-12-28T12:00:00Z" })], [], "2026-12-28", { from: "2027-01-01", to: "2027-01-31" });
    expect(all(events).map((e) => e.day)).toEqual(["2027-01-04"]);
  });
});

describe("ghosted events", () => {
  it("shows 'No reply in 30 days' on the 30th day, as a follow-up kind, instead of the follow-up due", () => {
    const events = calendarEvents([row({ stage: "Applied", lastActivity: "2026-10-01T12:00:00Z" })], [], TODAY, RANGE);
    expect(all(events).map((e) => [e.day, e.kind, e.label, e.past])).toEqual([["2026-10-31", "followUp", "No reply in 30 days", true]]);
    expect(events.has("2026-10-08")).toBe(false);
  });

  it("is ghosted from exactly 30 idle days and not one day before", () => {
    // today is 30 days after Oct 6 but only 29 after Oct 7
    const ghosted = calendarEvents([row({ lastActivity: "2026-10-06T12:00:00Z" })], [], TODAY, RANGE);
    expect(labels(ghosted, "2026-11-05")).toEqual(["No reply in 30 days"]);
    const nudged = calendarEvents([row({ lastActivity: "2026-10-07T12:00:00Z", followUp: true })], [], TODAY, RANGE);
    expect(labels(nudged, "2026-10-14")).toEqual(["Follow up was due"]);
    expect(all(nudged).filter((e) => e.label.startsWith("No reply"))).toEqual([]);
  });

  it("is only for Applied and Heard back", () => {
    for (const stage of ["Assessment", "Interview", "Offer", "Rejected"] as Stage[]) {
      expect(all(calendarEvents([row({ stage, lastActivity: "2026-08-01T12:00:00Z" })], [], TODAY, { from: "2026-08-01", to: "2026-12-31" })), stage).toEqual([]);
    }
    expect(labels(calendarEvents([row({ stage: "Heard back", lastActivity: "2026-08-01T12:00:00Z" })], [], TODAY, { from: "2026-08-01", to: "2026-12-31" }), "2026-08-31"))
      .toEqual(["No reply in 30 days"]);
  });
});

describe("step events", () => {
  it("shows a logged step on its day under the step's name", () => {
    const r = row({ stage: "Assessment" });
    const events = calendarEvents([r], [step(r.id, "Take-home", "2026-10-21T12:00:00Z")], TODAY, RANGE);
    expect(all(events).map((e) => [e.day, e.kind, e.label, e.stage, e.appId])).toEqual([["2026-10-21", "step", "Take-home", "Assessment", r.id]]);
  });

  it("drops an 'Applied' step, which the applied event already covers", () => {
    const r = row({ appliedAt: "2026-10-21T12:00:00Z" });
    const events = calendarEvents([r], [step(r.id, "Applied", "2026-10-21T12:00:00Z")], TODAY, RANGE);
    expect(kinds(events, "2026-10-21")).toEqual(["applied"]);
  });

  it("drops an 'Interview' step on a day that already shows an interview, and keeps it on another day", () => {
    const r = row({ stage: "Interview", interviewDays: ["2026-10-21"] });
    const events = calendarEvents([r], [step(r.id, "Interview", "2026-10-21T12:00:00Z"), step(r.id, "Interview", "2026-10-22T12:00:00Z"), step(r.id, "Phone screen", "2026-10-21T12:00:00Z")], TODAY, RANGE);
    expect(labels(events, "2026-10-21")).toEqual(["Interview", "Phone screen"]);
    expect(kinds(events, "2026-10-21")).toEqual(["interview", "step"]);
    expect(kinds(events, "2026-10-22")).toEqual(["step"]);
  });

  it("keeps an 'Interview' step when the interview on that day is hidden", () => {
    const r = row({ stage: "Rejected", interviewDays: ["2026-11-05"] });
    const events = calendarEvents([r], [step(r.id, "Interview", "2026-11-05T15:00:00Z")], TODAY, RANGE);
    expect(kinds(events, localDay("2026-11-05T15:00:00Z"))).toEqual(["step"]);
  });

  it("shows the same step on the same day once, but not across days, steps or applications", () => {
    const a = row();
    const b = row();
    const steps = [
      step(a.id, "Phone screen", "2026-10-21T12:00:00Z"), step(a.id, "Phone screen", "2026-10-21T12:00:00Z"),
      step(a.id, "Phone screen", "2026-10-22T12:00:00Z"), step(a.id, "Take-home", "2026-10-21T12:00:00Z"), step(b.id, "Phone screen", "2026-10-21T12:00:00Z"),
    ];
    const events = calendarEvents([a, b], steps, TODAY, RANGE);
    expect(all(events).filter((e) => e.kind === "step")).toHaveLength(4);
    expect(labels(events, "2026-10-21")).toEqual(["Phone screen", "Take-home", "Phone screen"]);
  });

  it("leaves out steps of an application that isn't in the rows (deleted or filtered out)", () => {
    const r = row();
    const events = calendarEvents([r], [step(r.id + 1000, "Take-home", "2026-10-21T12:00:00Z"), step(r.id, "Take-home", "2026-10-22T12:00:00Z")], TODAY, RANGE);
    expect(all(events).map((e) => [e.appId, e.day])).toEqual([[r.id, "2026-10-22"]]);
  });

  it("ignores a step with no day, no name or a day outside the range", () => {
    const r = row();
    const events = calendarEvents([r], [step(r.id, "Take-home", "soon"), step(r.id, "", "2026-10-21T12:00:00Z"), step(r.id, "Take-home", "2026-09-30T12:00:00Z")], TODAY, RANGE);
    expect(all(events)).toEqual([]);
  });
});

describe("range", () => {
  const r = (days: string[]) => row({ stage: "Interview", interviewDays: days });

  it("includes both ends and nothing outside them", () => {
    const events = calendarEvents([r(["2026-10-31", "2026-11-01", "2026-11-15", "2026-11-30", "2026-12-01"])], [], TODAY, { from: "2026-11-01", to: "2026-11-30" });
    expect([...events.keys()].sort()).toEqual(["2026-11-01", "2026-11-15", "2026-11-30"]);
  });

  it("works for a one-day range and for an empty one", () => {
    expect([...calendarEvents([r(["2026-11-15", "2026-11-16"])], [], TODAY, { from: "2026-11-15", to: "2026-11-15" }).keys()]).toEqual(["2026-11-15"]);
    expect(calendarEvents([r(["2026-11-15"])], [], TODAY, { from: "2026-11-16", to: "2026-11-15" }).size).toBe(0);
  });

  it("applies to every kind of event", () => {
    const x = row({ stage: "Heard back", appliedAt: "2026-10-31T12:00:00Z", lastActivity: "2026-10-31T12:00:00Z" });
    const events = calendarEvents([x], [step(x.id, "Take-home", "2026-10-31T12:00:00Z")], TODAY, { from: "2026-11-01", to: "2026-11-30" });
    expect(all(events).map((e) => e.kind)).toEqual(["followUp"]);   // Nov 7
  });

  it("is empty with no rows", () => {
    expect(calendarEvents([], [], TODAY, RANGE).size).toBe(0);
  });
});

describe("order and keys", () => {
  it("lists a day's events by kind, then company, then id, then label", () => {
    const zed = row({ company: "Zed", stage: "Interview", interviewDays: ["2026-11-10"], appliedAt: "2026-11-10T12:00:00Z" });
    const acme = row({ company: "acme", stage: "Interview", interviewDays: ["2026-11-10"], appliedAt: "2026-11-10T12:00:00Z" });
    const beta1 = row({ company: "Beta", stage: "Offer", offerDeadline: "2026-11-10" });
    const beta2 = row({ company: "Beta", stage: "Offer", offerDeadline: "2026-11-10" });
    const stepper = row({ company: "Aaa", stage: "Assessment" });
    const steps = [step(stepper.id, "Take-home", "2026-11-10T12:00:00Z"), step(stepper.id, "Assessment", "2026-11-10T12:00:00Z")];
    const forward = calendarEvents([zed, acme, beta2, beta1, stepper], steps, TODAY, RANGE).get("2026-11-10")!;
    expect(forward.map((e) => [e.kind, e.company, e.label])).toEqual([
      ["interview", "acme", "Interview"], ["interview", "Zed", "Interview"],
      ["offer", "Beta", "Offer decision due"], ["offer", "Beta", "Offer decision due"],
      ["applied", "acme", "Applied"], ["applied", "Zed", "Applied"],
      ["step", "Aaa", "Assessment"], ["step", "Aaa", "Take-home"],
    ]);
    expect(forward.filter((e) => e.kind === "offer").map((e) => e.appId)).toEqual([beta1.id, beta2.id]);
    // the order doesn't depend on how the rows arrived
    const reversed = calendarEvents([stepper, beta1, beta2, acme, zed], [...steps].reverse(), TODAY, RANGE).get("2026-11-10")!;
    expect(reversed.map((e) => e.key)).toEqual(forward.map((e) => e.key));
  });

  it("puts interviews first, then offer, follow-up, applied and steps, and exports that order", () => {
    expect(KIND_ORDER).toEqual(["interview", "offer", "followUp", "applied", "step"]);
    const r = row({ stage: "Heard back", interviewDays: ["2026-11-09"], appliedAt: "2026-11-09T12:00:00Z", lastActivity: "2026-11-02T12:00:00Z" });
    const o = row({ stage: "Offer", offerDeadline: "2026-11-09" });
    const events = calendarEvents([r, o], [step(r.id, "Take-home", "2026-11-09T12:00:00Z")], TODAY, RANGE);
    expect(kinds(events, "2026-11-09")).toEqual(["interview", "offer", "followUp", "applied", "step"]);
  });

  it("builds keys from kind, application, day and label, unique within a day", () => {
    const r = row({ stage: "Interview", interviewDays: ["2026-11-10"] });
    const events = calendarEvents([r], [step(r.id, "Phone screen", "2026-11-10T12:00:00Z")], TODAY, RANGE);
    expect(events.get("2026-11-10")!.map((e) => e.key)).toEqual([`interview:${r.id}:2026-11-10:Interview`, `step:${r.id}:2026-11-10:Phone screen`]);
    const many = calendarEvents(Array.from({ length: 50 }, (_, i) => row({ company: `Co ${i}`, stage: "Interview", interviewDays: ["2026-11-10"], appliedAt: "2026-11-10T12:00:00Z" })), [], TODAY, RANGE);
    const keys = all(many).map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("marks events before today as past and today or later as not", () => {
    const events = calendarEvents([row({ stage: "Interview", interviewDays: ["2026-11-04", "2026-11-05", "2026-11-06"] })], [], TODAY, RANGE);
    expect(all(events).map((e) => [e.day, e.past])).toEqual([["2026-11-04", true], ["2026-11-05", false], ["2026-11-06", false]]);
  });

  it("doesn't change the rows or steps it is given", () => {
    const rows = [row({ stage: "Interview", interviewDays: ["2026-11-10", "2026-11-09"] })];
    const steps = [step(rows[0].id, "Take-home", "2026-11-10T12:00:00Z")];
    const copy = JSON.stringify([rows, steps]);
    calendarEvents(rows, steps, TODAY, RANGE);
    expect(JSON.stringify([rows, steps])).toBe(copy);
  });
});

describe("performance", () => {
  it("handles 1,000 applications with 10 days each in well under a second", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => row({
      company: `Company ${i % 97}`, stage: (["Applied", "Heard back", "Interview", "Offer", "Rejected"] as Stage[])[i % 5],
      appliedAt: "2026-10-15T12:00:00Z", lastActivity: "2026-10-20T12:00:00Z", followUp: i % 2 === 0, offerDeadline: "2026-11-12",
      interviewDays: Array.from({ length: 10 }, (_, d) => shiftDay("2026-10-20", d * 2)),
    }));
    const steps = rows.slice(0, 500).map((r, i) => step(r.id, "Take-home", `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T12:00:00Z`));
    const started = performance.now();
    const events = calendarEvents(rows, steps, TODAY, gridRange("2026-11"));
    const ms = performance.now() - started;
    expect(all(events).length).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(1000);
  });
});

describe("calendarSteps", () => {
  const seed = async () => {
    const db = freshDb();
    const id = await createApplication(db, { company: "Acme", companyKey: "acme", role: "Analyst", roleKey: "analyst", stage: "Applied", when: "2026-10-01T12:00:00Z" });
    const add = (kind: "note" | "step", label: string | null, at: string, appId = id) =>
      db.activity.add({ applicationId: appId, kind, label, body: "", occurredAt: at, createdAt: at });
    return { db, id, add };
  };

  it("returns only steps whose day is in the range, both ends included", async () => {
    const { db, id, add } = await seed();
    await add("step", "Phone screen", "2026-10-31T12:00:00Z");
    await add("step", "Take-home", "2026-11-01T12:00:00Z");
    await add("step", "Final round", "2026-11-30T12:00:00Z");
    await add("step", "Interview", "2026-12-01T12:00:00Z");
    expect(await calendarSteps(db, "2026-11-01", "2026-11-30")).toEqual([
      { applicationId: id, label: "Take-home", occurredAt: "2026-11-01T12:00:00Z" },
      { applicationId: id, label: "Final round", occurredAt: "2026-11-30T12:00:00Z" },
    ]);
  });

  it("leaves out notes and steps with no label", async () => {
    const { db, add } = await seed();
    await add("note", null, "2026-11-10T12:00:00Z");
    await add("note", "Interview", "2026-11-10T12:00:00Z");
    await add("step", null, "2026-11-10T12:00:00Z");
    expect(await calendarSteps(db, "2026-11-01", "2026-11-30")).toEqual([]);
  });

  it("reads an instant as the day it falls on for you", async () => {
    const { db, add } = await seed();
    await add("step", "Phone screen", "2026-11-02T03:00:00Z");   // Nov 1 evening in Toronto, Nov 2 in UTC and east of it
    await inZone("America/Toronto", async () => {
      expect(await calendarSteps(db, "2026-11-01", "2026-11-01")).toHaveLength(1);
      expect(await calendarSteps(db, "2026-11-02", "2026-11-02")).toHaveLength(0);
    });
    await inZone("Australia/Sydney", async () => {
      expect(await calendarSteps(db, "2026-11-01", "2026-11-01")).toHaveLength(0);
      expect(await calendarSteps(db, "2026-11-02", "2026-11-02")).toHaveLength(1);
    });
  });

  it("feeds calendarEvents, which drops the steps of a deleted application", async () => {
    const { db, id, add } = await seed();
    const gone = await createApplication(db, { company: "Gone", companyKey: "gone", role: "Analyst", roleKey: "analyst", stage: "Applied", when: "2026-10-01T12:00:00Z" });
    await add("step", "Take-home", "2026-11-10T12:00:00Z");
    await add("step", "Take-home", "2026-11-10T12:00:00Z", gone);
    await db.applications.update(gone, { deletedAt: "2026-11-04T12:00:00Z" });
    const rows = await listApplications(db, { now: new Date("2026-11-05T12:00:00Z") });
    const events = calendarEvents(rows, await calendarSteps(db, "2026-11-01", "2026-11-30"), TODAY, { from: "2026-11-01", to: "2026-11-30" });
    expect(all(events).filter((e) => e.kind === "step").map((e) => e.appId)).toEqual([id]);
  });
});

describe("in other time zones", () => {
  const FIXED: string[] = Array.from({ length: 27 }, (_, i) => {
    const h = i - 12;
    return h === 0 ? "UTC" : `Etc/GMT${h > 0 ? "-" : "+"}${Math.abs(h)}`;
  });
  const ZONES = [...FIXED, "America/Toronto", "America/St_Johns", "Australia/Sydney", "Australia/Lord_Howe", "Pacific/Apia", "Pacific/Chatham", "Asia/Kathmandu"];
  const HOUR = 3_600_000;

  it("puts applied, follow-up, ghosted and step events on the viewer's day for instants around midnight, in every zone", async () => {
    const starts = ["2026-03-07T00:00:00Z", "2026-03-08T00:00:00Z", "2026-10-31T00:00:00Z", "2026-11-01T00:00:00Z", "2026-04-04T00:00:00Z", "2026-10-03T00:00:00Z"];
    for (const zone of ZONES) {
      await inZone(zone, () => {
        for (const start of starts) {
          for (let h = 0; h < 72; h += 3) {
            // 7 minutes past, so no instant is exactly noon UTC (that one is read as a picked day: see the rule in db/time.ts)
            const at = new Date(Date.parse(start) + h * HOUR + 7 * 60_000).toISOString().replace(".000Z", "Z");
            const local = localDay(at, zone);
            const today = shiftDay(local, 40);
            const wide = { from: shiftDay(local, -2), to: shiftDay(local, 80) };
            const r = row({ stage: "Heard back", appliedAt: at, lastActivity: at, followUp: false });
            const events = calendarEvents([r], [step(r.id, "Take-home", at)], today, wide);
            const where = new Map(all(events).map((e) => [e.kind + ":" + e.label, e.day]));
            const label = `${zone} ${at}`;
            expect(where.get("applied:Applied"), label).toBe(local);
            expect(where.get("step:Take-home"), label).toBe(local);
            expect(where.get("followUp:No reply in 30 days"), label).toBe(shiftDay(local, 30));
            // not yet ghosted: the follow-up is a week out, whatever daylight saving did in between
            const early = calendarEvents([r], [], local, wide);
            expect(all(early).find((e) => e.kind === "followUp")?.day, label).toBe(shiftDay(local, 7));
          }
        }
      });
    }
  });

  it("shows a picked day on that day in every zone", async () => {
    for (const zone of ZONES) {
      await inZone(zone, () => {
        const events = calendarEvents([row({ appliedAt: "2026-10-21T12:00:00Z" })], [], TODAY, RANGE);
        expect(kinds(events, "2026-10-21"), zone).toEqual(["applied"]);
      });
    }
  });

  it("keeps the grid's first and last days inside the range, and one day further out, in every zone", async () => {
    for (const zone of ["America/Toronto", "Australia/Lord_Howe", "Pacific/Kiritimati", "Etc/GMT+12", "Pacific/Apia"]) {
      await inZone(zone, () => {
        for (const month of ["2026-03", "2026-10", "2026-11", "2026-12"]) {
          const range = gridRange(month);
          const days = monthGrid(month).flat();
          const r = row({ stage: "Interview", interviewDays: [shiftDay(range.from, -1), ...days, shiftDay(range.to, 1)] });
          const events = calendarEvents([r], [], "2026-01-01", range);
          expect([...events.keys()].sort(), `${zone} ${month}`).toEqual(days);
        }
      });
    }
  });
});

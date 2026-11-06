// "Sent: <resume>" on the calendar: which events carry the resume title that the list row has.
import { describe, expect, it } from "vitest";
import { calendarEvents, type CalendarRow } from "../../src/sync/calendar";

describe("calendarEvents with resume titles", () => {
  const row = (o: Partial<CalendarRow>): CalendarRow => ({
    id: 1, company: "Acme", role: "Analyst", stage: "Interview", appliedAt: "2026-11-01T12:00:00Z", lastActivity: null, followUp: false, interviewDays: ["2026-11-12"], ...o,
  });
  const RANGE = { from: "2026-11-01", to: "2026-11-30" };

  it("puts the title on interview events only", () => {
    const events = calendarEvents([row({ resumeTitle: "Analyst v2" })], [], "2026-11-05", RANGE);
    const all = [...events.values()].flat();
    expect(all.filter((e) => e.kind === "interview").map((e) => e.resumeTitle)).toEqual(["Analyst v2"]);
    expect(all.filter((e) => e.kind !== "interview").every((e) => !("resumeTitle" in e))).toBe(true);
  });

  it("leaves it off when the row has no resume title, or a null one", () => {
    for (const resumeTitle of [undefined, null]) {
      const events = calendarEvents([row({ resumeTitle })], [], "2026-11-05", RANGE);
      expect([...events.values()].flat().some((e) => "resumeTitle" in e)).toBe(false);
    }
  });
});

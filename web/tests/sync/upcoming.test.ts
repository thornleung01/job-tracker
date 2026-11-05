import { describe, expect, it } from "vitest";
import { comingUp, dayLabel, daysBetween, nextInterviewDay, shortDay } from "../../src/sync/upcoming";

let n = 0;
const mail = (o: { thread?: string | null; at: string; subject?: string; body?: string; event?: "interview" | "applied" | "rejected" }) => ({
  id: ++n, threadId: o.thread === undefined ? `t${n}` : o.thread, receivedAt: o.at, subject: o.subject ?? "Interview", body: o.body ?? "", event: o.event ?? ("interview" as const),
});

const TODAY = "2026-10-12";

describe("nextInterviewDay", () => {
  it("is null with no interview emails", () => {
    expect(nextInterviewDay([], TODAY)).toBeNull();
    expect(nextInterviewDay([mail({ at: "2026-10-10T14:00:00Z", body: "Oct 15", event: "applied" })], TODAY)).toBeNull();
  });

  it("is null when no email names a day", () => {
    expect(nextInterviewDay([mail({ at: "2026-10-10T14:00:00Z", body: "Let's find a time." })], TODAY)).toBeNull();
  });

  it("counts today", () => {
    expect(nextInterviewDay([mail({ at: "2026-10-10T14:00:00Z", body: "See you on Oct 12 at 2pm" })], TODAY)).toBe("2026-10-12");
  });

  it("ignores days that have passed", () => {
    expect(nextInterviewDay([mail({ at: "2026-10-05T14:00:00Z", body: "See you on Oct 8" })], TODAY)).toBeNull();
  });

  it("takes the earliest upcoming day across several threads", () => {
    const emails = [
      mail({ thread: "a", at: "2026-10-06T14:00:00Z", body: "Oct 8" }),
      mail({ thread: "b", at: "2026-10-09T14:00:00Z", body: "Oct 22" }),
      mail({ thread: "c", at: "2026-10-10T14:00:00Z", body: "Oct 15" }),
    ];
    expect(nextInterviewDay(emails, TODAY)).toBe("2026-10-15");
  });

  it("follows a rescheduled thread to its new day", () => {
    const emails = [
      mail({ thread: "a", at: "2026-10-08T14:00:00Z", body: "Interview on Oct 15" }),
      mail({ thread: "a", at: "2026-10-11T14:00:00Z", subject: "Rescheduled: interview", body: "Moved to Oct 20" }),
    ];
    expect(nextInterviewDay(emails, TODAY)).toBe("2026-10-20");
  });

  it("lets a rescheduled thread move to a day that is now past", () => {
    const emails = [
      mail({ thread: "a", at: "2026-10-01T14:00:00Z", body: "Interview on Oct 15" }),
      mail({ thread: "a", at: "2026-10-02T14:00:00Z", subject: "Rescheduled", body: "Moved to Oct 5" }),
    ];
    expect(nextInterviewDay(emails, TODAY)).toBeNull();
  });

  it("drops a cancelled thread but keeps the others", () => {
    const emails = [
      mail({ thread: "a", at: "2026-10-08T14:00:00Z", body: "Interview on Oct 14" }),
      mail({ thread: "a", at: "2026-10-10T14:00:00Z", subject: "Interview cancelled", body: "We have to cancel Oct 14" }),
      mail({ thread: "b", at: "2026-10-09T14:00:00Z", body: "Interview on Oct 19" }),
    ];
    expect(nextInterviewDay(emails, TODAY)).toBe("2026-10-19");
  });

  it("treats mail with no thread as its own meeting", () => {
    const emails = [
      mail({ thread: null, at: "2026-10-08T14:00:00Z", body: "Oct 18" }),
      mail({ thread: null, at: "2026-10-09T14:00:00Z", body: "Oct 16" }),
    ];
    expect(nextInterviewDay(emails, TODAY)).toBe("2026-10-16");
  });
});

describe("day wording", () => {
  it("counts calendar days", () => {
    expect(daysBetween("2026-10-12", "2026-10-12")).toBe(0);
    expect(daysBetween("2026-10-12", "2026-10-19")).toBe(7);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
  });

  it("writes the day of the week, month and day", () => {
    expect(shortDay("2026-10-15")).toBe("Thu, Oct 15");
    expect(shortDay("2026-01-01")).toBe("Thu, Jan 1");
  });

  it("says Today and Tomorrow", () => {
    expect(dayLabel("2026-10-12", TODAY)).toBe("Today");
    expect(dayLabel("2026-10-13", TODAY)).toBe("Tomorrow");
    expect(dayLabel("2026-10-15", TODAY)).toBe("Thu, Oct 15");
  });
});

describe("comingUp", () => {
  const row = (id: number, company: string, nextInterview: string | null) => ({ id, company, role: "Analyst", nextInterview });

  it("keeps the next seven days, soonest first, then by company", () => {
    const rows = [row(1, "Zed", "2026-10-15"), row(2, "Acme", "2026-10-19"), row(3, "Beta", "2026-10-15"), row(4, "Far", "2026-10-20"), row(5, "None", null), row(6, "Past", "2026-10-11")];
    expect(comingUp(rows, TODAY).map((r) => r.company)).toEqual(["Beta", "Zed", "Acme"]);
  });

  it("shows at most five", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(i + 1, `Co ${i}`, "2026-10-14"));
    expect(comingUp(rows, TODAY)).toHaveLength(5);
  });
});

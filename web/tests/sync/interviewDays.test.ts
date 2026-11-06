import { describe, expect, it } from "vitest";
import { interviewDays, nextInterviewDay } from "../../src/sync/upcoming";

let n = 0;
const mail = (o: { thread?: string | null; at: string; subject?: string; body?: string; event?: "interview" | "applied" | "rejected" }) => ({
  id: ++n, threadId: o.thread === undefined ? `t${n}` : o.thread, receivedAt: o.at, subject: o.subject ?? "Interview", body: o.body ?? "", event: o.event ?? ("interview" as const),
});

const TODAY = "2026-10-12";

describe("interviewDays", () => {
  it("is empty with no interview emails, and with emails that name no day", () => {
    expect(interviewDays([], TODAY)).toEqual([]);
    expect(interviewDays([mail({ at: "2026-10-10T14:00:00Z", body: "Oct 15", event: "applied" })], TODAY)).toEqual([]);
    expect(interviewDays([mail({ at: "2026-10-10T14:00:00Z", body: "Let's find a time." })], TODAY)).toEqual([]);
  });

  it("lists every upcoming day, earliest first, today included and past days left out", () => {
    const emails = [
      mail({ thread: "a", at: "2026-10-09T14:00:00Z", body: "Oct 22" }),
      mail({ thread: "b", at: "2026-10-06T14:00:00Z", body: "Oct 8" }),
      mail({ thread: "c", at: "2026-10-10T14:00:00Z", body: "Oct 15" }),
      mail({ thread: "d", at: "2026-10-10T14:00:00Z", body: "Oct 12" }),
    ];
    expect(interviewDays(emails, TODAY)).toEqual(["2026-10-12", "2026-10-15", "2026-10-22"]);
  });

  it("lists a day once when two threads meet the same day", () => {
    const emails = [mail({ thread: "a", at: "2026-10-09T14:00:00Z", body: "Oct 15 at 10am" }), mail({ thread: "b", at: "2026-10-09T15:00:00Z", body: "Oct 15 at 2pm" })];
    expect(interviewDays(emails, TODAY)).toEqual(["2026-10-15"]);
  });

  it("follows a rescheduled thread to its new day and drops the old one", () => {
    const emails = [
      mail({ thread: "a", at: "2026-10-08T14:00:00Z", body: "Interview on Oct 15" }),
      mail({ thread: "a", at: "2026-10-11T14:00:00Z", subject: "Rescheduled: interview", body: "Moved to Oct 20" }),
    ];
    expect(interviewDays(emails, TODAY)).toEqual(["2026-10-20"]);
  });

  it("drops a cancelled thread but keeps the others", () => {
    const emails = [
      mail({ thread: "a", at: "2026-10-08T14:00:00Z", body: "Interview on Oct 15" }),
      mail({ thread: "a", at: "2026-10-11T14:00:00Z", subject: "Interview cancelled", body: "Sorry, we have to cancel the Oct 15 interview." }),
      mail({ thread: "b", at: "2026-10-09T14:00:00Z", body: "Interview on Oct 18" }),
    ];
    expect(interviewDays(emails, TODAY)).toEqual(["2026-10-18"]);
  });

  it("lets a rescheduled thread move to a day that is now past", () => {
    const emails = [
      mail({ thread: "a", at: "2026-10-01T14:00:00Z", body: "Interview on Oct 15" }),
      mail({ thread: "a", at: "2026-10-05T14:00:00Z", subject: "Rescheduled", body: "Moved to Oct 8" }),
    ];
    expect(interviewDays(emails, TODAY)).toEqual([]);
  });

  it("starts with nextInterviewDay's answer, and nextInterviewDay still gives only that one", () => {
    const emails = [
      mail({ thread: "a", at: "2026-10-06T14:00:00Z", body: "Oct 8" }),
      mail({ thread: "b", at: "2026-10-09T14:00:00Z", body: "Oct 22" }),
      mail({ thread: "c", at: "2026-10-10T14:00:00Z", body: "Oct 15" }),
    ];
    expect(nextInterviewDay(emails, TODAY)).toBe("2026-10-15");
    expect(interviewDays(emails, TODAY)[0]).toBe(nextInterviewDay(emails, TODAY));
    expect(nextInterviewDay([], TODAY)).toBeNull();
    expect(interviewDays(emails, "2026-12-01")).toEqual([]);
  });
});

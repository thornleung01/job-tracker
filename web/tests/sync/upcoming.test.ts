import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { dayText } from "../../src/components/TimeText";
import { createApplication } from "../../src/db/repo";
import type { Stage } from "../../src/db/stages";
import { daysBetween } from "../../src/db/time";
import { listApplications } from "../../src/sync/queries";
import { comingUp, dayWhen, interviewDays, meetingDays, nextInterviewDay, shortDay, WEEKDAYS } from "../../src/sync/upcoming";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

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

  it("never writes a year, whatever year it is", () => {
    expect(shortDay("2027-03-02")).toBe("Tue, Mar 2");
    expect(shortDay("2019-12-31")).toBe("Tue, Dec 31");
  });

  it("says how soon a day is without depending on the words", () => {
    expect(dayWhen("2026-10-12", TODAY)).toEqual({ when: "today", text: "Today" });
    expect(dayWhen("2026-10-13", TODAY)).toEqual({ when: "tomorrow", text: "Tomorrow" });
    expect(dayWhen("2026-10-15", TODAY)).toEqual({ when: "later", text: "Thu, Oct 15" });
    expect(dayWhen("2026-11-30", TODAY).when).toBe("later");
  });
});

describe("comingUp", () => {
  const row = (id: number, company: string, nextInterview: string | null) => ({ id, company, role: "Analyst", nextInterview });

  it("keeps the next seven days, soonest first, then by company", () => {
    const rows = [row(1, "Zed", "2026-10-15"), row(2, "Acme", "2026-10-19"), row(3, "Beta", "2026-10-15"), row(4, "Far", "2026-10-20"), row(5, "None", null), row(6, "Past", "2026-10-11")];
    expect(comingUp(rows, TODAY).map((r) => r.company)).toEqual(["Beta", "Zed", "Acme"]);
  });

  it("includes exactly seven days out and leaves out the eighth", () => {
    const rows = [row(1, "Seven", "2026-10-19"), row(2, "Eight", "2026-10-20"), row(3, "Today", "2026-10-12")];
    expect(comingUp(rows, TODAY).map((r) => r.company)).toEqual(["Today", "Seven"]);
  });

  it("sorts a shared day and company by id, and leaves the input as it was", () => {
    const rows = [row(9, "Acme", "2026-10-14"), row(4, "Acme", "2026-10-14"), row(7, "Acme", "2026-10-13")];
    expect(comingUp(rows, TODAY).map((r) => r.id)).toEqual([7, 4, 9]);
    expect(rows.map((r) => r.id)).toEqual([9, 4, 7]);
  });

  it("keeps the soonest five, not just any five", () => {
    const rows = [row(1, "G", "2026-10-18"), row(2, "F", "2026-10-17"), row(3, "E", "2026-10-16"), row(4, "D", "2026-10-15"), row(5, "C", "2026-10-14"), row(6, "B", "2026-10-13"), row(7, "A", "2026-10-19")];
    expect(comingUp(rows, TODAY).map((r) => r.company)).toEqual(["B", "C", "D", "E", "F"]);
  });

  it("shows at most five", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(i + 1, `Co ${i}`, "2026-10-14"));
    expect(comingUp(rows, TODAY)).toHaveLength(5);
  });
});

describe("dayText plain", () => {
  const now = new Date("2026-11-05T12:00:00");

  it("leaves the year out whatever year it is, where short only drops this year's", () => {
    expect(dayText("2026-10-15", "plain", now)).toBe("Oct 15");
    expect(dayText("2027-10-15", "plain", now)).toBe("Oct 15");
    expect(dayText("2027-10-15", "short", now)).toBe("Oct 15, 2027");
    expect(dayText("2027-10-15", "long", now)).toBe("October 15, 2027");
  });

  it("says Unknown for a bad day", () => {
    expect(dayText("soon", "plain", now)).toBe("Unknown");
    expect(dayText(null, "plain", now)).toBe("Unknown");
  });
});

describe("meetingDays", () => {
  it("is empty with no interview emails or no named day", () => {
    expect(meetingDays([])).toEqual([]);
    expect(meetingDays([mail({ at: "2026-10-10T14:00:00Z", body: "Oct 15", event: "applied" })])).toEqual([]);
    expect(meetingDays([mail({ at: "2026-10-10T14:00:00Z", body: "Let's find a time." })])).toEqual([]);
  });

  it("keeps past and future days, earliest first, whatever order the emails come in", () => {
    const emails = [
      mail({ thread: "a", at: "2026-10-09T14:00:00Z", body: "Interview on Oct 22" }),
      mail({ thread: "b", at: "2026-10-01T14:00:00Z", body: "Interview on Oct 5" }),
      mail({ thread: "c", at: "2026-10-10T14:00:00Z", body: "Interview on Oct 14" }),
    ];
    expect(meetingDays(emails)).toEqual(["2026-10-05", "2026-10-14", "2026-10-22"]);
    expect(meetingDays([...emails].reverse())).toEqual(["2026-10-05", "2026-10-14", "2026-10-22"]);
  });

  it("lists a day once when two threads share it", () => {
    const emails = [mail({ thread: "a", at: "2026-10-08T14:00:00Z", body: "Oct 15" }), mail({ thread: "b", at: "2026-10-09T14:00:00Z", body: "Oct 15" })];
    expect(meetingDays(emails)).toEqual(["2026-10-15"]);
  });

  it("follows a rescheduled thread to its new day, even a past one", () => {
    const moved = [
      mail({ thread: "a", at: "2026-10-08T14:00:00Z", body: "Interview on Oct 15" }),
      mail({ thread: "a", at: "2026-10-11T14:00:00Z", subject: "Rescheduled: interview", body: "Moved to Oct 20" }),
    ];
    expect(meetingDays(moved)).toEqual(["2026-10-20"]);
    const back = [
      mail({ thread: "a", at: "2026-10-01T14:00:00Z", body: "Interview on Oct 15" }),
      mail({ thread: "a", at: "2026-10-02T14:00:00Z", subject: "Rescheduled", body: "Moved to Oct 5" }),
    ];
    expect(meetingDays(back)).toEqual(["2026-10-05"]);
  });

  it("drops a cancelled thread but keeps the others", () => {
    const emails = [
      mail({ thread: "a", at: "2026-10-08T14:00:00Z", body: "Interview on Oct 14" }),
      mail({ thread: "a", at: "2026-10-10T14:00:00Z", subject: "Interview cancelled", body: "We have to cancel Oct 14" }),
      mail({ thread: "b", at: "2026-10-09T14:00:00Z", body: "Interview on Oct 19" }),
    ];
    expect(meetingDays(emails)).toEqual(["2026-10-19"]);
  });

  it("is what nextInterviewDay and interviewDays are made from, and leaves nextInterviewDay as it was", () => {
    const emails = [
      mail({ thread: "a", at: "2026-10-01T14:00:00Z", body: "Interview on Oct 5" }),
      mail({ thread: "b", at: "2026-10-09T14:00:00Z", body: "Interview on Oct 12" }),
      mail({ thread: "c", at: "2026-10-10T14:00:00Z", body: "Interview on Oct 22" }),
    ];
    expect(meetingDays(emails)).toEqual(["2026-10-05", "2026-10-12", "2026-10-22"]);
    expect(interviewDays(emails, TODAY)).toEqual(["2026-10-12", "2026-10-22"]);
    expect(nextInterviewDay(emails, TODAY)).toBe("2026-10-12");
    expect(nextInterviewDay(emails, "2026-10-13")).toBe("2026-10-22");
    expect(nextInterviewDay(emails, "2026-10-23")).toBeNull();
  });

  it("exports the weekday names the calendar's header uses", () => {
    expect(WEEKDAYS).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  });
});

describe("interviewDays on the list rows", () => {
  const NOW = new Date("2026-10-12T16:00:00Z");

  async function seed() {
    const db = freshDb();
    const add = async (company: string, stage: Stage, bodies: [string, string, string?][], extra: Record<string, unknown> = {}) => {
      const id = await createApplication(db, { company, companyKey: company.toLowerCase(), role: "Analyst", roleKey: "analyst", stage, when: "2026-10-01T12:00:00Z" });
      if (Object.keys(extra).length) await db.applications.update(id, extra);
      for (const [i, [thread, text, subject]] of bodies.entries()) {
        await db.emails.add({
          accountId: 1, providerMsgId: `${company}-${i}`, threadId: thread, receivedAt: `2026-10-0${i + 2}T14:00:00Z`, sender: "hr@acme.com", subject: subject ?? "Interview",
          body: text, related: true, event: "interview", confidence: "high", applicationId: id, needsReview: false, webLink: null, bulk: false, hold: false, reason: null,
        });
      }
      return id;
    };
    await add("Live", "Interview", [["a", "Interview on Oct 5"], ["b", "Interview on Oct 14"], ["c", "Interview on Oct 20"]]);
    await add("Done", "Rejected", [["a", "Interview on Oct 5"], ["b", "Interview on Oct 20"]]);
    await add("Won", "Offer", [["a", "Interview on Oct 8"], ["b", "Interview on Oct 25"]]);
    await add("Quiet", "Applied", []);
    await add("Cancelled", "Interview", [["a", "Interview on Oct 15"], ["a", "We have to cancel Oct 15", "Interview cancelled"]]);
    await add("Deleted", "Interview", [["a", "Interview on Oct 15"]], { deletedAt: "2026-10-10T12:00:00Z" });
    return db;
  }

  it("carries every interview day, past and future, with the next one unchanged", async () => {
    const rows = await listApplications(await seed(), { now: NOW, sort: "company", dir: "asc" });
    const byName = Object.fromEntries(rows.map((r) => [r.company, r]));
    expect(byName.Live.interviewDays).toEqual(["2026-10-05", "2026-10-14", "2026-10-20"]);
    expect(byName.Live.nextInterview).toBe("2026-10-14");
    expect(byName.Quiet.interviewDays).toEqual([]);
    expect(byName.Quiet.nextInterview).toBeNull();
    expect(byName.Cancelled.interviewDays).toEqual([]);
    expect(byName.Cancelled.nextInterview).toBeNull();
  });

  it("keeps the days for a Rejected or Offer application while its next interview stays null", async () => {
    const rows = await listApplications(await seed(), { now: NOW });
    const byName = Object.fromEntries(rows.map((r) => [r.company, r]));
    expect(byName.Done.interviewDays).toEqual(["2026-10-05", "2026-10-20"]);
    expect(byName.Done.nextInterview).toBeNull();
    expect(byName.Won.interviewDays).toEqual(["2026-10-08", "2026-10-25"]);
    expect(byName.Won.nextInterview).toBeNull();
  });

  it("leaves out a deleted application, and has the same days with a filter on", async () => {
    const db = await seed();
    const all = await listApplications(db, { now: NOW, sort: "company", dir: "asc" });
    expect(all.map((r) => r.company)).not.toContain("Deleted");
    const filtered = await listApplications(db, { now: NOW, stage: "Interview", sort: "company", dir: "asc" });
    expect(filtered).toEqual(all.filter((r) => r.stage === "Interview"));
  });
});

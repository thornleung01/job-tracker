import { describe, expect, it } from "vitest";
import { deriveRounds, interviewDay, namedRound, roundsFromEmails } from "../../src/sync/rounds";

let n = 0;
const mail = (o: { thread?: string | null; at: string; subject?: string; body?: string; event?: "interview" | "applied" | "rejected" }) => ({
  id: ++n, threadId: o.thread === undefined ? `t${n}` : o.thread, receivedAt: o.at, subject: o.subject ?? "Interview", body: o.body ?? "", event: o.event ?? ("interview" as const),
});

describe("interviewDay", () => {
  it.each([
    ["Thursday, October 15 at 10:00 am", "2026-10-12T14:00:00Z", "2026-10-15"],
    ["Oct 15th, 2026 at 2pm", "2026-10-12T14:00:00Z", "2026-10-15"],
    ["15 October 2026", "2026-10-12T14:00:00Z", "2026-10-15"],
    ["on 2026-10-15", "2026-10-12T14:00:00Z", "2026-10-15"],
    ["Sept 3", "2026-08-30T14:00:00Z", "2026-09-03"],
    ["Jan 9", "2026-12-20T14:00:00Z", "2027-01-09"],
  ])("reads %s", (body, at, expected) => {
    expect(interviewDay("Interview", body, at)).toBe(expected);
  });

  it("ignores a date that is long past, far off, or not a real day", () => {
    expect(interviewDay("Hi", "We met on Feb 3, 2026.", "2026-10-12T14:00:00Z")).toBeNull();
    expect(interviewDay("Hi", "See you in 2027-06-01", "2026-10-12T14:00:00Z")).toBeNull();
    expect(interviewDay("Hi", "Feb 31", "2026-01-12T14:00:00Z")).toBeNull();
    expect(interviewDay("Hi", "no dates here", "2026-10-12T14:00:00Z")).toBeNull();
    expect(interviewDay("Hi", "Oct 15", "not a date")).toBeNull();
  });

  it("takes the first date written, not the earliest", () => {
    expect(interviewDay("Interview", "Thursday Oct 22, with a backup on Oct 20", "2026-10-12T14:00:00Z")).toBe("2026-10-22");
  });
});

describe("namedRound", () => {
  it.each([
    ["Your second round interview", 2],
    ["Invitation to round 3", 3],
    ["4th interview with the team", 4],
    ["Final round", 0],
    ["Nothing numbered", 0],
  ])("%s", (subject, expected) => expect(namedRound(subject, "")).toBe(expected));
});

describe("roundsFromEmails", () => {
  it("counts an invite, confirmation and reminder about one meeting once", () => {
    const body = "Your interview is on Thursday, October 15 at 10:00 am.";
    expect(roundsFromEmails([
      mail({ thread: "a", at: "2026-10-12T14:00:00Z", body }),
      mail({ thread: "b", at: "2026-10-13T14:00:00Z", subject: "Confirmed", body }),
      mail({ thread: "c", at: "2026-10-15T08:00:00Z", subject: "Reminder", body: "Today, October 15" }),
    ])).toBe(1);
  });

  it("counts different days as different rounds, and several sessions on one day as one", () => {
    expect(roundsFromEmails([
      mail({ thread: "a", at: "2026-10-01T14:00:00Z", body: "Phone screen on October 5." }),
      mail({ thread: "b", at: "2026-10-06T14:00:00Z", body: "Panel on October 12, 10:00 am with Sam and 11:00 am with Jo." }),
      mail({ thread: "c", at: "2026-10-12T14:00:00Z", body: "Technical session October 12, 2 pm." }),
    ])).toBe(2);
  });

  it("follows a reschedule to the new day instead of counting both", () => {
    expect(roundsFromEmails([
      mail({ thread: "a", at: "2026-10-01T14:00:00Z", body: "Interview on October 5." }),
      mail({ thread: "a", at: "2026-10-03T14:00:00Z", subject: "Updated: Interview", body: "New time: October 7." }),
    ])).toBe(1);
  });

  it("drops a thread whose newest email cancels it", () => {
    expect(roundsFromEmails([
      mail({ thread: "a", at: "2026-10-01T14:00:00Z", body: "Interview on October 5." }),
      mail({ thread: "a", at: "2026-10-03T14:00:00Z", subject: "Canceled: Interview", body: "October 5" }),
    ])).toBe(0);
  });

  it("does not let a cancelled thread raise the count with a round it named", () => {
    expect(roundsFromEmails([
      mail({ thread: "a", at: "2026-10-01T14:00:00Z", subject: "Second round interview", body: "October 5." }),
      mail({ thread: "a", at: "2026-10-03T14:00:00Z", subject: "Cancelled: Second round interview", body: "October 5" }),
    ])).toBe(0);
  });

  it("counts a dateless thread once, and ignores mail that is not about an interview", () => {
    expect(roundsFromEmails([
      mail({ thread: "a", at: "2026-10-01T14:00:00Z", body: "We'd love to chat." }),
      mail({ thread: "a", at: "2026-10-02T14:00:00Z", body: "Great, confirmed." }),
      mail({ thread: "x", at: "2026-10-03T14:00:00Z", event: "rejected", body: "Sorry." }),
      mail({ thread: null, at: "2026-10-04T14:00:00Z", event: "applied" }),
    ])).toBe(1);
  });

  it("never reports fewer rounds than the highest one named", () => {
    expect(roundsFromEmails([mail({ thread: "a", at: "2026-10-01T14:00:00Z", subject: "Third round interview", body: "October 5" })])).toBe(3);
  });
});

describe("deriveRounds", () => {
  const steps = (...labels: string[]) => labels.map((label) => ({ kind: "step" as const, label }));
  const one = [mail({ thread: "a", at: "2026-10-01T14:00:00Z", body: "October 5" })];

  it("prefers a number you typed, even 0", () => {
    expect(deriveRounds(one, steps("Final round"), 4)).toEqual({ count: 4, source: "yours" });
    expect(deriveRounds(one, [], 0)).toEqual({ count: 0, source: "yours" });
  });

  it("uses logged interview steps, and not recruiter calls or take-homes", () => {
    expect(deriveRounds([], steps("Phone screen", "Technical interview", "Recruiter call", "Take-home assignment"))).toEqual({ count: 2, source: "logged" });
    expect(deriveRounds([], [{ kind: "note", label: "Phone screen" }])).toBeNull();
  });

  it("takes the larger of the emails and the steps, and says where it came from", () => {
    const two = [...one, mail({ thread: "b", at: "2026-10-08T14:00:00Z", body: "October 12" })];
    expect(deriveRounds(two, steps("Phone screen"))).toEqual({ count: 2, source: "estimated" });
    expect(deriveRounds(one, steps("Phone screen", "Final round"))).toEqual({ count: 2, source: "logged" });
  });

  it("is null when nothing says there was an interview", () => {
    expect(deriveRounds([], [])).toBeNull();
  });
});

describe("long subjects", () => {
  const long = "x".repeat(1600);

  it("only reads the first 1500 characters of a subject, like the body", () => {
    expect(interviewDay(`${long} Oct 15`, "", "2026-10-12T14:00:00Z")).toBeNull();
    expect(interviewDay(`Oct 15 ${long}`, "", "2026-10-12T14:00:00Z")).toBe("2026-10-15");
    expect(namedRound(`${long} second round`, "")).toBe(0);
    expect(namedRound(`second round ${long}`, "")).toBe(2);
  });

  it("does not see a cancellation past the first 1500 characters of the newest subject", () => {
    const emails = [mail({ thread: "t", at: "2026-10-10T14:00:00Z", subject: `${long} cancelled`, body: "Oct 15" })];
    expect(roundsFromEmails(emails)).toBe(1);
    expect(roundsFromEmails([mail({ thread: "u", at: "2026-10-10T14:00:00Z", subject: "Interview cancelled", body: "Oct 15" })])).toBe(0);
  });
});

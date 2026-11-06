import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication } from "../../src/db/repo";
import { deadlineWords, loadOffers, offersView, OFFERS_MIN } from "../../src/sync/offersView";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const today = "2026-11-05";
type Row = Parameters<typeof offersView>[0][number];
const row = (id: number, o: Partial<Row> = {}): Row => ({ id, company: `Co ${id}`, role: "Analyst", stage: "Offer", stageAt: "2026-10-20T12:00:00Z", ...o });

describe("offersView", () => {
  it("takes applications at Offer and ones carrying offer details, and no others", () => {
    const rows = [
      row(1), row(2, { stage: "Interview" }), row(3, { stage: "Rejected", offerSalary: "$100k" }),
      row(4, { stage: "Applied", offerDeadline: "2026-11-10" }),
    ];
    expect(offersView(rows, today).map((e) => e.id).sort()).toEqual([1, 3, 4]);
  });
  it("leaves out deleted applications", () => {
    expect(offersView([row(1), row(2, { deletedAt: "2026-11-01T00:00:00Z" })], today).map((e) => e.id)).toEqual([1]);
  });
  it("sorts deadlines still ahead soonest first, then passed ones most recent first, then no deadline", () => {
    const rows = [
      row(1, { offerDeadline: "2026-11-20" }), row(2), row(3, { offerDeadline: "2026-11-06" }), row(4, { offerDeadline: "2026-11-01" }),
      row(5, { offerDeadline: "2026-11-05" }), row(6, { offerDeadline: "2026-10-01" }),
    ];
    expect(offersView(rows, today).map((e) => e.id)).toEqual([5, 3, 1, 4, 6, 2]);
  });
  it("counts days from today and plainly marks a passed deadline", () => {
    const [soon, passed] = offersView([row(1, { offerDeadline: "2026-11-08" }), row(2, { offerDeadline: "2026-11-03" })], today);
    expect([soon.daysLeft, passed.daysLeft]).toEqual([3, -2]);
    expect([deadlineWords(3), deadlineWords(1), deadlineWords(0), deadlineWords(-1), deadlineWords(-2), deadlineWords(null)])
      .toEqual(["3 days left", "1 day left", "Today", "Passed yesterday", "Passed 2 days ago", ""]);
  });
  it("counts across a month and year end", () => {
    expect(offersView([row(1, { offerDeadline: "2027-01-02" })], "2026-12-30")[0].daysLeft).toBe(3);
  });
  it("keeps the salary as typed text and never reads a number out of it", () => {
    const [e] = offersView([row(1, { offerSalary: "CAD 120,000 + bonus" })], today);
    expect(e.salary).toBe("CAD 120,000 + bonus");
  });
  it("drops a bad stored salary or deadline instead of failing", () => {
    const [e] = offersView([row(1, { offerSalary: "x".repeat(200), offerDeadline: "2026-02-31" })], today);
    expect([e.salary, e.deadline, e.daysLeft]).toEqual(["", "", null]);
  });
  it("reports the stage day, and none when unknown", () => {
    expect(offersView([row(1, { stageAt: "2026-10-20T12:00:00Z" }), row(2, { stageAt: null })], today).map((e) => e.stageDay).sort()).toEqual(["", "2026-10-20"]);
  });
});

describe("loadOffers", () => {
  it("returns the offers only when at least two applications have one", async () => {
    expect(OFFERS_MIN).toBe(2);
    const db = freshDb();
    const mk = (company: string, stage: "Offer" | "Applied") => createApplication(db, { company, companyKey: company, role: "R", roleKey: "r", stage, when: "2026-10-01T12:00:00Z" });
    await mk("One", "Offer");
    await mk("Other", "Applied");
    expect(await loadOffers(db)).toEqual([]);
    await mk("Two", "Offer");
    expect((await loadOffers(db)).map((e) => e.company).sort()).toEqual(["One", "Two"]);
  });
});

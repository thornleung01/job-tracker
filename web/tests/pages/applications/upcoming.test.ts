import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, $$, addApp, addMail, cleanup, daysAgo, freshDb, mountPage, row, text } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";
import { upsertAccount } from "../../../src/db/repo";
import type { JobTrackerDB } from "../../../src/db/schema";
import { localToday } from "../../../src/db/time";
import { shortDay } from "../../../src/sync/upcoming";

// Freeze only the clock's date (the harness times itself with performance.now), so "today" can't change under a test at midnight.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T12:00:00"));
});
afterEach(async () => {
  await cleanup();
  vi.useRealTimers();
});

/** The viewer's calendar day `n` days from now, as YYYY-MM-DD. */
const inDays = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localToday(d);
};

const strip = (container: HTMLElement) => $(container, "section.coming-up");
const stripRows = (container: HTMLElement) => $$(container, "section.coming-up a").map((a) => text(a));

const names = (container: HTMLElement) => $$(container, "section.coming-up .coming-up-company").map((e) => text(e));

type Stage = NonNullable<Parameters<typeof addApp>[2]>["stage"];

/**
 * An application with one interview email that names `day`. `when` is when the email arrived: a day that has passed only
 * gets as far as the "day is before today" check if the email is old enough for that day to be inside its own window.
 */
async function interview(db: JobTrackerDB, account: number, company: string, day: string | null, o: { role?: string; thread?: string; subject?: string; stage?: Stage; last?: number; when?: Date } = {}): Promise<number> {
  const id = await addApp(db, company, { role: o.role ?? "Analyst", stage: o.stage ?? "Interview", last: o.last });
  await addMail(db, account, id, { event: "interview", subject: o.subject ?? "Interview invitation", body: day ? `We will meet on ${day} at 10:00.` : "Let's find a time.", threadId: o.thread ?? `thread-${company}`, when: o.when });
  return id;
}

describe("upcoming interviews in the list", () => {
  it("shows the day under the stage, and Today and Tomorrow in words", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    await interview(db, account, "Acme", inDays(3));
    await interview(db, account, "Beta", inDays(0));
    await interview(db, account, "Gamma", inDays(1));
    await interview(db, account, "Later", inDays(30));
    await interview(db, account, "Nodate", null);
    await addApp(db, "Plain");
    const { container } = await mountPage(ApplicationsPage, db);
    const line = (company: string) => text($(row(container, company), ".interview-line"));
    expect(line("Acme")).toBe(`Interview ${shortDay(inDays(3))}`);
    expect(line("Beta")).toBe("Interview today");
    expect(line("Gamma")).toBe("Interview tomorrow");
    expect(line("Later")).toBe(`Interview ${shortDay(inDays(30))}`);
    expect($(row(container, "Nodate"), ".interview-line")).toBeNull();
    expect($(row(container, "Plain"), ".interview-line")).toBeNull();
  });

  it("leaves out a day that has passed and a cancelled interview, and follows a reschedule", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    await interview(db, account, "Past", inDays(-3), { when: daysAgo(10) });
    const cancelled = await interview(db, account, "Cancelled", inDays(2), { thread: "t-c" });
    await addMail(db, account, cancelled, { event: "interview", subject: "Interview cancelled", body: "Sorry, we have to cancel.", threadId: "t-c", when: new Date(Date.now() + 1000) });
    const moved = await interview(db, account, "Moved", inDays(2), { thread: "t-m" });
    await addMail(db, account, moved, { event: "interview", subject: "Rescheduled: interview", body: `Moved to ${inDays(5)}.`, threadId: "t-m", when: new Date(Date.now() + 1000) });
    const { container } = await mountPage(ApplicationsPage, db);
    expect($(row(container, "Past"), ".interview-line")).toBeNull();
    expect($(row(container, "Cancelled"), ".interview-line")).toBeNull();
    expect(text($(row(container, "Moved"), ".interview-line"))).toBe(`Interview ${shortDay(inDays(5))}`);
  });
});

describe("closed applications", () => {
  it("shows no interview line and no Coming up row for a rejected application or an offer", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const rejected = await interview(db, account, "Turned", inDays(2));
    await db.applications.update(rejected, { stage: "Rejected" });
    const offer = await interview(db, account, "Won", inDays(2));
    await db.applications.update(offer, { stage: "Offer" });
    await interview(db, account, "Open", inDays(2));
    const { container } = await mountPage(ApplicationsPage, db);
    expect($(row(container, "Turned"), ".interview-line")).toBeNull();
    expect($(row(container, "Won"), ".interview-line")).toBeNull();
    expect($(row(container, "Open"), ".interview-line")).not.toBeNull();
    expect(stripRows(container).join(" ")).toContain("Open");
    expect(stripRows(container).join(" ")).not.toMatch(/Turned|Won/);
  });
});

describe("the Coming up strip", () => {
  it("lists interviews in the next week, soonest first, each linking to its application", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const acme = await interview(db, account, "Acme", inDays(4), { role: "Designer" });
    const beta = await interview(db, account, "Beta", inDays(1), { role: "Engineer" });
    await interview(db, account, "Far", inDays(12));
    const { container } = await mountPage(ApplicationsPage, db);
    const region = strip(container)!;
    expect(region).not.toBeNull();
    const heading = document.getElementById(region.getAttribute("aria-labelledby")!);
    expect(text(heading)).toBe("Coming up");
    expect(stripRows(container)).toEqual([`Beta Engineer Tomorrow`, `Acme Designer ${shortDay(inDays(4))}`]);
    expect($$(region, "a").map((a) => a.getAttribute("href"))).toEqual([`#/app/${beta}`, `#/app/${acme}`]);
    // it sits above the filter card
    const card = $(container, "form.filters")!.closest(".card")!;
    expect(region.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the five soonest when there are more, the earlier-named company first on a shared day", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    // Co0 and Co4 are tomorrow, Co1 and Co5 in two days, Co2 and Co6 in three, Co3 in four.
    for (let i = 0; i < 7; i++) await interview(db, account, `Co${i}`, inDays(i % 4 + 1));
    const { container } = await mountPage(ApplicationsPage, db);
    expect(stripRows(container)).toHaveLength(5);
    expect(names(container)).toEqual(["Co0", "Co4", "Co1", "Co5", "Co2"]);
  });

  it("sorts by day, then company, then id", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    await interview(db, account, "Zebra", inDays(2), { role: "Analyst" });
    await interview(db, account, "Acme", inDays(2), { role: "Zed" });
    await interview(db, account, "Acme", inDays(2), { role: "Abe" });
    await interview(db, account, "Yak", inDays(1));
    const { container } = await mountPage(ApplicationsPage, db);
    // Both Acme rows share a day and a company, so the one saved first goes first, not the one whose role sorts first.
    expect(stripRows(container).map((r) => r.replace(/ (Tomorrow|\w{3}, \w{3} \d+)$/, ""))).toEqual(["Yak Analyst", "Acme Zed", "Acme Abe", "Zebra Analyst"]);
  });

  it("keeps its own order whatever the list is sorted by", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    await interview(db, account, "Acme", inDays(4));
    await interview(db, account, "Beta", inDays(1));
    await interview(db, account, "Gamma", inDays(2));
    const { container } = await mountPage(ApplicationsPage, db, "/?sort=company&dir=desc");
    expect($$(container, "tr.app-row [data-col=company] strong").map((e) => text(e))).toEqual(["Gamma", "Beta", "Acme"]);
    expect(names(container)).toEqual(["Beta", "Gamma", "Acme"]);
  });

  it("shows a line for Heard back and Assessment applications too", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    await interview(db, account, "Orion", inDays(2), { stage: "Heard back" });
    await interview(db, account, "Vega", inDays(3), { stage: "Assessment" });
    const { container } = await mountPage(ApplicationsPage, db);
    expect(text($(row(container, "Orion"), ".interview-line"))).toBe(`Interview ${shortDay(inDays(2))}`);
    expect(text($(row(container, "Vega"), ".interview-line"))).toBe(`Interview ${shortDay(inDays(3))}`);
    expect(names(container)).toEqual(["Orion", "Vega"]);
  });

  it("is not there when nothing is within seven days", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    await interview(db, account, "Far", inDays(10));
    await interview(db, account, "Past", inDays(-2), { when: daysAgo(10) });
    await addApp(db, "Plain");
    const { container } = await mountPage(ApplicationsPage, db);
    expect(strip(container)).toBeNull();
    expect(container.textContent).not.toContain("Coming up");
  });

  it("is hidden while a search, stage, account or follow-up filter is on", async () => {
    for (const to of ["/", "/?q=acme", "/?stage=Applied", "/?account=1", "/?followUp=1"]) {
      const db = freshDb();
      const account = await upsertAccount(db, "gmail", "me@gmail.com");
      expect(account).toBe(1);
      // Applied and quiet for a week, so it passes every one of those filters
      await interview(db, account, "Acme", inDays(2), { stage: "Applied", last: 8 });
      const { container } = await mountPage(ApplicationsPage, db, to);
      expect(row(container, "Acme"), to).toBeTruthy();
      expect(strip(container) === null, to).toBe(to !== "/");
      await cleanup();
    }
  });
});

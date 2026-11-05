import { afterEach, describe, expect, it } from "vitest";
import { $, $$, addApp, addMail, cleanup, freshDb, mountPage, text } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";
import { upsertAccount } from "../../../src/db/repo";
import type { JobTrackerDB } from "../../../src/db/schema";
import { localToday } from "../../../src/db/time";
import { shortDay } from "../../../src/sync/upcoming";

afterEach(cleanup);

/** The viewer's calendar day `n` days from now, as YYYY-MM-DD. */
const inDays = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localToday(d);
};

const row = (container: HTMLElement, company: string) =>
  [...container.querySelectorAll("tr.app-row")].find((r) => text(r).includes(company)) as HTMLElement;
const strip = (container: HTMLElement) => $(container, "section.coming-up");
const stripRows = (container: HTMLElement) => $$(container, "section.coming-up a").map((a) => text(a));

/** An application with one interview email that names `day`. */
async function interview(db: JobTrackerDB, account: number, company: string, day: string | null, o: { role?: string; thread?: string; subject?: string } = {}): Promise<number> {
  const id = await addApp(db, company, { role: o.role ?? "Analyst", stage: "Interview" });
  await addMail(db, account, id, { event: "interview", subject: o.subject ?? "Interview invitation", body: day ? `We will meet on ${day} at 10:00.` : "Let's find a time.", threadId: o.thread ?? `thread-${company}` });
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
    await interview(db, account, "Past", inDays(-3));
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

  it("shows at most five", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    for (let i = 0; i < 7; i++) await interview(db, account, `Co${i}`, inDays(i % 4 + 1));
    const { container } = await mountPage(ApplicationsPage, db);
    expect(stripRows(container)).toHaveLength(5);
  });

  it("is not there when nothing is within seven days", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    await interview(db, account, "Far", inDays(10));
    await interview(db, account, "Past", inDays(-2));
    await addApp(db, "Plain");
    const { container } = await mountPage(ApplicationsPage, db);
    expect(strip(container)).toBeNull();
    expect(container.textContent).not.toContain("Coming up");
  });

  it("is hidden while a search, stage or account filter is on", async () => {
    for (const to of ["/", "/?q=acme", "/?stage=Interview", "/?account=1"]) {
      const db = freshDb();
      const account = await upsertAccount(db, "gmail", "me@gmail.com");
      expect(account).toBe(1);
      await interview(db, account, "Acme", inDays(2));
      const { container } = await mountPage(ApplicationsPage, db, to);
      expect(row(container, "Acme"), to).toBeTruthy();
      expect(strip(container) === null, to).toBe(to !== "/");
      await cleanup();
    }
  });
});

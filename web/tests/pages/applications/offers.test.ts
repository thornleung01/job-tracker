import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pinClock } from "../../support/clock";
import { $, $$, addApp, button, cleanup, click, freshDb, mountPage, text } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";
import { dayText } from "../../../src/db/dayText";
import { openDatabase } from "../../../src/db/schema";
import { localToday } from "../../../src/db/time";

afterEach(cleanup);
beforeEach(() => sessionStorage.clear());
// Thursday 2026-11-05 at noon UTC, which is Friday morning in Kiritimati: deadlines are written relative to the viewer's own today
pinClock();
const inDays = (n: number): string => {
  const [y, m, d] = localToday().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const toggle = (c: HTMLElement) => $(c, ".compare-offers-toggle") as HTMLButtonElement | null;
const rows = (c: HTMLElement) => $$(c, ".compare-offers-table tbody tr").map((r) => $$(r, "th, td").map((x) => text(x)));

async function seed() {
  const db = freshDb();
  const later = await addApp(db, "Later Co", { stage: "Offer", role: "Analyst" });
  const soon = await addApp(db, "Soon Inc", { stage: "Offer", role: "Engineer" });
  const none = await addApp(db, "Open Ltd", { stage: "Offer", role: "Designer" });
  await addApp(db, "Not yet", { stage: "Interview" });
  await db.applications.update(later, { offerSalary: "$120k + equity", offerDeadline: inDays(15), stageAt: "2026-10-20T12:00:00Z" });
  await db.applications.update(soon, { offerSalary: "CAD 95,000", offerDeadline: inDays(2), stageAt: "2026-10-25T12:00:00Z" });
  await db.applications.update(none, { stageAt: "2026-10-30T12:00:00Z" });
  return { db, later, soon, none };
}

describe("compare offers", () => {
  it("is not there with fewer than two offers", async () => {
    const db = freshDb();
    await addApp(db, "Only", { stage: "Offer" });
    await addApp(db, "Other", { stage: "Applied" });
    const { container } = await mountPage(ApplicationsPage, db);
    expect($(container, ".compare-offers")).toBeNull();
  });

  it("appears above the table with two or more, collapsed, with the count", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db);
    const t = toggle(container)!;
    expect(text(t)).toContain("Compare offers");
    expect(text(t)).toContain("3");
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect($(container, "#compare-offers-body")!.hasAttribute("hidden")).toBe(true);
    expect($(container, ".compare-offers-table")).toBeNull();
    expect($(container, ".compare-offers")!.compareDocumentPosition($(container, "table.list")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens to a table sorted by the soonest deadline, with salary as typed, days left and a link", async () => {
    const { db, soon } = await seed();
    const { container } = await mountPage(ApplicationsPage, db);
    await click(toggle(container));
    expect(toggle(container)!.getAttribute("aria-expanded")).toBe("true");
    expect($$(container, ".compare-offers-table thead th").map((h) => text(h))).toEqual(["Company", "Role", "Salary", "Decision deadline", "Stage date"]);
    expect(rows(container)).toEqual([
      ["Soon Inc", "Engineer", "CAD 95,000", `${dayText(inDays(2), "short")} 2 days left`, "Offer, Oct 25"],
      ["Later Co", "Analyst", "$120k + equity", `${dayText(inDays(15), "short")} 15 days left`, "Offer, Oct 20"],
      ["Open Ltd", "Designer", "Not set", "No deadline", "Offer, Oct 30"],
    ]);
    expect($(container, ".compare-offers-table tbody a")!.getAttribute("href")).toBe(`#/app/${soon}`);
  });

  it("says plainly when a deadline has passed", async () => {
    const { db, soon } = await seed();
    await db.applications.update(soon, { offerDeadline: inDays(-2) });
    const { container } = await mountPage(ApplicationsPage, db);
    await click(toggle(container));
    expect(rows(container).find((r) => r[0] === "Soon Inc")![3]).toBe(`${dayText(inDays(-2), "short")} Passed 2 days ago`);
  });

  it("includes an application with offer details that is no longer at Offer, and leaves out deleted ones", async () => {
    const { db, later } = await seed();
    await db.applications.update(later, { stage: "Rejected" });
    const gone = (await db.applications.toArray()).find((a) => a.company === "Open Ltd")!.id;
    await db.applications.update(gone, { deletedAt: new Date().toISOString() });
    const { container } = await mountPage(ApplicationsPage, db);
    await click(toggle(container));
    expect(rows(container).map((r) => r[0])).toEqual(["Soon Inc", "Later Co"]);
  });

  it("remembers open or closed for the session, per database", async () => {
    const { db } = await seed();
    const first = await mountPage(ApplicationsPage, db);
    await click(toggle(first.container));
    await cleanup();
    const again = openDatabase(db.name);   // the same database, as after a reload
    const second = await mountPage(ApplicationsPage, again);
    expect(toggle(second.container)!.getAttribute("aria-expanded")).toBe("true");
    await click(toggle(second.container));
    await cleanup();
    const third = await mountPage(ApplicationsPage, again);
    expect(toggle(third.container)!.getAttribute("aria-expanded")).toBe("false");
    // another account's database has its own memory
    sessionStorage.setItem(`jobtracker:offers-open:${again.name}`, "1");
    await cleanup();
    const other = await seed();
    expect(sessionStorage.getItem(`jobtracker:offers-open:${other.db.name}`)).toBeNull();
    again.close();
  });

  it("shows a hostile company as text", async () => {
    const { db, none } = await seed();
    await db.applications.update(none, { company: "<img src=x onerror=alert(1)>", offerSalary: "<b>big</b>" });
    const { container } = await mountPage(ApplicationsPage, db);
    await click(toggle(container));
    expect($(container, ".compare-offers img, .compare-offers b")).toBeNull();
    expect(text($(container, ".compare-offers-table"))).toContain("<img src=x onerror=alert(1)>");
  });

  it("is reachable by keyboard: the heading holds a real button, and the table has headers", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db);
    expect($(container, "h2 > button.compare-offers-toggle")).not.toBeNull();
    expect(button(container, "Compare offers 3")).not.toBeNull();
    await click(toggle(container));
    expect($$(container, ".compare-offers-table th[scope=col]").length).toBe(5);
    expect($$(container, ".compare-offers-table th[scope=row]").length).toBe(3);
  });
});

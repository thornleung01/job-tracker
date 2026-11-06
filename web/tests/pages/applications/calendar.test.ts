import { act, createElement, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, $$, addApp, addMail, button, cleanup, click, freshDb, key, mountPage, settle, text, type, waitFor } from "./harness";
import { withFakes, draft } from "./paste-helpers";
import ApplicationsPage, { listUrl } from "../../../src/pages/applications";
import type { PageProps } from "../../../src/app/pageProps";
import { upsertAccount } from "../../../src/db/repo";
import type { JobTrackerDB } from "../../../src/db/schema";
import { localToday } from "../../../src/db/time";
import { icsForInterviews } from "../../../src/sync/ics";
import { saveView } from "../../../src/sync/savedViews";

// Freeze only the clock's date (the harness times itself with performance.now). Thursday 5 November 2026: the grid runs from
// Monday 26 October to Sunday 6 December. NOW is that moment, named once: it is also what the calendar files are stamped with.
const NOW = new Date("2026-11-05T12:00:00");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (URL as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
});

const inDays = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localToday(d);
};

interface Seeded { db: JobTrackerDB; acme: number; beta: number; gamma: number }

/**
 * Acme (Interview stage): interviews on 10 and 12 November, applied 26 October (a leading day of the grid).
 * Beta (Applied): applied 2 November, interview on 9 November, which is also its follow-up day.
 * Gamma (Rejected): applied 16 October, outside the grid.
 */
async function seed(): Promise<Seeded> {
  const db = freshDb();
  const account = await upsertAccount(db, "gmail", "me@gmail.com");
  const acme = await addApp(db, "Acme", { stage: "Interview", applied: 10, last: 1 });
  await addMail(db, account, acme, { event: "interview", body: `We will meet on ${inDays(5)} at 10:00.`, threadId: "t-acme-1" });
  await addMail(db, account, acme, { event: "interview", body: `Second round on ${inDays(7)} at 14:00.`, threadId: "t-acme-2" });
  const beta = await addApp(db, "Beta", { stage: "Applied", applied: 3, last: 3 });
  await addMail(db, account, beta, { event: "interview", body: `We will meet on ${inDays(4)} at 10:00.`, threadId: "t-beta" });
  const gamma = await addApp(db, "Gamma", { stage: "Rejected", applied: 20, last: 9 });
  return { db, acme, beta, gamma };
}

const CAL = "/?view=calendar";
const cells = (c: HTMLElement) => $$(c, "[role=gridcell]") as HTMLElement[];
const cell = (c: HTMLElement, day: string) => $(c, `[role=gridcell][data-day="${day}"]`) as HTMLElement;
const title = (c: HTMLElement) => text($(c, ".cal-title"));
const panel = (c: HTMLElement) => $(c, "section.cal-panel");
const focusedDay = () => (document.activeElement as HTMLElement | null)?.dataset.day;

/** The page wrapped so every navigation is recorded with whether it replaced the history entry. */
function spied() {
  const calls: { to: string; replace: boolean }[] = [];
  const Spy: ComponentType<PageProps> = (props) =>
    createElement(ApplicationsPage, { ...props, navigate: (to, opts) => { calls.push({ to, replace: Boolean(opts?.replace) }); props.navigate(to, opts); } });
  return { calls, Spy };
}

describe("the address", () => {
  it("leaves the default list view out and carries the month and day only in the calendar", () => {
    expect(listUrl({})).toBe("/");
    expect(listUrl({ view: "list", month: "2026-12", day: "2026-12-03" })).toBe("/");
    expect(listUrl({ view: "calendar" })).toBe("/?view=calendar");
    expect(listUrl({ stage: "Applied", view: "calendar", month: "2026-12", day: "2026-12-03" })).toBe("/?stage=Applied&view=calendar&month=2026-12&day=2026-12-03");
  });

  it("falls back to the list for a view it doesn't know, and ignores a month or day that isn't one", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db, "/?view=sideways&month=2026-13&day=nope");
    expect($(container, "table.list")).not.toBeNull();
    expect($(container, "[role=grid]")).toBeNull();
    const second = await mountPage(ApplicationsPage, db, "/?view=calendar&month=2026-13&day=2026-02-30");
    expect(title(second.container)).toBe("November 2026");
    expect(panel(second.container)).toBeNull();
  });

  it("restores the month and the day on reload", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db, `${CAL}&month=2026-12&day=2026-12-03`);
    expect(title(container)).toBe("December 2026");
    expect(text($(container, ".cal-panel-title"))).toBe("Thursday, December 3, 2026");
    expect(cell(container, "2026-12-03").getAttribute("aria-selected")).toBe("true");
  });

  it("takes the month from the day when there is no month, and drops a day the grid doesn't show", async () => {
    const { db } = await seed();
    const a = await mountPage(ApplicationsPage, db, `${CAL}&day=2026-12-15`);
    expect(title(a.container)).toBe("December 2026");
    expect(panel(a.container)).not.toBeNull();
    const b = await mountPage(ApplicationsPage, db, `${CAL}&month=2026-11&day=2027-03-01`);
    expect(panel(b.container)).toBeNull();
  });
});

describe("the calendar view", () => {
  it("shows the month grid with today marked, and neither the table nor Coming up", async () => {
    const { db } = await seed();
    const list = await mountPage(ApplicationsPage, db);
    expect($(list.container, "section.coming-up")).not.toBeNull();   // the strip shows in the list, so its absence below means something
    const { container } = await mountPage(ApplicationsPage, db, CAL);
    expect(title(container)).toBe("November 2026");
    expect($(container, "[role=grid]")).not.toBeNull();
    expect(cells(container)).toHaveLength(42);
    const today = $$(container, "[aria-current=date]");
    expect(today).toHaveLength(1);
    expect((today[0] as HTMLElement).dataset.day).toBe("2026-11-05");
    expect($(container, "table.list")).toBeNull();
    expect($(container, "section.coming-up")).toBeNull();
    expect($(container, ".bulk-bar")).toBeNull();
    // the rest of the page stays: filters, add button, the count line
    expect($(container, "form.filters")).not.toBeNull();
    expect(text($(container, ".result-line"))).toContain("Showing 3 applications");
  });

  it("starts the week on Monday and names the weekdays", async () => {
    const { container } = await mountPage(ApplicationsPage, (await seed()).db, CAL);
    expect($$(container, "[role=columnheader]").map((h) => h.getAttribute("aria-label"))).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    expect(cells(container)[0].dataset.day).toBe("2026-10-26");
    expect(cells(container)[41].dataset.day).toBe("2026-12-06");
    expect(cell(container, "2026-10-26").dataset.outside).toBe("true");
    expect(cell(container, "2026-11-05").dataset.outside).toBeUndefined();
  });

  it("labels each cell with its date, the event count and the kinds", async () => {
    const { container } = await mountPage(ApplicationsPage, (await seed()).db, CAL);
    expect(cell(container, "2026-11-09").getAttribute("aria-label")).toBe("Monday, November 9, 2026. 2 events: interview, follow up due");
    expect(cell(container, "2026-11-10").getAttribute("aria-label")).toBe("Tuesday, November 10, 2026. 1 event: interview");
    expect(cell(container, "2026-11-02").getAttribute("aria-label")).toBe("Monday, November 2, 2026. 1 event: applied");
    expect(cell(container, "2026-11-20").getAttribute("aria-label")).toBe("Friday, November 20, 2026. No events");
    // the chips are for the eye: screen readers get the label
    const chips = $(cell(container, "2026-11-09"), ".cal-chips")!;
    expect(chips.getAttribute("aria-hidden")).toBe("true");
    expect($$(chips, ".cal-chip").map(text)).toEqual(["Beta", "Beta"]);
  });

  it("has one tab stop, on today at first", async () => {
    const { container } = await mountPage(ApplicationsPage, (await seed()).db, CAL);
    const stops = cells(container).filter((c) => c.tabIndex === 0);
    expect(stops.map((c) => c.dataset.day)).toEqual(["2026-11-05"]);
  });

  it("follows the same filters as the list: a stage filter removes the other applications' events", async () => {
    const { db } = await seed();
    const all = await mountPage(ApplicationsPage, db, CAL);
    expect(cell(all.container, "2026-11-09").getAttribute("aria-label")).toContain("2 events");
    const { container } = await mountPage(ApplicationsPage, db, `${CAL}&stage=Interview`);
    expect(cell(container, "2026-11-09").getAttribute("aria-label")).toContain("No events");
    expect(cell(container, "2026-11-10").getAttribute("aria-label")).toContain("1 event: interview");
  });

  it("shows nothing for an application the search leaves out", async () => {
    const { container } = await mountPage(ApplicationsPage, (await seed()).db, `${CAL}&q=Acme`);
    expect(cell(container, "2026-11-09").getAttribute("aria-label")).toContain("No events");
    expect(cell(container, "2026-11-10").getAttribute("aria-label")).toContain("1 event");
  });
});

describe("the view toggle", () => {
  it("is a nav of two links that carry the filters, and marks the current view", async () => {
    const { db } = await seed();
    const list = await mountPage(ApplicationsPage, db, "/?stage=Applied&sort=company&dir=asc");
    const nav = $(list.container, 'nav[aria-label="View"]')!;
    const [listLink, calLink] = $$(nav, "a.tab") as HTMLAnchorElement[];
    expect([text(listLink), text(calLink)]).toEqual(["List", "Calendar"]);
    expect(listLink.getAttribute("aria-current")).toBe("true");
    expect(calLink.getAttribute("aria-current")).toBeNull();
    expect(calLink.getAttribute("href")).toBe("#/?stage=Applied&sort=company&dir=asc&view=calendar");
    const cal = await mountPage(ApplicationsPage, db, `${CAL}&month=2026-12&day=2026-12-03&stage=Applied`);
    const [listLink2, calLink2] = $$($(cal.container, 'nav[aria-label="View"]')!, "a.tab") as HTMLAnchorElement[];
    expect(calLink2.getAttribute("aria-current")).toBe("true");
    expect(listLink2.getAttribute("aria-current")).toBeNull();
    expect(listLink2.getAttribute("href")).toBe("#/?stage=Applied");   // the month and day stay behind
  });
});

describe("moving between months", () => {
  it("changes the address and the heading, replacing the history entry", async () => {
    const { db } = await seed();
    const { calls, Spy } = spied();
    const { container, location } = await mountPage(Spy, db, CAL);
    await click(button(container, "Next month"));
    expect(location()).toBe("/?view=calendar&month=2026-12");
    expect(title(container)).toBe("December 2026");
    await click(button(container, "Previous month"));
    await click(button(container, "Previous month"));
    expect(location()).toBe("/?view=calendar&month=2026-10");
    expect(title(container)).toBe("October 2026");
    await click(button(container, "Today"));
    expect(location()).toBe("/?view=calendar&month=2026-11");
    expect(calls.every((c) => c.replace)).toBe(true);
    expect(calls).toHaveLength(4);
  });

  it("announces the month politely, and the grid is named by it", async () => {
    const { container } = await mountPage(ApplicationsPage, (await seed()).db, CAL);
    expect($(container, "h2.cal-title")!.getAttribute("aria-live")).toBe("polite");
    expect($(container, "[role=grid]")!.getAttribute("aria-labelledby")).toBe($(container, "h2.cal-title")!.id);
  });

  it("drops the chosen day when the month moves away from it, and keeps it while it is still in the grid", async () => {
    const { db } = await seed();
    const { container, location } = await mountPage(ApplicationsPage, db, `${CAL}&month=2026-11&day=2026-11-10`);
    await click(button(container, "Next month"));
    expect(location()).toBe("/?view=calendar&month=2026-12");
    expect(panel(container)).toBeNull();
    await click(button(container, "Previous month"));
    await click(cell(container, "2026-11-30"));
    expect(location()).toBe("/?view=calendar&month=2026-11&day=2026-11-30");
    await click(button(container, "Next month"));
    expect(location()).toBe("/?view=calendar&month=2026-12&day=2026-11-30");   // the 30th is the first day of December's grid, so the choice stays
    expect(cell(container, "2026-11-30").getAttribute("aria-selected")).toBe("true");
  });
});

describe("the keyboard", () => {
  it("moves focus a day or a week with the arrows and to the row ends with Home and End", async () => {
    const { container } = await mountPage(ApplicationsPage, (await seed()).db, CAL);
    const start = cell(container, "2026-11-05");
    await act(async () => start.focus());
    await key(start, "ArrowRight");
    expect(focusedDay()).toBe("2026-11-06");
    await key(document.activeElement, "ArrowDown");
    expect(focusedDay()).toBe("2026-11-13");
    await key(document.activeElement, "ArrowLeft");
    expect(focusedDay()).toBe("2026-11-12");
    await key(document.activeElement, "ArrowUp");
    expect(focusedDay()).toBe("2026-11-05");
    await key(document.activeElement, "Home");
    expect(focusedDay()).toBe("2026-11-02");
    await key(document.activeElement, "End");
    expect(focusedDay()).toBe("2026-11-08");
    // the tab stop follows the focus
    expect(cells(container).filter((c) => c.tabIndex === 0).map((c) => c.dataset.day)).toEqual(["2026-11-08"]);
  });

  it("keeps Home and End inside the month on the first and last rows", async () => {
    const { container } = await mountPage(ApplicationsPage, (await seed()).db, CAL);
    // the first row is 26 October to 1 November and the last 30 November to 6 December: only one day of each is November's
    await act(async () => cell(container, "2026-11-01").focus());
    await key(document.activeElement, "Home");
    expect(focusedDay()).toBe("2026-11-01");
    await act(async () => cell(container, "2026-11-30").focus());
    await key(document.activeElement, "End");
    expect(focusedDay()).toBe("2026-11-30");
  });

  it("changes month when an arrow passes the edge, and keeps focus on the day it reached", async () => {
    const { db } = await seed();
    const { container, location } = await mountPage(ApplicationsPage, db, `${CAL}&month=2026-11`);
    const last = cell(container, "2026-11-29");
    await act(async () => last.focus());
    await key(last, "ArrowDown");   // 6 December: out of November
    expect(location()).toBe("/?view=calendar&month=2026-12");
    expect(title(container)).toBe("December 2026");
    await waitFor(() => focusedDay() === "2026-12-06");
    await key(document.activeElement, "ArrowLeft");
    expect(focusedDay()).toBe("2026-12-05");
    await key(document.activeElement, "ArrowUp");   // 28 November: back out of December
    expect(location()).toBe("/?view=calendar&month=2026-11");
    await waitFor(() => focusedDay() === "2026-11-28");
  });

  it("moves a month with Page Down and Page Up, keeping the day of the month (or the last one)", async () => {
    const { db } = await seed();
    const { container, location } = await mountPage(ApplicationsPage, db, `${CAL}&month=2027-01`);
    const jan31 = cell(container, "2027-01-31");
    await act(async () => jan31.focus());
    await key(jan31, "PageDown");
    expect(location()).toBe("/?view=calendar&month=2027-02");
    await waitFor(() => focusedDay() === "2027-02-28");
    await key(document.activeElement, "PageUp");
    expect(location()).toBe("/?view=calendar&month=2027-01");
    await waitFor(() => focusedDay() === "2027-01-28");
  });

  it("opens the day with Enter or Space: the panel lists links to the applications and takes focus", async () => {
    const { db, beta } = await seed();
    const { container, location } = await mountPage(ApplicationsPage, db, CAL);
    const nine = cell(container, "2026-11-09");
    await act(async () => nine.focus());
    await key(nine, "Enter");
    expect(location()).toBe("/?view=calendar&month=2026-11&day=2026-11-09");
    expect(cell(container, "2026-11-09").getAttribute("aria-selected")).toBe("true");
    const heading = $(container, "h3.cal-panel-title") as HTMLElement;
    expect(text(heading)).toBe("Monday, November 9, 2026");
    expect(heading.tabIndex).toBe(-1);
    await waitFor(() => document.activeElement === heading);
    const links = $$(panel(container)!, "a.cal-event") as HTMLAnchorElement[];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([`#/app/${beta}`, `#/app/${beta}`]);
    expect(links.map((a) => text($(a, ".cal-event-kind")))).toEqual(["Interview", "Follow up due"]);
    expect(text(links[0])).toContain("Beta");
    expect(text(links[0])).toContain("Analyst");
    expect($(links[0], ".badge.Applied")).not.toBeNull();
    expect(text(links[0])).not.toContain("Past");
    // Space does the same on another day
    const ten = cell(container, "2026-11-10");
    await act(async () => ten.focus());
    await key(ten, " ");
    expect(location()).toBe("/?view=calendar&month=2026-11&day=2026-11-10");
  });

  it("moves focus to the panel again when Enter is pressed on the day that is already open, and doesn't steal it later", async () => {
    const { db } = await seed();
    const { container, visited } = await mountPage(ApplicationsPage, db, `${CAL}&day=2026-11-10`);
    const heading = $(container, "h3.cal-panel-title") as HTMLElement;
    const ten = cell(container, "2026-11-10");
    await act(async () => ten.focus());
    await key(ten, "Enter");
    // nothing to wait for: the address is the same, so focus moves at once
    expect(document.activeElement).toBe(heading);
    expect(visited).toEqual([]);
    // later renders (the page's data changing) leave focus where the person put it
    await act(async () => ten.focus());
    await db.activity.add({ applicationId: 1, kind: "note", label: null, body: "x", occurredAt: "2026-11-01T00:00:00Z", createdAt: "2026-11-01T00:00:00Z" });
    await settle();
    expect(document.activeElement).toBe(ten);
  });

  it("returns focus from the panel to the day's cell on Escape", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db, `${CAL}&day=2026-11-10`);
    const heading = $(container, "h3.cal-panel-title") as HTMLElement;
    await act(async () => heading.focus());
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => heading.dispatchEvent(e));
    expect(focusedDay()).toBe("2026-11-10");
    expect(e.defaultPrevented).toBe(true);
  });

  it("marks past events and says when a day has nothing", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db, `${CAL}&day=2026-11-02`);
    expect(text(panel(container)!)).toContain("Applied");
    expect(text($(panel(container)!, "a.cal-event"))).toContain("Past");
    await click(cell(container, "2026-11-20"));
    expect(text(panel(container)!)).toContain("Nothing on this day.");
    expect($$(panel(container)!, "a")).toHaveLength(0);
  });
});

describe("a leading day", () => {
  it("moves the month to its own when chosen", async () => {
    const { db } = await seed();
    const { container, location } = await mountPage(ApplicationsPage, db, CAL);
    await click(cell(container, "2026-10-26"));
    expect(location()).toBe("/?view=calendar&month=2026-10&day=2026-10-26");
    expect(title(container)).toBe("October 2026");
    expect(cell(container, "2026-10-26").getAttribute("aria-selected")).toBe("true");
    expect(cell(container, "2026-10-26").dataset.outside).toBeUndefined();
  });
});

describe("on a phone", () => {
  const stubPhone = (matches: boolean) =>
    vi.stubGlobal("matchMedia", (media: string) => ({ matches, media, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));

  it("shows the agenda and no grid, today first, with links straight to the applications", async () => {
    stubPhone(true);
    const { db, beta, acme } = await seed();
    const { container } = await mountPage(ApplicationsPage, db, CAL);
    expect($(container, "[role=grid]")).toBeNull();
    expect(panel(container)).toBeNull();
    const days = $$(container, ".cal-agenda-day");
    expect(text($(days[0], "h3"))).toBe("Today, Thursday, November 5");
    expect(text(days[0])).toContain("Nothing today.");
    expect(days.map((d) => (d as HTMLElement).dataset.day)).toEqual(["2026-11-05", "2026-11-02", "2026-11-09", "2026-11-10", "2026-11-12"]);
    expect(days.every((d) => $(d, "ol, p") !== null)).toBe(true);
    const nine = $$(days[2], "ol a") as HTMLAnchorElement[];
    expect(nine.map((a) => a.getAttribute("href"))).toEqual([`#/app/${beta}`, `#/app/${beta}`]);
    expect(($(days[3], "ol a") as HTMLAnchorElement).getAttribute("href")).toBe(`#/app/${acme}`);
    // the heading and buttons remain
    expect(title(container)).toBe("November 2026");
    expect(button(container, "Next month")).not.toBeNull();
  });

  it("shows the grid and no agenda when the screen is wide", async () => {
    stubPhone(false);
    const { container } = await mountPage(ApplicationsPage, (await seed()).db, CAL);
    expect($(container, "[role=grid]")).not.toBeNull();
    expect($(container, ".cal-agenda")).toBeNull();
  });

  it("says when the month is empty", async () => {
    stubPhone(true);
    const { container } = await mountPage(ApplicationsPage, (await seed()).db, `${CAL}&month=2027-06`);
    expect(text($(container, ".cal-empty"))).toBe("Nothing this month.");
  });
});

describe("every navigation keeps the calendar", () => {
  const month = "&month=2026-12&day=2026-12-03";

  it("Apply filters", async () => {
    const { db } = await seed();
    const { container, visited } = await mountPage(ApplicationsPage, db, CAL + month);
    await type($(container, "#f-stage"), "Interview");
    await click(button(container, "Apply filters"));
    expect(visited.at(-1)).toBe("/?stage=Interview&view=calendar&month=2026-12&day=2026-12-03");
  });

  it("the search suggestions", async () => {
    const { db } = await seed();
    const { container, visited } = await mountPage(ApplicationsPage, db, CAL + month);
    const input = $(container, "#f-q") as HTMLInputElement;
    await type(input, "ac");
    const option = $$(container, "[role=option]").find((o) => text(o).startsWith("Acme"))!;
    await act(async () => option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    expect(visited.at(-1)).toBe("/?q=Acme&view=calendar&month=2026-12&day=2026-12-03");
  });

  it("the stage tabs and All", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db, CAL + month + "&stage=Applied");
    const tabs = $$(container, 'nav[aria-label="Filter by stage"] a.tab') as HTMLAnchorElement[];
    const hrefs = tabs.map((t) => t.getAttribute("href"));
    expect(hrefs[0]).toBe("#/?view=calendar&month=2026-12&day=2026-12-03");           // All
    expect(hrefs[1]).toBe("#/?view=calendar&month=2026-12&day=2026-12-03");           // Applied is current: choosing it again shows all
    expect(hrefs[2]).toBe("#/?stage=Heard+back&view=calendar&month=2026-12&day=2026-12-03");
    expect(hrefs.every((h) => h!.includes("view=calendar&month=2026-12&day=2026-12-03"))).toBe(true);
  });

  it("Clear filters", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db, CAL + month + "&stage=Applied&q=beta");
    expect($(container, "a.clear-filters")!.getAttribute("href")).toBe("#/?view=calendar&month=2026-12&day=2026-12-03");
  });

  it("the saved views", async () => {
    const { db } = await seed();
    await saveView(db, "Applied only", { stage: "Applied", q: "", account: 0, followUp: false, ghosted: false, sort: "", dir: "" });
    const { container, visited } = await mountPage(ApplicationsPage, db, CAL + month);
    await waitFor(() => $(container, ".view-chip-link") !== null);
    const chip = $(container, ".view-chip-link") as HTMLAnchorElement;
    expect(chip.getAttribute("href")).toBe("#/?stage=Applied&view=calendar&month=2026-12&day=2026-12-03");
    await click(chip);
    expect(visited.at(-1)).toBe("/?stage=Applied&view=calendar&month=2026-12&day=2026-12-03");
    // and the chip shows as current once the address has it
    await waitFor(() => $(container, ".view-chip-link")!.getAttribute("aria-current") === "true");
  });

  it("clearing the bookmarklet's parameters", async () => {
    const { db } = await seed();
    const { Page } = withFakes({ draftFromHash: vi.fn(() => draft({ company: "Acme", role: "Engineer" })) });
    const { visited } = await mountPage(Page, db, "/?view=calendar&month=2026-12&add=1&c=Acme&r=Engineer");
    await settle();
    expect(visited).toEqual(["/?view=calendar&month=2026-12"]);
  });
});

describe("the page's other features alongside the calendar", () => {
  /** Presses a key on the page; the event says whether the page used it. */
  async function press(k: string, target: Element = document.body): Promise<KeyboardEvent> {
    const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
    await act(async () => {
      target.dispatchEvent(e);
    });
    await settle(0);
    return e;
  }

  it("leaves the row shortcuts alone, and still opens the add form with n and the search with /", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db, CAL);
    for (const k of ["j", "k", "x", "o", "Enter"]) expect((await press(k)).defaultPrevented, k).toBe(false);
    expect($(container, ".is-current")).toBeNull();
    expect((await press("Escape")).defaultPrevented).toBe(false);
    expect((await press("/")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe($(container, "#f-q"));
    (document.activeElement as HTMLElement).blur();
    expect((await press("n")).defaultPrevented).toBe(true);
    await waitFor(() => $(container, "#add-application") !== null);
  });

  it("does not let Enter on a day trigger the list's open-row shortcut", async () => {
    const { db } = await seed();
    const { container, location } = await mountPage(ApplicationsPage, db, CAL);
    const c = cell(container, "2026-11-10");
    await act(async () => c.focus());
    await key(c, "Enter");
    expect(location()).toBe("/?view=calendar&month=2026-11&day=2026-11-10");
    expect($$(container, ".expander")).toHaveLength(0);
  });

  it("keeps the weekly goal, and swaps the offers comparison for each offer's deadline on its day", async () => {
    const db = freshDb();
    const a = await addApp(db, "Soon Inc", { stage: "Offer" });
    const b = await addApp(db, "Later Co", { stage: "Offer" });
    await db.applications.update(a, { offerDeadline: inDays(2) });
    await db.applications.update(b, { offerDeadline: inDays(15) });
    const list = await mountPage(ApplicationsPage, db);
    expect($(list.container, ".compare-offers")).not.toBeNull();
    const { container } = await mountPage(ApplicationsPage, db, CAL);
    expect($(container, ".weekly-goal")).not.toBeNull();
    expect($$(container, ".compare-offers")).toHaveLength(0);
    expect(cell(container, inDays(2)).getAttribute("aria-label")).toContain("offer decision due");
    expect(cell(container, inDays(15)).getAttribute("aria-label")).toContain("offer decision due");
  });
});

describe("downloading interviews", () => {
  function captureDownloads() {
    const saved: { blob: Blob; name: string; url: string }[] = [];
    let next = 0;
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        const url = `blob:cal-${next++}`;
        saved.push({ blob, name: "", url });
        return url;
      }),
      revokeObjectURL: vi.fn(),
    });
    const realClick = HTMLAnchorElement.prototype.click;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      const entry = saved.find((s) => s.url === this.href);
      if (entry) entry.name = this.download;
      else realClick.call(this);
    });
    return saved;
  }
  const read = (blob: Blob) => new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
  const dayButton = (c: HTMLElement) => button(panel(c)!, "Download interviews (.ics)");

  it("offers the day's file only on a day with interviews", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db, `${CAL}&day=2026-11-02`);   // applied only
    expect(dayButton(container)).toBeNull();
    await click(cell(container, "2026-11-20"));   // nothing
    expect(dayButton(container)).toBeNull();
    await click(cell(container, "2026-11-10"));
    expect(dayButton(container)).not.toBeNull();
    await click(cell(container, "2026-11-09"));   // an interview and a follow-up
    expect(dayButton(container)).not.toBeNull();
  });

  it("saves one day's interviews, and only the interviews, under the day's name", async () => {
    const { db, beta } = await seed();
    const saved = captureDownloads();
    const { container } = await mountPage(ApplicationsPage, db, `${CAL}&day=2026-11-09`);
    await click(dayButton(container));
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("job-tracker-interviews-2026-11-09.ics");
    expect(saved[0].blob.type).toBe("text/calendar;charset=utf-8");
    const file = await read(saved[0].blob);
    expect(file).toBe(icsForInterviews([{ appId: beta, company: "Beta", role: "Analyst", stage: "Applied", day: "2026-11-09" }], NOW));
    expect(file.match(/BEGIN:VEVENT/g)).toHaveLength(1);   // the follow-up on the same day isn't an entry
    expect(text($(container, ".cal-panel [role=status]"))).toBe("Calendar file saved.");
  });

  it("saves the month's interviews in day order, and shows the button only when the month has some", async () => {
    const { db, acme, beta } = await seed();
    const saved = captureDownloads();
    const { container } = await mountPage(ApplicationsPage, db, CAL);
    await click(button(container, "Download this month's interviews"));
    expect(saved[0].name).toBe("job-tracker-interviews-2026-11.ics");
    const file = await read(saved[0].blob);
    expect(file).toBe(icsForInterviews([
      { appId: beta, company: "Beta", role: "Analyst", stage: "Applied", day: "2026-11-09" },
      { appId: acme, company: "Acme", role: "Analyst", stage: "Interview", day: "2026-11-10" },
      { appId: acme, company: "Acme", role: "Analyst", stage: "Interview", day: "2026-11-12" },
    ], NOW));
    await click(button(container, "Next month"));
    expect(button(container, "Download this month's interviews")).toBeNull();
  });

  it("leaves the interviews of the neighbouring months out of this month's file", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db, `${CAL}&month=2026-12`);
    // 30 November is in December's grid, but no interview is on it; the November ones are not in the grid at all
    expect(button(container, "Download this month's interviews")).toBeNull();
  });
});

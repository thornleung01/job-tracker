import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { $, $$, addApp, button, cleanup, click, freshDb, mountPage, settle, text, waitFor } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";

// Counts how many times a row's role cell renders, like row-memo.test.ts: it shows how much of the table redraws.
const renders = vi.hoisted(() => ({ n: 0 }));
vi.mock("../../../src/components/quickedit/QuickRole", async (original) => {
  const real = await original<typeof import("../../../src/components/quickedit/QuickRole")>();
  return { ...real, QuickRole: (props: Parameters<typeof real.QuickRole>[0]) => { renders.n++; return real.QuickRole(props); } };
});

afterEach(cleanup);

/** Presses a key somewhere on the page (the body unless a target is given). Returns the event, so a test can see if it was used. */
async function press(key: string, o: { target?: Element; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}): Promise<KeyboardEvent> {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...o });
  await act(async () => {
    (o.target ?? document.body).dispatchEvent(e);
  });
  await settle(0);
  return e;
}

async function seed(n = 4) {
  const db = freshDb();
  // newest activity first, so the list reads Co 0, Co 1, ...
  for (let i = 0; i < n; i++) await addApp(db, `Co ${i}`, { role: "Analyst", last: i + 1 });
  return db;
}
const current = (c: HTMLElement) => $$(c, "tr.app-row.is-current").map((r) => text($(r, "[data-col=company] strong")));
const expander = (c: HTMLElement, name: string) => $$(c, "a.expander").find((a) => text(a) === name) as HTMLElement;

describe("moving through the list", () => {
  it("j and k move a visible current row, mark it for screen readers, and put focus on its name", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    expect(current(container)).toEqual([]);
    await press("j");
    expect(current(container)).toEqual(["Co 0"]);
    expect($(container, "tr.is-current")!.getAttribute("aria-current")).toBe("true");
    expect(document.activeElement).toBe(expander(container, "Co 0"));
    await press("j");
    await press("j");
    expect(current(container)).toEqual(["Co 2"]);
    expect(document.activeElement).toBe(expander(container, "Co 2"));
    await press("k");
    expect(current(container)).toEqual(["Co 1"]);
    // only one row is ever current, and the others carry no aria-current
    expect($$(container, "tr[aria-current]").length).toBe(1);
  });

  it("stops at the ends, and k with nothing current starts from the last row", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed(3));
    await press("k");
    expect(current(container)).toEqual(["Co 2"]);
    await press("j");
    expect(current(container)).toEqual(["Co 2"]);
    await press("k"); await press("k"); await press("k");
    expect(current(container)).toEqual(["Co 0"]);
  });

  it("follows focus: tabbing or clicking into a row makes it current, and j goes on from there", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    await act(async () => expander(container, "Co 2").focus());
    await settle(0);
    expect(current(container)).toEqual(["Co 2"]);
    await press("j");
    expect(current(container)).toEqual(["Co 3"]);
  });

  it("does nothing on an empty list", async () => {
    const { container } = await mountPage(ApplicationsPage, freshDb());
    const e = await press("j");
    expect(current(container)).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
  });

  it("redraws only the two rows that change, not the table", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed(30));
    await press("j");
    await settle(50);
    renders.n = 0;
    await press("j");
    expect(current(container)).toEqual(["Co 1"]);
    expect(renders.n).toBeGreaterThan(0);
    expect(renders.n).toBeLessThanOrEqual(2);
  });
});

describe("acting on the current row", () => {
  it("Enter and o open and close its panel", async () => {
    const m = await mountPage(ApplicationsPage, await seed());
    await press("j");
    // after j the focus is on the company link, which answers Enter itself: the shortcut must not also toggle
    await press("Enter", { target: document.activeElement! });
    expect(m.visited).toEqual([]);
    await press("o");
    expect(m.location()).toContain("open=");
    await waitFor(() => $(m.container, "tr.panel-row:not([hidden])") !== null);
    await press("o");
    await waitFor(() => $(m.container, "tr.panel-row:not([hidden])") === null);
    // Enter with focus on the page itself (the body) toggles too
    (document.activeElement as HTMLElement).blur();
    await press("Enter");
    await waitFor(() => $(m.container, "tr.panel-row:not([hidden])") !== null);
  });

  it("x ticks and unticks the current row's checkbox", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    await press("j");
    await press("x");
    expect(($(container, "input[aria-label='Select Co 0']") as HTMLInputElement).checked).toBe(true);
    expect(($(container, "input[aria-label='Select Co 1']") as HTMLInputElement).checked).toBe(false);
    await press("x");
    expect(($(container, "input[aria-label='Select Co 0']") as HTMLInputElement).checked).toBe(false);
  });

  it("o and x do nothing, and are not swallowed, with no current row", async () => {
    const m = await mountPage(ApplicationsPage, await seed());
    const e = await press("o");
    await press("x");
    expect(m.visited).toEqual([]);
    expect($$(m.container, "input[type=checkbox]:checked").length).toBe(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it("n opens the Add application form with the company field focused", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    await press("n");
    await waitFor(() => $(container, "#add-application") !== null);
    expect(document.activeElement).toBe($(container, "#add-company"));
  });

  it("g then s goes to Settings, and g alone or g then another key does not", async () => {
    const m = await mountPage(ApplicationsPage, await seed());
    await press("g");
    await press("j");
    expect(m.visited).toEqual([]);
    await press("g");
    await press("s");
    expect(m.visited).toEqual(["/settings"]);
  });

  it("/ focuses the search box without typing a slash into it", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    const e = await press("/");
    expect(document.activeElement).toBe($(container, "#f-q"));
    expect(e.defaultPrevented).toBe(true);
    // typing in it afterwards is typing, not shortcuts
    await press("j", { target: $(container, "#f-q")! });
    expect(current(container)).toEqual([]);
  });

  it("Escape clears the current row, and leaves other Escapes alone", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    const none = await press("Escape");
    expect(none.defaultPrevented).toBe(false);
    await press("j");
    await press("Escape");
    expect(current(container)).toEqual([]);
    expect(document.activeElement).not.toBe(expander(container, "Co 0"));
    await press("j");
    expect(current(container)).toEqual(["Co 0"]);
  });
});

describe("when shortcuts stay out of the way", () => {
  it("ignores them while typing in a field, a select or the add form", async () => {
    const m = await mountPage(ApplicationsPage, await seed());
    await click(button(m.container, "Add application"));
    await waitFor(() => $(m.container, "#add-company") !== null);
    for (const key of ["j", "n", "o", "x", "?", "/"]) await press(key, { target: $(m.container, "#add-company")! });
    expect(current(m.container)).toEqual([]);
    expect($(document.body, "[role=dialog]")).toBeNull();
    await press("j", { target: $(m.container, "#f-stage")! });
    expect(current(m.container)).toEqual([]);
  });

  it("ignores them with Ctrl, Meta or Alt held", async () => {
    const m = await mountPage(ApplicationsPage, await seed());
    for (const mod of ["ctrlKey", "metaKey", "altKey"] as const) for (const key of ["j", "n", "?", "/"]) await press(key, { [mod]: true });
    expect(current(m.container)).toEqual([]);
    expect($(m.container, "#add-application")).toBeNull();
    expect($(document.body, "[role=dialog]")).toBeNull();
  });
});

describe("the help dialog", () => {
  const dialog = () => $(document.body, "[role=dialog]") as HTMLElement | null;

  it("opens with ? , lists the shortcuts, takes focus, and Escape closes it and gives focus back", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    await press("j");
    const before = document.activeElement;
    await press("?", { shiftKey: true });
    const d = dialog()!;
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(d.getAttribute("aria-labelledby")).toBeTruthy();
    expect(text(d.querySelector("h2"))).toBe("Keyboard shortcuts");
    for (const label of ["Search", "Next application", "Go to Settings", "Add an application"]) expect(text(d)).toContain(label);
    expect(document.activeElement).toBe(button(d, "Close"));
    await press("Escape", { target: document.activeElement! });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(before);
    expect(container.contains(document.activeElement)).toBe(true);
  });

  it("keeps Tab inside, and the page's keys don't work behind it", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    await press("?");
    const close = button(dialog()!, "Close") as HTMLElement;
    const tab = await press("Tab", { target: close });
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    const back = await press("Tab", { target: close, shiftKey: true });
    expect(back.defaultPrevented).toBe(true);
    await press("j");
    await press("n");
    expect(current(container)).toEqual([]);
    expect($(container, "#add-application")).toBeNull();
    await press("?");
    expect(dialog()).toBeNull();
  });

  it("puts focus on the footer button when ? was pressed with nothing focused", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    expect(document.activeElement).toBe(document.body);
    await press("?", { shiftKey: true });
    await press("Escape", { target: document.activeElement! });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button(container, "Keyboard shortcuts"));
  });

  it("puts focus on the footer button when what had focus at the time has gone", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    const gone = document.createElement("button");
    container.append(gone);
    gone.focus();
    await press("?", { shiftKey: true, target: gone });
    gone.remove();
    await press("Escape", { target: document.activeElement! });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button(container, "Keyboard shortcuts"));
  });

  it("brings focus back into the dialog when it lands on the page behind, and a click on its text stays inside", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    await press("?", { shiftKey: true });
    const d = dialog()!;
    // a click on text focuses the nearest focusable parent: the dialog itself, not <body> or the page
    expect(d.tabIndex).toBe(-1);
    d.focus();
    expect(document.activeElement).toBe(d);
    // a Tab from there, or from the body, that reaches the page behind is turned back
    await act(async () => {
      (document.activeElement as HTMLElement).blur();
      (container.querySelector("a.tab") as HTMLElement).focus();
    });
    expect(d.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(button(d, "Close"));
    // and it lets go once the dialog is shut
    await press("Escape", { target: document.activeElement! });
    (container.querySelector("a.tab") as HTMLElement).focus();
    expect(document.activeElement).toBe(container.querySelector("a.tab"));
  });

  it("opens from the footer button too, and Close puts focus back on it", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    const footer = button(container, "Keyboard shortcuts")!;
    expect(footer.getAttribute("aria-haspopup")).toBe("dialog");
    await click(footer);
    expect(dialog()).not.toBeNull();
    await click(button(dialog()!, "Close"));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(footer);
  });
});

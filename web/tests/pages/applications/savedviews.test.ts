import { afterEach, describe, expect, it } from "vitest";
import { $, $$, addApp, button, cleanup, click, freshDb, key, mountPage, submitForm, text, type, waitFor } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";
import { SAVED_VIEWS_MAX } from "../../../src/db/limits";
import { loadSavedViews, saveView } from "../../../src/sync/savedViews";

afterEach(cleanup);

const chips = (c: HTMLElement) => $$(c, ".view-chip-link").map((a) => text(a));
const chip = (c: HTMLElement, name: string) => $$(c, ".view-chip-link").find((a) => text(a) === name) as HTMLAnchorElement;
const names = (c: HTMLElement) => $$(c, "tr.app-row [data-col=company] strong").map((e) => text(e));

async function seed() {
  const db = freshDb();
  await addApp(db, "Zeta", { stage: "Interview" });
  await addApp(db, "Acme", { stage: "Applied" });
  await addApp(db, "Beta", { stage: "Applied" });
  return db;
}

/** Opens the save form on a page already filtered, types a name and saves. */
async function saveCurrent(c: HTMLElement, name: string) {
  await click(button(c, "Save this view"));
  await type($(c, "input[name=view_name]"), name);
  await click(button(c, "Save view"));
}

describe("saving a view", () => {
  it("names the current filters and shows a chip above the table", async () => {
    const db = await seed();
    const { container } = await mountPage(ApplicationsPage, db, "/?stage=Applied&sort=company&dir=asc");
    expect(chips(container)).toEqual([]);
    await click(button(container, "Save this view"));
    const form = $(container, ".save-view")!;
    expect(text(form)).toContain("Saves: Stage: Applied, Sorted by company.");
    expect(document.activeElement).toBe($(container, "input[name=view_name]"));
    await type($(container, "input[name=view_name]"), "Open applications");
    await click(button(container, "Save view"));
    await waitFor(() => chips(container).length === 1);
    expect(chips(container)).toEqual(["Open applications"]);
    expect($(container, ".save-view")).toBeNull();
    expect(await loadSavedViews(db)).toMatchObject([{ name: "Open applications", stage: "Applied", sort: "company", dir: "asc" }]);
    // the chip sits above the table
    const nav = $(container, "nav.view-chips")!;
    expect(nav.compareDocumentPosition($(container, "table.list")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("saves the filters as the form shows them, even before Apply filters", async () => {
    const db = await seed();
    const { container } = await mountPage(ApplicationsPage, db);
    await type($(container, "#f-q"), "acme");
    await type($(container, "#f-stage"), "Applied");
    await saveCurrent(container, "Acme applied");
    await waitFor(() => chips(container).length === 1);
    expect(await loadSavedViews(db)).toMatchObject([{ q: "acme", stage: "Applied" }]);
  });

  it("says there is nothing to save when the filters are cleared with the form open, and keeps the form open with the reason", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed(), "/?stage=Applied");
    await click(button(container, "Save this view"));
    await type($(container, "#f-stage"), "");
    // the form stays up (so it can be closed) even though there is now nothing to save
    expect(button(container, "Save this view")?.getAttribute("aria-expanded")).toBe("true");
    expect(text($(container, ".save-view"))).toContain("There are no filters to save yet");
    await type($(container, "input[name=view_name]"), "Nothing");
    await click(button(container, "Save view"));
    expect(text($(container, ".save-view [role=alert]"))).toContain("Choose a stage, search or other filter first");
    expect(chips(container)).toEqual([]);
  });

  it("refuses an empty name, a taken name and a 13th view, with the reason in an alert", async () => {
    const db = await seed();
    const { container } = await mountPage(ApplicationsPage, db, "/?stage=Applied");
    await click(button(container, "Save this view"));
    await submitForm($(container, ".save-view form"));
    expect(text($(container, ".save-view [role=alert]"))).toBe("Give the view a name.");
    await type($(container, "input[name=view_name]"), "Mine");
    await click(button(container, "Save view"));
    await waitFor(() => chips(container).length === 1);
    await saveCurrent(container, "mine");
    expect(text($(container, ".save-view [role=alert]"))).toContain("already have a view");
    await click(button(container, "Cancel"));
    for (let i = 1; i < SAVED_VIEWS_MAX; i++) await saveView(db, `View ${i}`, { stage: "Offer", q: `q${i}`, account: 0, followUp: false, ghosted: false, sort: "", dir: "" });
    await waitFor(() => chips(container).length === SAVED_VIEWS_MAX);
    await click(button(container, "Save this view"));
    expect(text($(container, ".save-view"))).toContain("You can keep 12 saved views");
    await type($(container, "input[name=view_name]"), "One too many");
    await click(button(container, "Save view"));
    expect(chips(container)).toHaveLength(SAVED_VIEWS_MAX);
  });

  it("closes with Escape or Cancel and keeps nothing", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed(), "/?stage=Applied");
    await click(button(container, "Save this view"));
    await key($(container, "input[name=view_name]"), "Escape");
    expect($(container, ".save-view")).toBeNull();
    await click(button(container, "Save this view"));
    await click(button(container, "Cancel"));
    expect($(container, ".save-view")).toBeNull();
    expect(chips(container)).toEqual([]);
  });
});

describe("closing the save form", () => {
  const trigger = (c: HTMLElement) => button(c, "Save this view")!;

  it("puts focus back on the Save this view button after Escape, Cancel and a save", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed(), "/?stage=Applied");
    await click(trigger(container));
    await key($(container, "input[name=view_name]"), "Escape");
    expect($(container, ".save-view")).toBeNull();
    expect(document.activeElement).toBe(trigger(container));
    await click(trigger(container));
    await click(button(container, "Cancel"));
    expect($(container, ".save-view")).toBeNull();
    expect(document.activeElement).toBe(trigger(container));
    await saveCurrent(container, "Mine");
    await waitFor(() => chips(container).includes("Mine"));
    expect($(container, ".save-view")).toBeNull();
    expect(document.activeElement).toBe(trigger(container));
  });
});

describe("using a view", () => {
  async function withViews() {
    const db = await seed();
    await saveView(db, "Interviews", { stage: "Interview", q: "", account: 0, followUp: false, ghosted: false, sort: "company", dir: "asc" });
    await saveView(db, "Stale applied", { stage: "Applied", q: "", account: 0, followUp: true, ghosted: false, sort: "", dir: "" });
    return db;
  }

  it("choosing a chip puts its filters in the address and marks it as current", async () => {
    const m = await mountPage(ApplicationsPage, await withViews());
    expect(chips(m.container)).toEqual(["Interviews", "Stale applied"]);
    expect(chip(m.container, "Interviews").getAttribute("href")).toBe("#/?stage=Interview&sort=company&dir=asc");
    await click(chip(m.container, "Interviews"));
    expect(m.location()).toBe("/?stage=Interview&sort=company&dir=asc");
    await waitFor(() => names(m.container).length === 1);
    expect(names(m.container)).toEqual(["Zeta"]);
    expect(chip(m.container, "Interviews").getAttribute("aria-current")).toBe("true");
    expect(chip(m.container, "Stale applied").getAttribute("aria-current")).toBeNull();
    expect(($(m.container, "#f-stage") as HTMLSelectElement).value).toBe("Interview");
  });

  it("is still the current chip after a row is opened, since opening is not a filter", async () => {
    const m = await mountPage(ApplicationsPage, await withViews(), "/?stage=Interview&sort=company&dir=asc");
    await click($(m.container, "a.expander"));
    expect(m.location()).toContain("open=");
    expect(chip(m.container, "Interviews").getAttribute("aria-current")).toBe("true");
  });

  it("has a tooltip that says what the view keeps", async () => {
    const { container } = await mountPage(ApplicationsPage, await withViews());
    expect(chip(container, "Stale applied").title).toBe("Stage: Applied, Needs follow-up");
  });

  it("leaves a chip alone for the browser when a modifier key is down", async () => {
    const m = await mountPage(ApplicationsPage, await withViews());
    const a = chip(m.container, "Interviews");
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(m.visited).toEqual([]);
  });
});

describe("renaming and deleting", () => {
  async function withOne() {
    const db = await seed();
    await saveView(db, "Interviews", { stage: "Interview", q: "", account: 0, followUp: false, ghosted: false, sort: "", dir: "" });
    return db;
  }
  const menu = (c: HTMLElement) => $(c, "button.view-chip-menu") as HTMLButtonElement;

  it("opens a small menu from the chip's options button, with the name ready to edit", async () => {
    const { container } = await mountPage(ApplicationsPage, await withOne());
    expect(menu(container).getAttribute("aria-label")).toBe("Options for Interviews");
    expect(menu(container).getAttribute("aria-expanded")).toBe("false");
    await click(menu(container));
    expect(menu(container).getAttribute("aria-expanded")).toBe("true");
    const input = $(container, ".view-options input[name=view_name]") as HTMLInputElement;
    expect(input.value).toBe("Interviews");
    expect(document.activeElement).toBe(input);
  });

  it("renames the view", async () => {
    const db = await withOne();
    const { container } = await mountPage(ApplicationsPage, db);
    await click(menu(container));
    await type($(container, ".view-options input[name=view_name]"), "Interview stage");
    await click(button(container, "Rename"));
    await waitFor(() => chips(container)[0] === "Interview stage");
    expect($(container, ".view-options")).toBeNull();
    expect(document.activeElement).toBe(menu(container));
    expect((await loadSavedViews(db))[0].name).toBe("Interview stage");
  });

  it("keeps the menu open with the reason when the new name is refused", async () => {
    const db = await withOne();
    await saveView(db, "Other", { stage: "Offer", q: "", account: 0, followUp: false, ghosted: false, sort: "", dir: "" });
    const { container } = await mountPage(ApplicationsPage, db);
    await click(menu(container));
    await type($(container, ".view-options input[name=view_name]"), "other");
    await click(button(container, "Rename"));
    expect(text($(container, ".view-options [role=alert]"))).toContain("already have a view");
    expect(chips(container)).toEqual(["Interviews", "Other"]);
  });

  it("asks before deleting, deletes on confirm, and Cancel keeps it", async () => {
    const db = await withOne();
    const { container } = await mountPage(ApplicationsPage, db);
    await click(menu(container));
    await click(button(container, "Delete view"));
    const ask = $(container, ".view-options .inline-confirm")!;
    expect(text($(ask, ".inline-confirm-q"))).toBe('Delete the view "Interviews"?');
    expect(document.activeElement).toBe(button(ask, "Cancel"));
    await click(button(ask, "Cancel"));
    expect($(container, ".view-options .inline-confirm")).toBeNull();
    expect(chips(container)).toEqual(["Interviews"]);
    await click(button(container, "Delete view"));
    await click(button($(container, ".inline-confirm")!, "Delete view"));
    await waitFor(() => chips(container).length === 0);
    expect(await loadSavedViews(db)).toEqual([]);
    expect($(container, "nav.view-chips")).toBeNull();
    expect(text($(container, ".view-chips-status"))).toBe('Deleted the view "Interviews".');
    // the applications themselves are untouched
    expect(await db.applications.count()).toBe(3);
  });

  it("puts focus on a neighbouring chip's options button after a delete, and on the status line after the last one", async () => {
    const db = await withOne();
    await saveView(db, "Applied ones", { stage: "Applied", q: "", account: 0, followUp: false, ghosted: false, sort: "", dir: "" });
    await saveView(db, "Offers", { stage: "Offer", q: "", account: 0, followUp: false, ghosted: false, sort: "", dir: "" });
    const { container } = await mountPage(ApplicationsPage, db);
    const menuOf = (name: string) => $(container, `button[aria-label='Options for ${name}']`) as HTMLButtonElement;
    const deleteIt = async (name: string) => {
      await click(menuOf(name));
      await click(button(container, "Delete view"));
      await click(button($(container, ".inline-confirm")!, "Delete view"));
    };
    // the middle one: the chip after it
    await deleteIt("Applied ones");
    expect(document.activeElement).toBe(menuOf("Offers"));
    await waitFor(() => !chips(container).includes("Applied ones"));
    expect(document.activeElement).toBe(menuOf("Offers"));
    expect(text($(container, ".view-chips-status"))).toBe('Deleted the view "Applied ones".');
    // the last one in the row: the chip before it
    await deleteIt("Offers");
    expect(document.activeElement).toBe(menuOf("Interviews"));
    await waitFor(() => chips(container).length === 1);
    // the only one left: the status line, which says so
    await deleteIt("Interviews");
    await waitFor(() => chips(container).length === 0);
    const status = $(container, ".view-chips-status") as HTMLElement;
    expect(status.getAttribute("role")).toBe("status");
    expect(text(status)).toBe('Deleted the view "Interviews".');
    expect(document.activeElement).toBe(status);
  });

  it("clears the deleted line when another menu is opened or a view is saved", async () => {
    const db = await withOne();
    await saveView(db, "Offers", { stage: "Offer", q: "", account: 0, followUp: false, ghosted: false, sort: "", dir: "" });
    const { container } = await mountPage(ApplicationsPage, db);
    await click($(container, "button[aria-label='Options for Offers']"));
    await click(button(container, "Delete view"));
    await click(button($(container, ".inline-confirm")!, "Delete view"));
    await waitFor(() => chips(container).length === 1);
    expect(text($(container, ".view-chips-status"))).toBe('Deleted the view "Offers".');
    await click(menu(container));
    expect(text($(container, ".view-chips-status"))).toBe("");
  });

  it("closes the menu with Escape and gives focus back to its button", async () => {
    const { container } = await mountPage(ApplicationsPage, await withOne());
    await click(menu(container));
    await key($(container, ".view-options input"), "Escape");
    expect($(container, ".view-options")).toBeNull();
    expect(document.activeElement).toBe(menu(container));
  });
});

describe("hostile names", () => {
  it("are shown as text and never as markup, in the chip, its label and its tooltip", async () => {
    const db = await seed();
    // a name that got into storage some other way (an import is cleaned, but the page must be safe regardless)
    await db.settings.put({ key: "savedViews", value: { views: [{ id: 1, name: '<img src=x onerror="alert(1)">', stage: "Applied" }] } });
    const { container } = await mountPage(ApplicationsPage, db);
    expect(chips(container)).toEqual(['<img src=x onerror="alert(1)">']);
    expect($(container, "nav.view-chips img")).toBeNull();
    expect($(container, "button.view-chip-menu")!.getAttribute("aria-label")).toBe('Options for <img src=x onerror="alert(1)">');
    await click($(container, "button.view-chip-menu"));
    expect($(container, ".view-options img")).toBeNull();
    expect(($(container, ".view-options input") as HTMLInputElement).value).toBe('<img src=x onerror="alert(1)">');
  });

  it("can be typed in the save form and are kept as text", async () => {
    const db = await seed();
    const { container } = await mountPage(ApplicationsPage, db, "/?stage=Applied");
    await saveCurrent(container, "<b>bold</b>");
    await waitFor(() => chips(container).length === 1);
    expect(chips(container)).toEqual(["<b>bold</b>"]);
    expect($(container, "nav.view-chips b")).toBeNull();
  });
});

describe("storage", () => {
  it("keeps views per account database", async () => {
    const db = await seed();
    await saveView(db, "Kept", { stage: "Applied", q: "", account: 0, followUp: false, ghosted: false, sort: "", dir: "" });
    const first = await mountPage(ApplicationsPage, db);
    expect(chips(first.container)).toEqual(["Kept"]);
    await cleanup();
    const other = await mountPage(ApplicationsPage, freshDb());
    expect(chips(other.container)).toEqual([]);
  });
});

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { $, $$, addApp, addMail, button, cleanup, click, freshDb, mountPage, seedThree, settle, text, type, waitFor } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";
import { loadSavedViews } from "../../../src/sync/savedViews";

afterEach(cleanup);

const press = async (key: string) => {
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
  await settle(0);
};

describe("the page header: title row, one filter row, one status row", () => {
  it("puts Add application on the title row, outside the filter card, and it opens the form with focus in Company", async () => {
    const db = freshDb();
    await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db);
    const head = $(container, ".page-head")!;
    expect(head.querySelector("h1")?.textContent).toBe("Applications");
    const add = button(head, "Add application")!;
    expect(add).not.toBeNull();
    expect(add.classList.contains("primary")).toBe(false);
    expect(button($(container, "form.filters")!, "Add application")).toBeNull();
    // the view toggle shares the title row
    expect($(head, "nav[aria-label=View]")).not.toBeNull();
    await click(add);
    await waitFor(() => $(container, "#add-application") !== null);
    expect(document.activeElement).toBe($(container, "#add-company"));
    expect(add.getAttribute("aria-expanded")).toBe("true");
    // one primary per surface: Save application takes it from Apply filters
    expect(button(container, "Apply filters")!.classList.contains("primary")).toBe(false);
    expect(button(container, "Save application")!.classList.contains("primary")).toBe(true);
  });

  it("keeps the shortcuts: n opens the form, / focuses the search box", async () => {
    const db = freshDb();
    await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db);
    await press("/");
    expect(document.activeElement).toBe($(container, "#f-q"));
    (document.activeElement as HTMLElement).blur();
    await press("n");
    await waitFor(() => $(container, "#add-application") !== null);
    expect(document.activeElement).toBe($(container, "#add-company"));
  });

  it("holds every filter in one card, with the two checkboxes grouped under 'Show'", async () => {
    const db = freshDb();
    await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db);
    const form = $(container, "form.filters")!;
    const group = $(form, "fieldset.show-group")!;
    expect(text($(group, "legend"))).toBe("Show");
    expect($$(group, "input[type=checkbox]").map((c) => (c as HTMLInputElement).labels?.[0]?.textContent?.trim())).toEqual(["Needs follow-up", "No reply"]);
    expect($(form, "#f-q")).not.toBeNull();
    expect($(form, "#f-stage")).not.toBeNull();
    expect(button(form, "Apply filters")!.classList.contains("primary")).toBe(true);
    expect($$(form, "button").map((b) => text(b))).toEqual(["Apply filters"]);
  });

  it("shows Save this view only when the filters or the sort differ from the plain list", async () => {
    const db = freshDb();
    await seedThree(db);
    const plain = await mountPage(ApplicationsPage, db);
    expect(button(plain.container, "Save this view")).toBeNull();
    // what the form shows counts, before Apply filters
    await type($(plain.container, "#f-q"), "acme");
    expect(button(plain.container, "Save this view")).not.toBeNull();
    await type($(plain.container, "#f-q"), "");
    expect(button(plain.container, "Save this view")).toBeNull();
    await cleanup();
    const sorted = await mountPage(ApplicationsPage, freshDb(), "/?sort=company&dir=asc");
    expect(button(sorted.container, "Save this view")).not.toBeNull();
  });

  it("still saves a view from the status row, and the chip appears", async () => {
    const db = freshDb();
    await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db, "/?stage=Applied");
    const trigger = button($(container, ".status-row")!, "Save this view")!;
    expect(trigger.getAttribute("aria-controls")).toBe("save-view");
    await click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await type($(container, "input[name=view_name]"), "Applied only");
    await click(button(container, "Save view"));
    await waitFor(() => $$(container, ".view-chip-link").length === 1);
    expect(await loadSavedViews(db)).toMatchObject([{ name: "Applied only", stage: "Applied" }]);
  });

  it("merges the count and the weekly goal into one status row, with the review banner above the list", async () => {
    const db = freshDb();
    const { account } = await seedThree(db);
    await addMail(db, account, null, { review: true });
    const { container } = await mountPage(ApplicationsPage, db);
    const row = $(container, ".status-row")!;
    expect(text($(row, ".result-line"))).toContain("Showing 3 applications");
    const review = $(container, ".review-banner")!;
    expect(text($(review, "p"))).toBe("1 email needs a look");
    expect($(review, "a")!.getAttribute("href")).toBe("#/review");
    expect(button(row, "Set a weekly goal")).not.toBeNull();
    // there is no longer a bordered notice for it
    expect($(container, ".notice")).toBeNull();
  });

  it("has no review link when nothing is waiting", async () => {
    const db = freshDb();
    await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db);
    expect($(container, ".review-banner")).toBeNull();
  });

  it("keeps the weekly goal working from the status row, and gives its form the full row", async () => {
    const db = freshDb();
    await addApp(db, "Today", { applied: 0, last: 0 });
    const { container } = await mountPage(ApplicationsPage, db);
    const row = $(container, ".status-row")!;
    await click(button(row, "Set a weekly goal"));
    expect($(row, ".weekly-goal")!.classList.contains("is-editing")).toBe(true);
    await type($(row, "input[name=weekly_goal]"), "4");
    await click(button(row, "Save goal"));
    await waitFor(() => $(row, "[role=progressbar]") !== null);
    expect($(row, ".weekly-goal")!.classList.contains("is-editing")).toBe(false);
    expect(text($(row, ".weekly-goal-line"))).toContain("of 4 applications");
    expect(button(row, "Change goal")).not.toBeNull();
  });
});

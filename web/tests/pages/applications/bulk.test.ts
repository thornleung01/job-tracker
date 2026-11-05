import { afterEach, describe, expect, it, vi } from "vitest";
import { $, $$, addApp, addMail, button, cleanup, click, freshDb, key, mountPage, submitForm, text, type, waitFor } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";
import { upsertAccount } from "../../../src/db/repo";
import type { JobTrackerDB } from "../../../src/db/schema";

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup();
});

const box = (c: HTMLElement, company: string) => $(c, `input[aria-label='Select ${company}']`) as HTMLInputElement;
const header = (c: HTMLElement) => $(c, "th input[aria-label='Select all']") as HTMLInputElement;
const bar = (c: HTMLElement) => $(c, ".bulk-bar");
const row = (c: HTMLElement, company: string) => $$(c, "tr.app-row").find((r) => text(r).includes(company)) as HTMLElement;

async function seed(db: JobTrackerDB) {
  const account = await upsertAccount(db, "gmail", "me@gmail.com");
  const acme = await addApp(db, "Acme", { stage: "Applied", last: 1 });
  const beta = await addApp(db, "Beta", { stage: "Applied", last: 2 });
  const gamma = await addApp(db, "Gamma", { stage: "Rejected", last: 3 });
  const mail = await addMail(db, account, acme);
  return { acme, beta, gamma, mail };
}

describe("selecting applications in the list", () => {
  it("puts a labelled checkbox in every row and in the header, and no bar until something is ticked", async () => {
    const db = freshDb();
    await seed(db);
    const { container } = await mountPage(ApplicationsPage, db);
    expect($$(container, "tbody input[type=checkbox]").map((i) => i.getAttribute("aria-label"))).toEqual(["Select Acme", "Select Beta", "Select Gamma"]);
    expect(header(container)).not.toBeNull();
    expect(bar(container)).toBeNull();
  });

  it("shows how many are selected, and a tick never opens the row", async () => {
    const db = freshDb();
    await seed(db);
    const { container, visited } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    expect(text($(container, ".bulk-count"))).toBe("1 selected");
    expect(box(container, "Acme").checked).toBe(true);
    expect(row(container, "Acme").className).toContain("is-selected");
    expect(visited).toEqual([]);
    expect($(container, "tr.panel-row:not([hidden])")).toBeNull();
    await click(box(container, "Beta"));
    expect(text($(container, ".bulk-count"))).toBe("2 selected");
    await click(box(container, "Acme"));
    expect(text($(container, ".bulk-count"))).toBe("1 selected");
  });

  it("still opens a row from its empty space", async () => {
    const db = freshDb();
    await seed(db);
    const { container } = await mountPage(ApplicationsPage, db);
    await click($(row(container, "Acme"), "td[data-col=last_activity]"));
    await waitFor(() => $(container, "tr.panel-row:not([hidden])") !== null, "the panel to open");
    expect(bar(container)).toBeNull();
  });

  it("selects all rows from the header, with a dash while only some are selected", async () => {
    const db = freshDb();
    await seed(db);
    const { container } = await mountPage(ApplicationsPage, db);
    expect(header(container).indeterminate).toBe(false);
    await click(box(container, "Beta"));
    expect([header(container).checked, header(container).indeterminate]).toEqual([false, true]);
    await click(header(container));
    expect(text($(container, ".bulk-count"))).toBe("3 selected");
    expect([header(container).checked, header(container).indeterminate]).toEqual([true, false]);
    await click(header(container));
    expect(bar(container)).toBeNull();
    expect([header(container).checked, header(container).indeterminate]).toEqual([false, false]);
  });

  it("clears the selection from Clear selection and returns focus to the header box", async () => {
    const db = freshDb();
    await seed(db);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    await click(button(container, "Clear selection"));
    expect(bar(container)).toBeNull();
    expect(box(container, "Acme").checked).toBe(false);
    expect(document.activeElement).toBe(header(container));
  });

  it("clears the selection when the filters change", async () => {
    const db = freshDb();
    await seed(db);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    expect(bar(container)).not.toBeNull();
    await type($(container, "#f-stage"), "Rejected");
    await submitForm($(container, "form.filters"));
    await waitFor(() => bar(container) === null, "the bar to go");
    expect($$(container, "tbody input[type=checkbox]").map((i) => i.getAttribute("aria-label"))).toEqual(["Select Gamma"]);
    expect(box(container, "Gamma").checked).toBe(false);
  });
});

describe("the bulk bar", () => {
  it("sets the stage on every selected application and locks them", async () => {
    const db = freshDb();
    const { acme, beta, gamma } = await seed(db);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    await click(box(container, "Beta"));
    const setStage = button(container, "Set stage") as HTMLButtonElement;
    expect(setStage.disabled).toBe(true);
    await type($(container, "select[aria-label='Stage for selected applications']"), "Interview");
    expect(setStage.disabled).toBe(false);
    await click(setStage);
    await waitFor(() => bar(container) === null, "the bar to go");
    const stages = await Promise.all([acme, beta, gamma].map(async (id) => { const a = await db.applications.get(id); return [a?.stage, a?.locked]; }));
    expect(stages).toEqual([["Interview", true], ["Interview", true], ["Rejected", false]]);
    expect(text($(container, ".notice"))).toBe("2 applications set to Interview.");
    expect(box(container, "Acme").checked).toBe(false);
    expect(document.activeElement).toBe($(container, ".notice"));
  });

  it("asks in place before deleting, and Cancel and Escape change nothing", async () => {
    const db = freshDb();
    await seed(db);
    const confirm = vi.spyOn(window, "confirm");
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    await click(box(container, "Beta"));
    await click(button(container, "Delete"));
    const ask = $(container, ".bulk-confirm[role=group]")!;
    expect(text($(ask, "#h-bulk-delete"))).toBe("Delete 2 applications?");
    expect(button(container, "Delete")?.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(button(ask, "Delete 2 applications and their emails"));
    expect(await db.applications.count()).toBe(3);
    await click(button(ask, "Cancel"));
    expect($(container, ".bulk-confirm")).toBeNull();
    expect(document.activeElement).toBe(button(container, "Delete"));
    await click(button(container, "Delete"));
    await key($(container, ".bulk-confirm button"), "Escape");
    expect($(container, ".bulk-confirm")).toBeNull();
    expect(await db.applications.count()).toBe(3);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("deletes the selected applications and their emails once confirmed", async () => {
    const db = freshDb();
    const { acme, beta, gamma, mail } = await seed(db);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    await click(box(container, "Beta"));
    await click(button(container, "Delete"));
    await click(button(container, "Delete 2 applications and their emails"));
    await waitFor(() => $$(container, "tr.app-row").length === 1, "the rows to go");
    expect((await db.applications.toArray()).map((a) => a.id)).toEqual([gamma]);
    expect(await db.applications.get(acme)).toBeUndefined();
    expect(await db.applications.get(beta)).toBeUndefined();
    const cleared = await db.emails.get(mail);
    expect([cleared?.applicationId, cleared?.subject]).toEqual([null, null]);
    expect(text($(container, ".notice"))).toBe("Deleted 2 applications.");
    expect(bar(container)).toBeNull();
  });

  it("lets the selection grow while the question is open, and closes it when nothing is selected", async () => {
    const db = freshDb();
    await seed(db);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    await click(button(container, "Delete"));
    await click(box(container, "Beta"));
    expect(text($(container, "#h-bulk-delete"))).toBe("Delete 2 applications?");
    await click(box(container, "Acme"));
    await click(box(container, "Beta"));
    expect($(container, ".bulk-confirm")).toBeNull();
    await click(box(container, "Acme"));
    expect($(container, ".bulk-confirm")).toBeNull();
  });
});

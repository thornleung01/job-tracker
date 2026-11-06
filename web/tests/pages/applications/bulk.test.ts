import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { $, $$, addApp, addMail, button, cleanup, click, freshDb, key, mountPage, settle, submitForm, text, type, waitFor } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";
import { upsertAccount } from "../../../src/db/repo";
import type { JobTrackerDB } from "../../../src/db/schema";

// Undo stays on screen for 8 s. The test that waits for it to go shortens it, and the others keep the real length.
const undo = vi.hoisted(() => ({ ms: 8000 }));
vi.mock("../../../src/components/undo", () => ({ get UNDO_MS() { return undo.ms; } }));

afterEach(async () => {
  undo.ms = 8000;
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanup();
});

const box = (c: HTMLElement, company: string) => $(c, `input[aria-label='Select ${company}']`) as HTMLInputElement;
const header = (c: HTMLElement) => $(c, "th input[aria-label='Select all']") as HTMLInputElement;
const bar = (c: HTMLElement) => $(c, ".bulk-bar");
const apply = async (c: HTMLElement) => {
  await submitForm($(c, "form.filters"));
  await settle();
};
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
    const ask = $(container, ".inline-confirm[role=group]")!;
    expect(text($(ask, ".inline-confirm-q"))).toBe("Delete 2 applications?");
    expect(button(container, "Delete")?.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(button(ask, "Cancel"));
    expect(button(container, "Delete")?.getAttribute("aria-controls")).toBe(ask.id);
    expect(await db.applications.count()).toBe(3);
    await click(button(ask, "Cancel"));
    expect($(container, ".inline-confirm")).toBeNull();
    expect(document.activeElement).toBe(button(container, "Delete"));
    await click(button(container, "Delete"));
    await key($(container, ".inline-confirm button"), "Escape");
    expect($(container, ".inline-confirm")).toBeNull();
    expect(await db.applications.count()).toBe(3);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("deletes the selected applications to Recently deleted once confirmed, keeping their emails, with Restore for a few seconds", async () => {
    const db = freshDb();
    const { acme, beta, gamma, mail } = await seed(db);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    await click(box(container, "Beta"));
    await click(button(container, "Delete"));
    expect(text($(container, ".inline-confirm-q"))).toBe("Delete 2 applications?");
    expect(text($(container, ".inline-confirm .help"))).toBe("You can restore them for 30 days.");
    await click(button(container, "Delete 2 applications"));
    await waitFor(() => $$(container, "tr.app-row").length === 1, "the rows to go");
    expect((await db.applications.toArray()).filter((a) => !a.deletedAt).map((a) => a.id)).toEqual([gamma]);
    expect((await db.applications.get(acme))?.deletedAt).toBeDefined();
    expect((await db.applications.get(beta))?.deletedAt).toBeDefined();
    const kept = await db.emails.get(mail);
    expect([kept?.applicationId, kept?.subject]).toEqual([acme, "We got your application"]);
    expect(text($(container, ".notice"))).toBe("Deleted 2 applications. They stay in Recently deleted for 30 days.");
    expect(bar(container)).toBeNull();
  });

  it("brings them back, with their emails, when you choose Restore", async () => {
    const db = freshDb();
    const { acme, beta, mail } = await seed(db);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    await click(box(container, "Beta"));
    await click(button(container, "Delete"));
    await click(button(container, "Delete 2 applications"));
    await waitFor(() => button(container, "Restore") !== null, "Restore");
    expect(button(container, "Undo")).toBeNull();
    await click(button(container, "Restore"));
    await waitFor(() => $$(container, "tr.app-row").length === 3, "the rows to come back");
    expect(text($(container, ".notice"))).toBe("Restored 2 applications.");
    expect(button(container, "Restore")).toBeNull();
    expect((await db.applications.get(acme))).not.toHaveProperty("deletedAt");
    expect((await db.applications.get(beta))).not.toHaveProperty("deletedAt");
    expect((await db.emails.get(mail))?.applicationId).toBe(acme);
  });

  it("takes Restore away after 8 seconds, leaving the sentence", async () => {
    undo.ms = 150;
    const db = freshDb();
    await seed(db);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    await click(button(container, "Delete"));
    await click(button(container, "Delete 1 application"));
    await waitFor(() => button(container, "Restore") !== null, "Restore");
    await waitFor(() => button(container, "Restore") === null, "Restore to go");
    expect(text($(container, ".notice"))).toBe("Deleted 1 application. It stays in Recently deleted for 30 days.");
  });

  it("lets the selection grow while the question is open, and closes it when nothing is selected", async () => {
    const db = freshDb();
    await seed(db);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    await click(button(container, "Delete"));
    await click(box(container, "Beta"));
    expect(text($(container, ".inline-confirm-q"))).toBe("Delete 2 applications?");
    await click(box(container, "Acme"));
    await click(box(container, "Beta"));
    expect($(container, ".inline-confirm")).toBeNull();
    await click(box(container, "Acme"));
    expect($(container, ".inline-confirm")).toBeNull();
  });
});

describe("a selection that goes stale", () => {
  it("doesn't bring a ticked row back when Needs follow-up is turned on and off", async () => {
    const db = freshDb();
    await addApp(db, "Quiet", { stage: "Applied", last: 8 });
    await addApp(db, "Fresh", { stage: "Applied", last: 2 });
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Fresh"));
    expect(bar(container)).not.toBeNull();
    await click($(container, "#f-followup"));
    await apply(container);
    await waitFor(() => $$(container, "tr.app-row").length === 1, "Fresh to hide");
    expect(bar(container)).toBeNull();
    await click($(container, "#f-followup"));
    await apply(container);
    await waitFor(() => $$(container, "tr.app-row").length === 2, "Fresh to return");
    expect(box(container, "Fresh").checked).toBe(false);
    expect(bar(container)).toBeNull();
    expect(header(container).indeterminate).toBe(false);
  });

  it("does the same when the search changes and changes back", async () => {
    const db = freshDb();
    await addApp(db, "Acme");
    await addApp(db, "Beta");
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Beta"));
    await type($(container, "#f-q"), "Acme");
    await apply(container);
    await waitFor(() => $$(container, "tr.app-row").length === 1, "the search to apply");
    await type($(container, "#f-q"), "");
    await apply(container);
    await waitFor(() => $$(container, "tr.app-row").length === 2, "the list to return");
    expect(box(container, "Beta").checked).toBe(false);
    expect(bar(container)).toBeNull();
  });

  it("does the same when the account changes and changes back", async () => {
    const db = freshDb();
    const one = await upsertAccount(db, "gmail", "one@gmail.com");
    const two = await upsertAccount(db, "gmail", "two@outlook.com");
    await addMail(db, one, await addApp(db, "Acme"));
    await addMail(db, two, await addApp(db, "Beta"));
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Beta"));
    await type($(container, "#f-account"), String(one));
    await apply(container);
    await waitFor(() => $$(container, "tr.app-row").length === 1, "the account to apply");
    await type($(container, "#f-account"), "0");
    await apply(container);
    await waitFor(() => $$(container, "tr.app-row").length === 2, "the list to return");
    expect(box(container, "Beta").checked).toBe(false);
    expect(bar(container)).toBeNull();
  });

  it("drops an application deleted from outside out of the count", async () => {
    const db = freshDb();
    const { acme } = await seed(db);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    await click(box(container, "Beta"));
    expect(text($(container, ".bulk-count"))).toBe("2 selected");
    await db.applications.delete(acme);
    await waitFor(() => text($(container, ".bulk-count")) === "1 selected", "the count to drop");
    expect(header(container).indeterminate).toBe(true);
  });

  it("clears the last result when the filters change", async () => {
    const db = freshDb();
    await seed(db);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    await type($(container, "select[aria-label='Stage for selected applications']"), "Interview");
    await click(button(container, "Set stage"));
    await waitFor(() => $(container, ".bulk-done") !== null, "the result");
    await type($(container, "#f-stage"), "Rejected");
    await apply(container);
    await waitFor(() => $(container, ".bulk-done") === null, "the result to go");
  });
});

describe("selecting more than the most one action takes", () => {
  async function many(db: JobTrackerDB, count: number) {
    const seeded = await addApp(db, "Row 0000");
    const { id: _id, ...rest } = (await db.applications.get(seeded))!;
    await db.applications.bulkAdd(Array.from({ length: count - 1 }, (_, i) => ({ ...rest, company: `Row ${String(i + 1).padStart(4, "0")}`, companyKey: `row${i + 1}` })) as never);
  }

  it("selects the first 500 from the header, says so, and then lets the action through", async () => {
    const db = freshDb();
    await many(db, 501);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(header(container));
    expect(text($(container, ".bulk-count"))).toBe("500 selected, the most you can change at once");
    expect([header(container).checked, header(container).indeterminate]).toEqual([false, true]);
    await type($(container, "select[aria-label='Stage for selected applications']"), "Interview");
    await click(button(container, "Set stage"));
    await waitFor(() => $(container, ".bulk-done") !== null, "the result");
    expect(text($(container, ".bulk-done .notice"))).toBe("500 applications set to Interview.");
    expect(await db.applications.where("stage").equals("Interview").count()).toBe(500);
  });

  it("stops ticking single rows at the most, and a second header click clears", async () => {
    const db = freshDb();
    await many(db, 501);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(header(container));
    const unticked = $$(container, "tbody input[type=checkbox]").find((i) => !(i as HTMLInputElement).checked) as HTMLInputElement;
    await click(unticked);
    expect(text($(container, ".bulk-count"))).toBe("500 selected, the most you can change at once");
    expect(unticked.checked).toBe(false);
    await click(header(container));
    expect(bar(container)).toBeNull();
  });
});

describe("the delete question", () => {
  it("ignores Escape while a delete is running, then lets the result through", async () => {
    const db = freshDb();
    await seed(db);
    // The database holds the delete back until we let go, then does it for real.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const realTransaction = db.transaction.bind(db) as (...args: unknown[]) => Promise<unknown>;
    vi.spyOn(db, "transaction").mockImplementation(((...args: unknown[]) => held.then(() => realTransaction(...args))) as never);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    await click(button(container, "Delete"));
    await click(button(container, "Delete 1 application"));
    expect((button(container, "Cancel") as HTMLButtonElement).disabled).toBe(true);
    await key($(container, ".inline-confirm button"), "Escape");
    expect($(container, ".inline-confirm")).not.toBeNull();
    await act(async () => release());
    await waitFor(() => bar(container) === null, "the bar to go");
    expect(text($(container, ".notice"))).toBe("Deleted 1 application. It stays in Recently deleted for 30 days.");
    expect((await db.applications.toArray()).filter((a) => !a.deletedAt)).toHaveLength(2);
  });

  it("puts focus back on the Delete button after a failed delete", async () => {
    const db = freshDb();
    await seed(db);
    vi.spyOn(db, "transaction").mockRejectedValue(new Error("disk full"));
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    await click(button(container, "Delete"));
    const confirmDelete = button(container, "Delete 1 application")!;
    await click(confirmDelete);
    await waitFor(() => $(container, ".bulk-bar .notice.err") !== null, "the error");
    expect(text($(container, ".bulk-bar .notice.err"))).toBe("Couldn't finish that. Try again.");
    expect(document.activeElement).toBe(confirmDelete);
    expect($(container, ".inline-confirm")).not.toBeNull();
  });

  it("puts focus back on Set stage after a failed change", async () => {
    const db = freshDb();
    await seed(db);
    const where = db.applications.where.bind(db.applications) as (...a: unknown[]) => unknown;
    vi.spyOn(db.applications, "where").mockImplementation(((...args: unknown[]) => {
      if (args[0] === ":id") throw new Error("disk full");
      return where(...args);
    }) as never);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    await type($(container, "select[aria-label='Stage for selected applications']"), "Interview");
    const setStage = button(container, "Set stage")!;
    await click(setStage);
    await waitFor(() => $(container, ".bulk-bar .notice.err") !== null, "the error");
    expect(document.activeElement).toBe(setStage);
    expect((await db.applications.toArray()).map((a) => a.stage)).toEqual(["Applied", "Applied", "Rejected"]);
  });
});

describe("Undo after a bulk stage change", () => {
  async function setAcmeAndBeta(db: JobTrackerDB) {
    const { container } = await mountPage(ApplicationsPage, db);
    await click(box(container, "Acme"));
    await click(box(container, "Beta"));
    await type($(container, "select[aria-label='Stage for selected applications']"), "Interview");
    await click(button(container, "Set stage"));
    await waitFor(() => button(container, "Undo") !== null, "Undo");
    return container;
  }

  it("puts back each stage and whether it was locked", async () => {
    const db = freshDb();
    const { acme, beta } = await seed(db);
    await db.applications.update(beta, { locked: true, stageAt: "2026-01-01T00:00:00Z" });
    const before = await Promise.all([acme, beta].map((id) => db.applications.get(id)));
    const container = await setAcmeAndBeta(db);
    expect((await db.applications.get(acme))?.stage).toBe("Interview");
    await click(button(container, "Undo"));
    await waitFor(() => text($(container, ".notice")) === "Put 2 applications back.", "the undo to finish");
    const after = await Promise.all([acme, beta].map((id) => db.applications.get(id)));
    expect(after.map((a) => [a?.stage, a?.stageAt, a?.locked])).toEqual(before.map((a) => [a?.stage, a?.stageAt, a?.locked]));
    expect(after.map((a) => a?.locked)).toEqual([false, true]);
    expect(button(container, "Undo")).toBeNull();
  });

  it("goes away when its time is up, leaving the result line", async () => {
    const db = freshDb();
    await seed(db);
    undo.ms = 150;
    const container = await setAcmeAndBeta(db);
    await waitFor(() => button(container, "Undo") === null, "Undo to go");
    expect(text($(container, ".notice"))).toBe("2 applications set to Interview.");
  });

  it("goes when something new is ticked, and isn't offered after a delete", async () => {
    const db = freshDb();
    await seed(db);
    const container = await setAcmeAndBeta(db);
    await click(box(container, "Gamma"));
    expect(button(container, "Undo")).toBeNull();
    expect($(container, ".bulk-done")).toBeNull();
    await click(button(container, "Delete"));
    await click(button(container, "Delete 1 application"));
    await waitFor(() => text($(container, ".notice")).startsWith("Deleted 1 application."), "the delete");
    expect(button(container, "Undo")).toBeNull();
  });
});

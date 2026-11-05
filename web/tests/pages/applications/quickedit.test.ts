import { afterEach, describe, expect, it } from "vitest";
import { $, addApp, cleanup, click, freshDb, key, mountPage, text, type, waitFor } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";
import { localToday } from "../../../src/db/time";

afterEach(cleanup);

const row = (container: HTMLElement, company: string) =>
  [...container.querySelectorAll("tr.app-row")].find((r) => text(r).includes(company)) as HTMLElement;

describe("quick edits in the list", () => {
  it("renames the role in place: Enter saves, and the application becomes yours", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { role: "Analyst" });
    const { container } = await mountPage(ApplicationsPage, db);
    await click($(row(container, "Acme"), "button.quick-text[aria-label$='edit role for Acme']"));
    const field = $(row(container, "Acme"), "input[aria-label='Role for Acme']") as HTMLInputElement;
    expect(field.value).toBe("Analyst");
    await type(field, "Senior Analyst");
    await key(field, "Enter");
    await waitFor(() => text($(row(container, "Acme"), "[data-col=role]")) === "Senior Analyst");
    const saved = await db.applications.get(id);
    expect([saved?.role, saved?.manual]).toEqual(["Senior Analyst", true]);
  });

  it("puts the role back on Escape and writes nothing", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { role: "Analyst" });
    const { container } = await mountPage(ApplicationsPage, db);
    await click($(row(container, "Acme"), "button.quick-text[aria-label$='edit role for Acme']"));
    const field = $(row(container, "Acme"), "input[aria-label='Role for Acme']") as HTMLInputElement;
    await type(field, "Something else");
    await key(field, "Escape");
    await waitFor(() => $(row(container, "Acme"), "input[aria-label='Role for Acme']") === null);
    expect(text($(row(container, "Acme"), "[data-col=role]"))).toBe("Analyst");
    expect((await db.applications.get(id))?.manual).toBe(false);
  });

  it("changes the stage from the dropdown and locks it", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { stage: "Applied" });
    const { container } = await mountPage(ApplicationsPage, db);
    await type($(row(container, "Acme"), "select[aria-label='Stage for Acme']"), "Interview");
    await waitFor(() => text(row(container, "Acme")).includes("set by you"));
    const saved = await db.applications.get(id);
    expect([saved?.stage, saved?.locked]).toEqual(["Interview", true]);
    expect($(row(container, "Acme"), ".badge")?.className).toContain("Interview");
  });

  it("changes the applied date and refuses a day in the future", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { applied: 20 });
    const { container } = await mountPage(ApplicationsPage, db);
    await click($(row(container, "Acme"), "button[aria-label$='edit applied date for Acme']"));
    const field = $(row(container, "Acme"), "input[aria-label='Applied date for Acme']") as HTMLInputElement;
    expect(field.max).toBe(localToday());
    await type(field, "2026-01-15");
    expect((await db.applications.get(id))?.appliedAt?.slice(0, 10)).not.toBe("2026-01-15");   // typing alone saves nothing
    await key(field, "Enter");
    await waitFor(() => ($(row(container, "Acme"), "input[type=date]")) === null);
    expect(document.activeElement?.getAttribute("aria-label")).toContain("edit applied date for Acme");
    expect((await db.applications.get(id))?.appliedAt?.slice(0, 10)).toBe("2026-01-15");
    expect(text($(row(container, "Acme"), "[data-col=applied]"))).toContain("Jan 15");
  });

  it("keeps the focus on the role after Enter, and names the button with the words it shows", async () => {
    const db = freshDb();
    await addApp(db, "Acme", { role: "Analyst" });
    const { container } = await mountPage(ApplicationsPage, db);
    const trigger = $(row(container, "Acme"), "button.quick-text")!;
    expect(trigger.getAttribute("aria-label")).toBe("Analyst, edit role for Acme");
    await click(trigger);
    const field = $(row(container, "Acme"), "input[aria-label='Role for Acme']") as HTMLInputElement;
    await type(field, "Lead Analyst");
    await key(field, "Enter");
    await waitFor(() => document.activeElement?.getAttribute("aria-label") === "Lead Analyst, edit role for Acme");
  });

  it("offers Undo after a stage change and puts back the stage and the lock", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { stage: "Applied" });
    const before = await db.applications.get(id);
    const { container } = await mountPage(ApplicationsPage, db);
    await type($(row(container, "Acme"), "select[aria-label='Stage for Acme']"), "Offer");
    await waitFor(() => $(row(container, "Acme"), ".quick-undo") !== null);
    expect((await db.applications.get(id))?.stage).toBe("Offer");
    await click($(row(container, "Acme"), ".quick-undo"));
    await waitFor(() => $(row(container, "Acme"), ".quick-undo") === null);
    const after = await db.applications.get(id);
    expect([after?.stage, after?.stageAt, after?.locked]).toEqual([before?.stage, before?.stageAt, before?.locked]);
    expect(text(row(container, "Acme"))).not.toContain("set by you");
  });

  it("keeps the stage select focused after a change", async () => {
    const db = freshDb();
    await addApp(db, "Acme", { stage: "Applied" });
    const { container } = await mountPage(ApplicationsPage, db);
    const select = $(row(container, "Acme"), "select[aria-label='Stage for Acme']") as HTMLSelectElement;
    select.focus();
    await type(select, "Offer");
    await waitFor(() => text(row(container, "Acme")).includes("set by you"));
    expect(document.activeElement).toBe(select);
  });

  it("opening the row is still possible from empty space, and editing does not toggle it", async () => {
    const db = freshDb();
    await addApp(db, "Acme", { role: "Analyst" });
    const { container } = await mountPage(ApplicationsPage, db);
    await click($(row(container, "Acme"), "button.quick-text[aria-label$='edit role for Acme']"));
    expect($(container, "tr.panel-row:not([hidden])")).toBeNull();
  });
});

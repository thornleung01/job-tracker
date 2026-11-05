import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { $, addApp, button, cleanup, click, freshDb, mountPage, submitForm, text, type, waitFor } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";
import { DUPLICATES_DEBOUNCE_MS } from "../../../src/components/duplicates/useDuplicates";
import type { JobTrackerDB } from "../../../src/db/schema";
import { sleep } from "../../support/helpers";

/** Lets the debounce run out inside act, so the notice (or its absence) is what the page settles on. */
const pause = () => act(async () => { await sleep(DUPLICATES_DEBOUNCE_MS + 150); });

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup();
});

async function openForm(db: JobTrackerDB) {
  const { container } = await mountPage(ApplicationsPage, db);
  await click(button(container, "Add application"));
  return container;
}
const note = (c: HTMLElement) => $(c, "#add-application .dup-note");
const noteShown = (c: HTMLElement) => waitFor(() => note(c) !== null, "the duplicate notice");

describe("the duplicate notice in the add form", () => {
  it("names the match, links to it, and still saves", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { role: "Analyst", stage: "Applied" });
    const c = await openForm(db);
    expect(note(c)).toBeNull();
    await type($(c, "#add-company"), "acme inc.");
    await type($(c, "#add-role"), "analyst");
    await noteShown(c);
    expect(text(note(c))).toBe("You already have Acme · Analyst (Applied). Add it anyway?");
    expect($(note(c)!, "a")?.getAttribute("href")).toBe(`#/app/${id}`);
    expect(note(c)?.getAttribute("role")).toBe("status");
    const save = button(c, "Save application") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await submitForm($(c, "#add-application form"));
    expect(await db.applications.count()).toBe(2);
  });

  it("stays quiet for a different role, and goes away when the fields stop matching", async () => {
    const db = freshDb();
    await addApp(db, "Acme", { role: "Analyst" });
    const c = await openForm(db);
    await type($(c, "#add-company"), "Acme");
    await type($(c, "#add-role"), "Designer");
    await pause();
    expect(note(c)).toBeNull();
    await type($(c, "#add-role"), "Analyst");
    await noteShown(c);
    await type($(c, "#add-company"), "Beta");
    await waitFor(() => note(c) === null, "the notice to go");
  });

  it("matches on the company alone while the role is empty", async () => {
    const db = freshDb();
    await addApp(db, "Acme", { role: "Analyst", stage: "Rejected" });
    const c = await openForm(db);
    await type($(c, "#add-company"), "Acme");
    await noteShown(c);
    expect(text(note(c))).toBe("You already have Acme · Analyst (Rejected). Add it anyway?");
  });

  it("notices a posting link you already saved", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { role: "Analyst" });
    await db.applications.update(id, { postingUrl: "https://jobs.example.com/acme/1" });
    const c = await openForm(db);
    await type($(c, "#add-company"), "Something else");
    await type($(c, "#add-url"), "https://jobs.example.com/acme/1#apply");
    await noteShown(c);
    expect(text(note(c))).toContain("You already have Acme · Analyst (Applied)");
  });

  it("waits for typing to pause and looks up once", async () => {
    const db = freshDb();
    await addApp(db, "Acme", { role: "Analyst" });
    const c = await openForm(db);
    const real = db.applications.where.bind(db.applications);
    const lookups: unknown[] = [];
    vi.spyOn(db.applications, "where").mockImplementation(((...args: Parameters<typeof real>) => {
      lookups.push(args[0]);
      return real(...args);
    }) as never);
    for (const word of ["A", "Ac", "Acm", "Acme"]) await type($(c, "#add-company"), word);
    expect(lookups).toEqual([]);
    expect(note(c)).toBeNull();
    await noteShown(c);
    expect(lookups.filter((k) => k === "companyKey")).toHaveLength(1);
  });

  it("shows nothing for an empty form and when the form is closed", async () => {
    const db = freshDb();
    await addApp(db, "Acme");
    const c = await openForm(db);
    await pause();
    expect(note(c)).toBeNull();
    await type($(c, "#add-company"), "Acme");
    await noteShown(c);
    await click(button(c, "Cancel"));
    expect($(c, ".dup-note")).toBeNull();
  });
});

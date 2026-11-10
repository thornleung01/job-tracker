// The Tailor picker (#/tailor): live applications, newest first, searchable, with what is already there.
import "fake-indexeddb/auto";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { PageProps } from "../../../src/app/pageProps";
import TailorPage from "../../../src/pages/tailor";
import { deleteApplication } from "../../../src/sync/actions";
import { saveMaster, saveTailored, setPostingText } from "../../../src/sync/documents";
import { MASTER } from "../../ai/tailorFixture";
import { $, $$, addApp, button, cleanup, click, freshDb, mountPage, text, type, waitFor } from "../applications/harness";

afterEach(cleanup);

const Page = (props: PageProps) => createElement(TailorPage, props);
const rows = (c: HTMLElement) => $$(c, "ul.tailor-picker > li");

async function seed() {
  const db = freshDb();
  const old = await addApp(db, "Initech", { role: "Analyst" });
  const mid = await addApp(db, "Globex", { role: "Planner" });
  const fresh = await addApp(db, "Acme", { role: "Data Analyst", stage: "Interview" });
  await saveMaster(db, MASTER, "paste");
  await setPostingText(db, mid, "Globex wants a planner.");
  await saveTailored(db, fresh, MASTER, "copy");
  return { db, old, mid, fresh };
}

describe("the picker", () => {
  it("lists the live applications newest first, with stage, posting and tailored facts and a button each", async () => {
    const { db, old, mid, fresh } = await seed();
    const { container } = await mountPage(Page, db, "/tailor");
    expect($(container, "h1")!.textContent).toBe("Tailor for a job");
    const list = rows(container);
    expect(list.map((r) => text($(r, ".tailor-pick-title")))).toEqual(["Acme, Data Analyst", "Globex, Planner", "Initech, Analyst"]);
    expect(text(list[0])).toContain("Interview");
    expect(text(list[0])).toContain("No posting");
    expect(text(list[0])).toContain("Tailored");
    expect(text(list[1])).toContain("Posting saved");
    expect(text(list[1])).not.toContain("Tailored");
    expect(text(list[2])).toContain("No posting");
    expect(text($(list[0], "button"))).toBe("Open");
    expect(text($(list[1], "button"))).toBe("Tailor");
    expect($(list[1], "button")!.getAttribute("aria-label")).toBe("Tailor Globex, Planner");
    expect([old, mid, fresh].length).toBe(3);
  });

  it("leaves out a deleted application", async () => {
    const { db, old } = await seed();
    await deleteApplication(db, old);
    const { container } = await mountPage(Page, db, "/tailor");
    expect(rows(container).map((r) => text($(r, ".tailor-pick-title")))).toEqual(["Acme, Data Analyst", "Globex, Planner"]);
  });

  it("searches by company or role", async () => {
    const { db } = await seed();
    const { container } = await mountPage(Page, db, "/tailor");
    await type($(container, "input[type=search]"), "planner");
    expect(rows(container).map((r) => text($(r, ".tailor-pick-title")))).toEqual(["Globex, Planner"]);
    await type($(container, "input[type=search]"), "zzz");
    expect(rows(container)).toHaveLength(0);
    expect(text(container)).toContain("No applications match that search.");
  });

  it("goes to the workspace for the chosen application, and carries a chosen baseline", async () => {
    const { db, mid } = await seed();
    const plain = await mountPage(Page, db, "/tailor");
    await click(button(rows(plain.container)[1], "Tailor"));
    expect(plain.visited).toEqual([`/tailor/${mid}`]);
    await cleanup();
    const { db: db2, mid: mid2 } = await seed();
    const withBaseline = await mountPage(Page, db2, "/tailor?baseline=7");
    await click(button(rows(withBaseline.container)[1], "Tailor"));
    expect(withBaseline.visited).toEqual([`/tailor/${mid2}?baseline=7`]);
  });

  it("leaves the chosen baseline off for an application that already has a copy", async () => {
    const { db, fresh } = await seed();
    const { container, visited } = await mountPage(Page, db, "/tailor?baseline=7");
    await click(button(rows(container)[0], "Open"));
    expect(visited).toEqual([`/tailor/${fresh}`]);
  });

  it("says so, with a link to Add application, when there are no applications", async () => {
    const db = freshDb();
    const { container } = await mountPage(Page, db, "/tailor");
    await waitFor(() => $(container, ".tailor-empty") !== null, "the empty sentence");
    expect(text($(container, ".tailor-empty"))).toContain("No applications");
    expect($(container, ".tailor-empty a")!.getAttribute("href")).toBe("#/");
    expect(text($(container, ".tailor-empty a"))).toBe("Add application");
    expect($(container, "input[type=search]")).toBeNull();
  });
});

// The resume on the Applications page: the "Resume sent" select in the add forms, the filter and its chip, saved views, the optional
// column, bulk Set resume with Undo, and the g r shortcut. The logic under them is in tests/sync/resumeList.test.ts.
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, $$, addApp, button, cleanup, click, freshDb, mountPage, settle, text, type, waitFor } from "./harness";
import { draft, openForm, withFakes } from "./paste-helpers";
import type { PageProps } from "../../../src/app/pageProps";
import type { JobTrackerDB } from "../../../src/db/schema";
import ApplicationsPage from "../../../src/pages/applications";
import { createVersion, deleteDocument, saveMaster, setApplicationResume, setPostingText } from "../../../src/sync/documents";
import type { AddApplicationInput } from "../../../src/sync/actions";
import { loadSavedViews } from "../../../src/sync/savedViews";
import { saveSettings } from "../../../src/sync/settings";

afterEach(cleanup);
beforeEach(() => {
  sessionStorage.clear();
  window.confirm = vi.fn(() => true);
});

const SECTIONS = [{ heading: "Experience", items: [{ text: "Built dashboards" }] }];
const names = (c: HTMLElement) => $$(c, "tr.app-row [data-col=company] strong").map((e) => text(e));
const chips = (c: HTMLElement) => $$(c, ".result-line .chip").map((e) => text(e));
const select = (c: HTMLElement, selector: string) => $(c, selector) as HTMLSelectElement;
const options = (el: HTMLSelectElement) => [...el.options].map((o) => o.textContent);

/** Acme and Beta sent the master, Cora sent "Analyst v2", Dana sent nothing. */
async function seed(withMaster = true) {
  const db = freshDb();
  let master = 0;
  let v2 = 0;
  if (withMaster) {
    master = await saveMaster(db, SECTIONS, "paste");
    v2 = await createVersion(db, { title: "Analyst v2", sections: SECTIONS, basedOn: master, source: "copy" });
  }
  const acme = await addApp(db, "Acme", { last: 1 });
  const beta = await addApp(db, "Beta", { last: 2 });
  const cora = await addApp(db, "Cora", { last: 3 });
  const dana = await addApp(db, "Dana", { last: 4 });
  if (withMaster) {
    await setApplicationResume(db, acme, master);
    await setApplicationResume(db, beta, master);
    await setApplicationResume(db, cora, v2);
  }
  return { db, master, v2, acme, beta, cora, dana };
}

/** What the add form asks to save. B's AddApplicationInput has the last two; this keeps the test compiling on its own. */
type Saved = AddApplicationInput & { postingText?: string; resumeId?: number };

/** The page with its job-link fakes and an add that records what it was asked to save. */
function recording(over: Parameters<typeof withFakes>[0] = {}) {
  const { deps } = withFakes(over);
  const saved: Saved[] = [];
  const Page = (props: PageProps) =>
    createElement(ApplicationsPage, { ...props, deps: { ...deps, addApplication: async (_db: JobTrackerDB, input: Saved) => { saved.push(input); return 1; } } });
  return { Page, saved, deps };
}

describe("Resume sent in the Add form", () => {
  it("offers None, the master first, then each version", async () => {
    const { db } = await seed();
    const { container } = await mountPage(recording().Page, db);
    await openForm(container);
    expect(text($(container, "label[for=add-resume]"))).toBe("Resume sent");
    expect(options(select(container, "#add-resume"))).toEqual(["None", "Master resume", "Analyst v2"]);
    expect(select(container, "#add-resume").value).toBe("");
  });

  it("offers only None and Add your resume without a master, and Add your resume opens the Resume page", async () => {
    const { db } = await seed(false);
    const { container, visited } = await mountPage(recording().Page, db);
    await openForm(container);
    expect(options(select(container, "#add-resume"))).toEqual(["None", "Add your resume"]);
    await type(select(container, "#add-resume"), "add");
    expect(visited).toEqual(["/resume"]);
  });

  it("saves the chosen version with the application", async () => {
    const { db, v2 } = await seed();
    const { Page, saved } = recording();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type($(container, "#add-company"), "Eve");
    await type(select(container, "#add-resume"), String(v2));
    await click(button(container, "Save application"));
    await waitFor(() => saved.length === 1);
    expect(saved[0]).toMatchObject({ company: "Eve", resumeId: v2 });
  });

  it("saves no resume when None is chosen", async () => {
    const { db } = await seed();
    const { Page, saved } = recording();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type($(container, "#add-company"), "Eve");
    await click(button(container, "Save application"));
    await waitFor(() => saved.length === 1);
    expect(saved[0].resumeId).toBeUndefined();
  });

  it("starts as the one chosen last, in this tab and this database only", async () => {
    const { db, v2 } = await seed();
    const first = await mountPage(recording().Page, db);
    await openForm(first.container);
    await type(select(first.container, "#add-resume"), String(v2));

    const again = await mountPage(recording().Page, db);
    await openForm(again.container);
    expect(select(again.container, "#add-resume").value).toBe(String(v2));

    const other = await seed();
    const elsewhere = await mountPage(recording().Page, other.db);
    await openForm(elsewhere.container);
    expect(select(elsewhere.container, "#add-resume").value).toBe("");
  });

  it("falls back to None when the remembered version is gone", async () => {
    const { db, v2 } = await seed();
    const first = await mountPage(recording().Page, db);
    await openForm(first.container);
    await type(select(first.container, "#add-resume"), String(v2));
    await deleteDocument(db, v2);
    const { Page, saved } = recording();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    expect(select(container, "#add-resume").value).toBe("");
    await type($(container, "#add-company"), "Eve");
    await click(button(container, "Save application"));
    await waitFor(() => saved.length === 1);
    expect(saved[0].resumeId).toBeUndefined();
  });

  it("sends the posting text a bookmarklet draft carries, and only that draft's", async () => {
    const { db } = await seed();
    const withText = { ...draft({ company: "Acme", role: "Analyst", source: "bookmarklet" }), description: "  We want an analyst.  " };
    const { Page, saved } = recording({ draftFromHash: vi.fn((_q: URLSearchParams) => withText) });
    const { container } = await mountPage(Page, db, "/?add=1&c=Acme");
    await waitFor(() => $(container, "#add-application") !== null);
    await click(button(container, "Save application"));
    await waitFor(() => saved.length === 1);
    expect(saved[0]).toMatchObject({ company: "Acme", postingText: "We want an analyst." });
    // a second application typed by hand doesn't inherit it
    await openForm(container);
    await type($(container, "#add-company"), "Typed Co");
    await click(button(container, "Save application"));
    await waitFor(() => saved.length === 2);
    expect(saved[1].postingText).toBeUndefined();
  });

  it("sends no posting text for a draft without a description", async () => {
    const { db } = await seed();
    const { Page, saved } = recording({ draftFromHash: vi.fn((_q: URLSearchParams) => draft({ company: "Acme", role: "Analyst", source: "bookmarklet" })) });
    const { container } = await mountPage(Page, db, "/?add=1&c=Acme");
    await waitFor(() => $(container, "#add-application") !== null);
    await click(button(container, "Save application"));
    await waitFor(() => saved.length === 1);
    expect(saved[0].postingText).toBeUndefined();
  });

  it("sends the posting text of a pasted job link, and drops it when the form is closed", async () => {
    const { db } = await seed();
    const read = { ...draft({ company: "Stripe", role: "Engineer", url: "https://jobs.example.com/p/1" }), description: "Pasted posting" };
    const { Page, saved } = recording({ parseJobUrl: vi.fn((_raw: string) => read) });
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type($(container, "#add-link"), "https://jobs.example.com/p/1");
    await click(button(container, "Fill in details"));
    await waitFor(() => (($(container, "#add-company") as HTMLInputElement).value === "Stripe"));
    await click(button(container, "Save application"));
    await waitFor(() => saved.length === 1);
    expect(saved[0].postingText).toBe("Pasted posting");

    await openForm(container);
    await type($(container, "#add-link"), "https://jobs.example.com/p/1");
    await click(button(container, "Fill in details"));
    await click(button(container, "Cancel"));
    await openForm(container);
    await type($(container, "#add-company"), "Other");
    await click(button(container, "Save application"));
    await waitFor(() => saved.length === 2);
    expect(saved[1].postingText).toBeUndefined();
  });
});

describe("Add several links with a resume", () => {
  it("has one Resume sent select for the batch and saves it on each application with the posting text", async () => {
    const { db, v2 } = await seed();
    const read = (raw: string) => ({ ...draft({ company: raw.endsWith("1") ? "Eve" : "Finn", role: "Analyst", url: raw }), description: "Posting text" });
    const { Page } = withFakes({ parseJobUrl: vi.fn(read) });
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await click(button(container, "Add several links"));
    const batch = select(container, ".bulk-add-resume select");
    expect(text($(container, ".bulk-add-resume label"))).toBe("Resume sent");
    expect(options(batch)).toEqual(["None", "Master resume", "Analyst v2"]);
    await type(batch, String(v2));
    await type($(container, "textarea[name=job_links]"), "https://jobs.example/a/1\nhttps://jobs.example/a/2");
    await click(button(container, "Add these"));
    await waitFor(() => $$(container, ".bulk-add-results li").length === 2);
    const added = (await db.applications.toArray()).filter((a) => ["Eve", "Finn"].includes(a.company));
    expect(added.map((a) => [a.resumeId, a.postingText])).toEqual([[v2, "Posting text"], [v2, "Posting text"]]);
  });
});

describe("the resume filter", () => {
  it("shows only the applications that sent that version, with a chip and the select showing it", async () => {
    const { db, v2 } = await seed();
    const { container } = await mountPage(ApplicationsPage, db, `/?resume=${v2}`);
    await waitFor(() => names(container).length === 1);
    expect(names(container)).toEqual(["Cora"]);
    expect(chips(container)).toContain("Resume: Analyst v2");
    expect(text($(container, ".result-line .small"))).toBe("Showing 1 of 4 application");
    expect(select(container, "#f-resume").value).toBe(String(v2));
    expect(options(select(container, "#f-resume"))).toEqual(["Any resume", "Master resume", "Analyst v2", "No resume set"]);
  });

  it("shows the ones with no resume set for resume=none", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db, "/?resume=none");
    await waitFor(() => names(container).length === 1);
    expect(names(container)).toEqual(["Dana"]);
    expect(chips(container)).toContain("No resume set");
  });

  it("shows an empty list and Resume: (deleted) for an id that is gone, never an error", async () => {
    const { db, v2 } = await seed();
    await deleteDocument(db, v2);
    const { container } = await mountPage(ApplicationsPage, db, `/?resume=${v2}`);
    await waitFor(() => $(container, ".list-empty") !== null);
    expect(text($(container, ".list-empty"))).toBe("No applications match these filters.");
    expect(chips(container)).toContain("Resume: (deleted)");
    expect(options(select(container, "#f-resume"))).toContain("(deleted)");
    expect(select(container, "#f-resume").value).toBe(String(v2));
  });

  it("ignores a value that is not an id", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db, "/?resume=abc");
    await waitFor(() => names(container).length === 4);
    expect(chips(container)).toEqual([]);
  });

  it("goes into the address with Apply filters and out with Clear filters", async () => {
    const { db, master } = await seed();
    const { container, visited } = await mountPage(ApplicationsPage, db);
    await type(select(container, "#f-resume"), String(master));
    await click(button(container, "Apply filters"));
    expect(visited).toEqual([`/?resume=${master}`]);
    await waitFor(() => names(container).length === 2);
    expect(names(container)).toEqual(["Acme", "Beta"]);
    expect($(container, "a.clear-filters")?.getAttribute("href")).toBe("#/");
  });

  it("keeps the other filters in every link, such as the stage tabs and the sort", async () => {
    const { db, master } = await seed();
    const { container } = await mountPage(ApplicationsPage, db, `/?resume=${master}&sort=company&dir=asc`);
    await waitFor(() => names(container).length === 2);
    const params = (el: Element | null) => new URLSearchParams((el?.getAttribute("href") ?? "").split("?")[1]);
    expect(params($(container, "th[data-col=company] a.sort"))).toEqual(new URLSearchParams({ sort: "company", dir: "desc", resume: String(master) }));
    expect(params($$(container, ".view-tabs a")[1]).get("resume")).toBe(String(master));
    expect(params($$(container, ".stage-tabs a")[2]).get("resume")).toBeNull();
  });

  it("is not offered while there are no resume versions", async () => {
    const { db } = await seed(false);
    const { container } = await mountPage(ApplicationsPage, db);
    await waitFor(() => names(container).length === 4);
    expect($(container, "#f-resume")).toBeNull();
  });

  it("clears the ticked rows when it changes", async () => {
    const { db, master } = await seed();
    const { container } = await mountPage(ApplicationsPage, db);
    await click($(container, "input[type=checkbox][aria-label*=Acme]"));
    expect($(container, ".bulk-count")).not.toBeNull();
    await type(select(container, "#f-resume"), String(master));
    await click(button(container, "Apply filters"));
    await waitFor(() => $(container, ".bulk-count") === null);
  });
});

describe("saved views with a resume", () => {
  it("offers Save this view for a resume filter alone, names it, and keeps it", async () => {
    const { db, v2 } = await seed();
    const { container } = await mountPage(ApplicationsPage, db, `/?resume=${v2}`);
    await waitFor(() => names(container).length === 1);
    await click(button(container, "Save this view"));
    expect(text($(container, "#save-view"))).toContain("Resume: Analyst v2");
    await type($(container, "input[name=view_name]"), "Sent v2");
    await click(button(container, "Save view"));
    await waitFor(() => $$(container, ".view-chip-link").length === 1);
    expect((await loadSavedViews(db))[0]).toMatchObject({ name: "Sent v2", resume: String(v2) });
    const chip = $(container, ".view-chip-link") as HTMLAnchorElement;
    expect(chip.getAttribute("href")).toBe(`#/?resume=${v2}`);
    expect(chip.getAttribute("title")).toBe("Resume: Analyst v2");
    expect(chip.getAttribute("aria-current")).toBe("true");
  });

  it("opens a view saved before resumes with no resume filter", async () => {
    const { db } = await seed();
    await db.settings.put({ key: "savedViews", value: { views: [{ id: 1, name: "Old", stage: "Applied", q: "", account: 0, followUp: false, ghosted: false, sort: "", dir: "" }] } });
    const { container } = await mountPage(ApplicationsPage, db);
    await waitFor(() => $$(container, ".view-chip-link").length === 1);
    expect($(container, ".view-chip-link")?.getAttribute("href")).toBe("#/?stage=Applied");
  });
});

describe("the Resume column", () => {
  it("is off until you turn it on", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db);
    await waitFor(() => names(container).length === 4);
    expect($(container, "th[data-col=resume]")).toBeNull();
  });

  it("shows the title as plain text, empty for none, and sorts from its header", async () => {
    const { db } = await seed();
    await saveSettings(db, "appearance", { columns: ["resume"] });
    const { container } = await mountPage(ApplicationsPage, db, "/?sort=company&dir=asc");
    await waitFor(() => $(container, "td[data-col=resume]") !== null);
    expect(text($(container, "th[data-col=resume]"))).toBe("Resume");
    expect($$(container, "td[data-col=resume]").map((td) => td.textContent)).toEqual(["Master resume", "Master resume", "Analyst v2", ""]);
    expect($(container, "td[data-col=resume] a")).toBeNull();
    expect($(container, "td[data-col=resume] span")?.getAttribute("title")).toBe("Master resume");
    expect($(container, "th[data-col=resume] a.sort")?.getAttribute("href")).toBe("#/?sort=company&dir=asc&sort=resume&dir=asc".replace("sort=company&dir=asc&", ""));
  });

  it("sorts by title from the address, empty last", async () => {
    const { db } = await seed();
    await saveSettings(db, "appearance", { columns: ["resume"] });
    const asc = await mountPage(ApplicationsPage, db, "/?sort=resume&dir=asc");
    await waitFor(() => $(asc.container, "td[data-col=resume]") !== null);
    expect(names(asc.container)).toEqual(["Cora", "Acme", "Beta", "Dana"]);
    expect($(asc.container, "th[data-col=resume]")?.getAttribute("aria-sort")).toBe("ascending");
  });

  it("is labelled Resume in Settings", async () => {
    const { COLUMNS } = await import("../../../src/sync/settings");
    expect(COLUMNS.resume).toBe("Resume");
  });

  it("is hidden on a phone like Rounds", async () => {
    const fs = await import(/* @vite-ignore */ "node" + ":fs");
    const css: string = fs.readFileSync(`${(globalThis as unknown as { process: { cwd(): string } }).process.cwd()}/src/styles/base.css`, "utf8");
    expect(css).toMatch(/th\[data-col="resume"\]/);
    expect(css).toMatch(/td\[data-col="resume"\][^}]*display: none/);
  });
});

describe("bulk Set resume", () => {
  const tick = (c: HTMLElement, company: string) => click($(c, `input[type=checkbox][aria-label*="${company}"]`));
  const notice = (c: HTMLElement) => text($(c, ".bulk-done .notice"));

  it("sits beside Set stage, disabled until a resume is chosen", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db);
    await tick(container, "Acme");
    const set = button(container, "Set resume") as HTMLButtonElement;
    expect(set.disabled).toBe(true);
    const choose = select(container, "select[aria-label='Resume for selected applications']");
    expect(options(choose)).toEqual(["Choose a resume", "Master resume", "Analyst v2", "No resume"]);
    await type(choose, String((await db.documents.toArray())[1].id));
    expect(set.disabled).toBe(false);
    expect(set.previousElementSibling).toBe(choose);
  });

  it("is hidden when there are no resume versions", async () => {
    const { db } = await seed(false);
    const { container } = await mountPage(ApplicationsPage, db);
    await tick(container, "Acme");
    expect(button(container, "Set stage")).not.toBeNull();
    expect(button(container, "Set resume")).toBeNull();
    expect($(container, "select[aria-label='Resume for selected applications']")).toBeNull();
  });

  it("sets the version on every ticked row, says so, and Undo puts each row's own value back", async () => {
    const { db, master, v2, acme, cora, dana } = await seed();
    const { container } = await mountPage(ApplicationsPage, db);
    for (const c of ["Acme", "Cora", "Dana"]) await tick(container, c);
    await type(select(container, "select[aria-label='Resume for selected applications']"), String(v2));
    await click(button(container, "Set resume"));
    await waitFor(() => $(container, ".bulk-done") !== null);
    expect(notice(container)).toBe("3 applications set to Analyst v2.");
    const resumes = async () => Promise.all([acme, cora, dana].map(async (id) => (await db.applications.get(id))?.resumeId));
    expect(await resumes()).toEqual([v2, v2, v2]);
    await click(button(container, "Undo"));
    await waitFor(() => notice(container) === "Put 3 applications back.");
    expect(await resumes()).toEqual([master, v2, undefined]);
  });

  it("clears the resume with No resume", async () => {
    const { db, acme } = await seed();
    const { container } = await mountPage(ApplicationsPage, db);
    await tick(container, "Acme");
    await type(select(container, "select[aria-label='Resume for selected applications']"), "none");
    await click(button(container, "Set resume"));
    await waitFor(() => $(container, ".bulk-done") !== null);
    expect(notice(container)).toBe("Cleared the resume on 1 application.");
    expect((await db.applications.get(acme))?.resumeId).toBeUndefined();
  });

  it("says so and changes nothing when the version was deleted meanwhile, keeping the selection", async () => {
    const { db, v2 } = await seed();
    const { container } = await mountPage(ApplicationsPage, db);
    await tick(container, "Dana");
    await type(select(container, "select[aria-label='Resume for selected applications']"), String(v2));
    await act(async () => { await db.documents.update(v2, { deletedAt: "2026-10-01T00:00:00Z" }); });
    await settle();
    await click(button(container, "Set resume"));
    await waitFor(() => text(container).includes("That resume isn't there any more."));
    expect((await db.applications.toArray()).find((a) => a.company === "Dana")?.resumeId).toBeUndefined();
    expect(text($(container, ".bulk-count"))).toBe("1 selected");
  });
});

describe("search finds the posting", () => {
  it("lists the application and says where it matched", async () => {
    const { db, acme } = await seed();
    await setPostingText(db, acme, "Loves Tableau and SQL.");
    const { container } = await mountPage(ApplicationsPage, db, "/?q=tableau");
    await waitFor(() => names(container).length === 1);
    expect(text($(container, ".match-why"))).toBe("Matched in the job posting: Loves Tableau and SQL.");
  });
});

describe("the g r shortcut", () => {
  async function press(k: string) {
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    });
    await settle(0);
  }

  it("goes to the Resume page", async () => {
    const { db } = await seed();
    const { container, visited } = await mountPage(ApplicationsPage, db);
    await waitFor(() => names(container).length === 4);
    await press("g");
    await press("r");
    expect(visited).toEqual(["/resume"]);
  });

  it("is listed in the help next to Go to Settings", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db);
    await waitFor(() => names(container).length === 4);
    await click(button(container, "Keyboard shortcuts"));
    const help = text($(document.body, "[role=dialog]"));
    expect(help).toContain("Go to Resume");
    expect(help.indexOf("Go to Settings")).toBeLessThan(help.indexOf("Go to Resume"));
  });
});

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResumePage from "../../../src/pages/resume";
import type { DocSection, JobTrackerDB } from "../../../src/db/schema";
import { PLACEHOLDERS, TEMPLATE_HEADINGS } from "../../../src/documents/blankResume";
import { getMaster, saveMaster } from "../../../src/sync/documents";
import { $, $$, button, cleanup, click, freshDb, mountPage, text, type, waitFor } from "../applications/harness";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  return cleanup();
});

/** The list editor is the one with fixed field names, so tests that type pin it; the on-page editor is covered by its own tests. */
const useList = () => localStorage.setItem("jobtracker:resume-editing", "list");

async function mount(db: JobTrackerDB) {
  const page = await mountPage(ResumePage, db, "/resume");
  await waitFor(() => $(page.container, ".resume-view") !== null, "the page to load");
  return page;
}
const fields = (root: ParentNode, label: RegExp) => $$(root, "input, textarea").filter((e) => label.test(e.getAttribute("aria-label") ?? "")) as (HTMLInputElement | HTMLTextAreaElement)[];
const save = (root: ParentNode) => button(root, "Save") as HTMLButtonElement;

let n = 0;
const sec = (heading: string, ...lines: string[]): DocSection => ({ id: `s${++n}`, heading, items: lines.map((t) => ({ id: `i${++n}`, text: t })) });
/** A resume saved before typed lines (the same one the re-read tests use). */
const OLD = (): DocSection[] => [
  sec("JORDAN LEE", "Toronto, ON | 416-555-0100 | jordan@example.com | linkedin.com/in/jordanlee"),
  sec("PROFESSIONAL SUMMARY", "Analyst with six years in fintech", "building dashboards and reports for product teams", "and writing the SQL behind them."),
  sec("SKILLS AND QUALIFICATIONS", "Programming/Database SQL (Redshift), Python", "Analytics: Tableau, Excel"),
  sec("WORK EXPERIENCE", "Acme Corp, Toronto, ON", "Senior Analyst Jan 2021 – Present", "Reporting: cut weekly report time from 6 hours to 1", "Built a churn model used by three teams",
      "Globex Inc, Montreal, QC", "Analyst Jun 2018 – Dec 2020", "Automation: replaced a manual export with a scheduled job"),
  sec("EDUCATION", "University of Toronto, Toronto, ON", "B.Sc. in Statistics, 2018"),
];

describe("starting from the template", () => {
  beforeEach(() => localStorage.clear());

  it("opens a blank copy of the template: the headings are there and the empty fields carry placeholders", async () => {
    const db = freshDb();
    const { container } = await mount(db);
    await click(button(container, "Start from the template"));
    expect(text($(container, "h2"))).toBe("Master resume");
    const shown = [...$$(container, "input, textarea").map((e) => (e as HTMLInputElement).value), text(container)].join("\n");
    for (const heading of Object.values(TEMPLATE_HEADINGS)) expect(shown.toLowerCase()).toContain(heading.toLowerCase());
    const placeholders = $$(container, "[placeholder]").map((e) => e.getAttribute("placeholder"));
    expect(placeholders).toEqual(expect.arrayContaining([PLACEHOLDERS.name, PLACEHOLDERS.contact, PLACEHOLDERS.summary]));
    expect(await db.documents.count()).toBe(0);
  });

  it("keeps Save off until something is typed, then saves with source template and no empty lines or sections", async () => {
    useList();
    const db = freshDb();
    const { container } = await mount(db);
    await click(button(container, "Start from the template"));
    expect(save(container).disabled).toBe(true);
    await type(fields(container, /^Line 1 of Header/)[0], "Jordan Lee");
    expect(save(container).disabled).toBe(false);
    await click(button(container, "Save"));
    await waitFor(() => $(container, ".doc-used") !== null, "the saved master");
    const master = (await getMaster(db))!;
    expect(master.source).toBe("template");
    expect(master.title).toBe("Master resume");
    expect(master.sections.map((s) => s.heading)).toEqual(["Header"]);
    expect(master.sections[0].items.map((i) => i.text)).toEqual(["Jordan Lee"]);
    for (const s of master.sections) for (const i of s.items) expect(i.text.trim() || i.label || i.right).toBeTruthy();
    expect(text($(container, "h2"))).toBe("Master resume");
  });

  it("Cancel on a blank template returns to the empty state at once, with no question", async () => {
    const db = freshDb();
    const { container } = await mount(db);
    await click(button(container, "Start from the template"));
    await click(button(container, "Cancel"));
    expect($(container, ".inline-confirm")).toBeNull();
    expect(button(container, "Start from the template")).not.toBeNull();
  });

  it("Cancel after typing asks first: keep editing, or discard and store nothing", async () => {
    useList();
    const db = freshDb();
    const { container } = await mount(db);
    await click(button(container, "Start from the template"));
    await type(fields(container, /^Line 1 of Header/)[0], "Jordan Lee");
    await click(button(container, "Cancel"));
    expect(text($(container, ".inline-confirm"))).toContain("Discard what you typed?");
    expect(button(container, "Start from the template")).toBeNull();
    // the question's own Cancel keeps the draft
    await click(button($(container, ".inline-confirm") as HTMLElement, "Cancel"));
    expect($(container, ".inline-confirm")).toBeNull();
    expect(fields(container, /^Line 1 of Header/)[0].value).toBe("Jordan Lee");
    await click(button(container, "Cancel"));
    await click(button(container, "Discard"));
    expect(button(container, "Start from the template")).not.toBeNull();
    expect(button(container, "Upload a file")).not.toBeNull();
    expect(await db.documents.count()).toBe(0);
  });

  it("a section dropped in the list editor stays dropped (the scaffold does not bring it back)", async () => {
    useList();
    const db = freshDb();
    const { container } = await mount(db);
    await click(button(container, "Start from the template"));
    await type(fields(container, /^Line 1 of Header/)[0], "Jordan Lee");
    const education = $$(container, "section.doc-section").find((s) => s.getAttribute("aria-label") === "Education") as HTMLElement;
    await click(button(education, "Remove section"));
    expect($$(container, "section.doc-section").map((s) => s.getAttribute("aria-label"))).not.toContain("Education");
  });
});

describe("re-reading an old resume", () => {
  beforeEach(() => useList());

  const NOTICE = "This resume was saved before the template. Re-read it as the template?";

  it("offers it for an untyped master and stores nothing until Save", async () => {
    const db = freshDb();
    await saveMaster(db, OLD(), "paste");
    const before = JSON.stringify((await getMaster(db))!.sections);
    const { container } = await mount(db);
    await waitFor(() => button(container, "Re-read") !== null, "the offer");
    expect(text($(container, ".doc-reread"))).toContain(NOTICE);
    await click(button(container, "Re-read"));
    expect(text($(container, "h2.section"))).toBe("Check your resume");
    expect(JSON.stringify((await getMaster(db))!.sections)).toBe(before);
    // the review shows the typed result: the job rows are now typed lines
    const kinds = $$(container, "select.doc-kind").map((s) => (s as HTMLSelectElement).value);
    expect(kinds).toEqual(expect.arrayContaining(["org", "title", "bullet", "skill", "school"]));
    await click(button(container, "Save as master resume"));
    await waitFor(() => $(container, ".convert-review") === null, "the review to close");
    const master = (await getMaster(db))!;
    expect(master.source).toBe("paste");
    expect(master.sections.some((s) => s.items.some((i) => i.kind === "org"))).toBe(true);
    expect(await db.documents.count()).toBe(1);
    expect(button(container, "Re-read")).toBeNull();   // it is typed now
  });

  it("Cancel leaves the saved resume as it was", async () => {
    const db = freshDb();
    await saveMaster(db, OLD(), "paste");
    const before = JSON.stringify((await getMaster(db))!.sections);
    const { container } = await mount(db);
    await waitFor(() => button(container, "Re-read") !== null, "the offer");
    await click(button(container, "Re-read"));
    await click(button(container, "Cancel"));
    expect(JSON.stringify((await getMaster(db))!.sections)).toBe(before);
  });

  it("Dismiss hides the offer", async () => {
    const db = freshDb();
    await saveMaster(db, OLD(), "paste");
    const { container } = await mount(db);
    await waitFor(() => button(container, "Dismiss") !== null, "the offer");
    await click(button(container, "Dismiss"));
    expect(button(container, "Re-read")).toBeNull();
    expect(text(container)).not.toContain(NOTICE);
  });

  it("is not offered for a master that already has typed lines", async () => {
    const db = freshDb();
    const typed = OLD();
    typed[3].items[0].kind = "org";
    await saveMaster(db, typed, "template");
    const { container } = await mount(db);
    await waitFor(() => $(container, ".doc-card") !== null, "the master card");
    expect(button(container, "Re-read")).toBeNull();
  });

  it("is not offered when there is nothing to improve on", async () => {
    const db = freshDb();
    await saveMaster(db, [sec("NOTES", "just a thought")], "paste");
    const { container } = await mount(db);
    await waitFor(() => $(container, ".doc-card") !== null, "the master card");
    expect(button(container, "Re-read")).toBeNull();
  });
});

describe("the re-read offer's memory and source", () => {
  beforeEach(() => useList());

  async function reread(db: JobTrackerDB) {
    const { container } = await mount(db);
    await waitFor(() => button(container, "Re-read") !== null, "the offer");
    await click(button(container, "Re-read"));
    await click(button(container, "Save as master resume"));
    await waitFor(() => $(container, ".convert-review") === null, "the review to close");
  }

  it("saving from the offer keeps the master's source", async () => {
    const db = freshDb();
    await saveMaster(db, OLD(), "upload");
    await reread(db);
    expect((await getMaster(db))!.source).toBe("upload");
  });

  it("falls back to paste when the master has no source", async () => {
    const db = freshDb();
    const id = await saveMaster(db, OLD(), "paste");
    await db.documents.update(id, { source: undefined });
    await reread(db);
    expect((await getMaster(db))!.source).toBe("paste");
  });

  it("Dismiss is remembered for that master in sessionStorage", async () => {
    const db = freshDb();
    const id = await saveMaster(db, OLD(), "paste");
    const { container } = await mount(db);
    await waitFor(() => button(container, "Dismiss") !== null, "the offer");
    await click(button(container, "Dismiss"));
    expect(sessionStorage.getItem(`jobtracker:reread-dismissed:${id}`)).toBe("1");
  });

  it("stays dismissed when the page is opened again in the same session", async () => {
    const db = freshDb();
    const id = await saveMaster(db, OLD(), "paste");
    sessionStorage.setItem(`jobtracker:reread-dismissed:${id}`, "1");
    const { container } = await mount(db);
    await waitFor(() => $(container, ".doc-card") !== null, "the master card");
    expect(button(container, "Re-read")).toBeNull();
  });

  it("still works when sessionStorage throws", async () => {
    const db = freshDb();
    await saveMaster(db, OLD(), "paste");
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { container } = await mount(db);
    await waitFor(() => button(container, "Dismiss") !== null, "the offer");
    await click(button(container, "Dismiss"));
    expect(button(container, "Re-read")).toBeNull();
    get.mockRestore();
    set.mockRestore();
  });
});

describe("saving drops sections with no lines", () => {
  it("clearing every line of a section in the master and saving stores no lone heading", async () => {
    useList();
    const db = freshDb();
    await saveMaster(db, [sec("Header", "Jordan Lee"), sec("Notes", "just a thought")], "paste");
    const { container } = await mount(db);
    await waitFor(() => $(container, ".doc-card") !== null, "the master card");
    const notes = $$(container, "section.doc-section").find((s) => s.getAttribute("aria-label") === "Notes") as HTMLElement;
    await click($(notes, 'button[aria-label="Remove line 1"]') as HTMLElement);
    await click(button(container, "Save"));
    await waitFor(() => text(container).includes("Saved"), "the save");
    expect((await getMaster(db))!.sections.map((s) => s.heading)).toEqual(["Header"]);
  });
});

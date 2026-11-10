import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PageProps } from "../../../src/app/pageProps";
import type { AuthUser } from "../../../src/auth/user";
import ResumePage from "../../../src/pages/resume";
import { MAX_RESUME_VERSIONS } from "../../../src/db/limits";
import type { JobTrackerDB } from "../../../src/db/schema";
import { createVersion, getMaster, liveResumes, saveCoverLetter, saveMaster } from "../../../src/sync/documents";
import { file, makeDocx } from "../../documents/fixtures";
import { $, $$, addApp, button, cleanup, click, freshDb, mountPage, settle, text, type, waitFor } from "../applications/harness";

beforeEach(() => localStorage.setItem("jobtracker:resume-editing", "list"));   // the editor defaults to the on-page one; these tests drive the list editor
afterEach(async () => {
  localStorage.removeItem("jobtracker:resume-editing");
  await cleanup();
});

const user: AuthUser = { iss: "https://accounts.google.com", sub: "1", provider: "google", email: "me@example.com" };

const lines = (...t: string[]) => t.map((x) => ({ text: x }));
const SECTIONS = [
  { heading: "Experience", items: lines("Built a model", "Cut close time") },
  { heading: "Skills", items: lines("SQL", "Python") },
];
const RESUME_TEXT = "Jane Smith\nEXPERIENCE\n- Built a weekly reporting model\n- Cut close time by two days\nSKILLS\n- Writes SQL and Python daily";

async function mount(db: JobTrackerDB, to = "/resume") {
  const page = await mountPage(ResumePage, db, to);
  await waitFor(() => $(page.container, ".resume-view") !== null, "the page to load");
  return page;
}
const fields = (root: ParentNode, label: RegExp) => $$(root, "input, textarea").filter((e) => label.test(e.getAttribute("aria-label") ?? "")) as (HTMLInputElement | HTMLTextAreaElement)[];
const values = (root: ParentNode, label: RegExp) => fields(root, label).map((e) => e.value);
const cards = (c: HTMLElement) => $$(c, ".doc-card");
const card = (c: HTMLElement, title: string) => cards(c).find((x) => text($(x, "h2")) === title)!;

async function choose(container: HTMLElement, f: File) {
  const input = $(container, "input[type=file]") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitFor(() => $(container, ".notice.err") !== null || button(container, "Use the simple converter") !== null, "the file to be read");
  if (button(container, "Use the simple converter")) await click(button(container, "Use the simple converter"));   // no AI key here: the rule-based sections
}

describe("the Resume page with no master", () => {
  it("opens on the Resume section with the template first, then Upload a file and Paste text, and Your documents below with the Resumes tab selected", async () => {
    const db = freshDb();
    const { container } = await mount(db);
    expect(text($(container, "h1"))).toBe("Resume");
    const step = $(container, ".rs-section")!;
    expect(text($(step, "h2"))).toBe("Resume");
    expect(text($$(container, ".rs-section")[1])).toBe("JobAdd your resume first.");
    expect($$(container, ".rs-section")[1].querySelector("a")!.getAttribute("href")).toBe("#/resume");
    expect($(container, ".rs-split")).toBeNull();
    expect($$(step, "button").map(text)).toEqual(["Start from the template", "Upload a file", "Paste text"]);
    expect($(step, "button.primary")!.textContent).toBe("Start from the template");
    expect(text($(container, ".rs-docs > summary"))).toBe("Your documents");
    expect(($(container, ".rs-docs") as HTMLDetailsElement).open).toBe(false);
    const tabs = $$(container, "nav[aria-label=Show] a.tab");
    expect(tabs.map(text)).toEqual(["Resumes", "Cover letters", "Tailored"]);
    expect(tabs[0].getAttribute("aria-current")).toBe("true");
    const visible = $(container, ".resume-view:not([hidden])")!;
    expect(text(visible)).toBe("No master resume yet.");
    expect($$(visible, "button")).toHaveLength(0);
  });

  it("shows pasted text split into sections to check, and saves nothing until Save as master resume", async () => {
    const db = freshDb();
    const { container } = await mount(db);
    await click(button(container, "Paste text"));
    await type($(container, "#resume-paste"), RESUME_TEXT);
    await click(button(container, "Use this text"));
    await click(button(container, "Use the simple converter"));
    expect(values(container, /^Heading of section/)).toEqual(["Summary", "EXPERIENCE", "SKILLS"]);
    expect(values(container, /^Bullet \d of EXPERIENCE/)).toEqual(["Built a weekly reporting model", "Cut close time by two days"]);
    expect(await db.documents.count()).toBe(0);
    await type(fields(container, /^Bullet 1 of SKILLS/)[0], "Writes SQL, Python and R");
    await click(button(container, "Save as master resume"));
    await waitFor(() => $(container, "h2.section")?.textContent === "Master resume", "the master card");
    const master = (await getMaster(db))!;
    expect(master.source).toBe("paste");
    expect(master.sections.map((s) => s.heading)).toEqual(["Summary", "EXPERIENCE", "SKILLS"]);
    expect(master.sections[2].items[0].text).toBe("Writes SQL, Python and R");
  });

  it("can cancel the check without saving", async () => {
    const db = freshDb();
    const { container } = await mount(db);
    await click(button(container, "Paste text"));
    await type($(container, "#resume-paste"), RESUME_TEXT);
    await click(button(container, "Use this text"));
    await click(button(container, "Cancel"));
    expect(button(container, "Save as master resume")).toBeNull();
    expect(button(container, "Upload a file")).not.toBeNull();
    expect(await db.documents.count()).toBe(0);
  });

  it("asks for text when the paste box is empty", async () => {
    const { container } = await mount(freshDb());
    await click(button(container, "Paste text"));
    await click(button(container, "Use this text"));
    expect(text($(container, ".notice.err"))).toBe("Paste some text first.");
  });

  // A PDF goes the same way, but pdf.js can't run under jsdom: read-pdf.test.ts covers it.
  it("reads a text file and a Word file into the check", async () => {
    for (const f of [file("r.txt", RESUME_TEXT), file("r.docx", makeDocx(RESUME_TEXT.split("\n")))]) {
      const db = freshDb();
      const { container } = await mount(db);
      await choose(container, f);
      expect(values(container, /^Heading of section/).length).toBeGreaterThan(1);
      expect(await db.documents.count()).toBe(0);
      await cleanup();
    }
  });

  it("says why a scanned file or another file type can't be read, and stays on the empty state", async () => {
    const db = freshDb();
    const { container } = await mount(db);
    await choose(container, file("scan.txt", "Jane"));
    expect(text($(container, ".notice.err"))).toBe("This looks like a scanned file. Paste the text instead.");
    await choose(container, file("resume.pages", "x".repeat(100)));
    expect(text($(container, ".notice.err"))).toBe("Upload a PDF, Word (.docx) or text file.");
    expect(button(container, "Save as master resume")).toBeNull();
  });
});

describe("the master resume editor", () => {
  async function withMaster() {
    const db = freshDb();
    await saveMaster(db, SECTIONS, "paste");
    const page = await mount(db);
    return { db, ...page };
  }

  it("shows the master as an editor card with Replace with a file and Paste text", async () => {
    const { container } = await withMaster();
    const master = card(container, "Master resume");
    expect(values(master, /^Heading/)).toEqual(["Experience", "Skills"]);
    expect($$(master, "button").map(text)).toEqual(expect.arrayContaining(["Replace with a file", "Paste text", "Add section", "Save", "Make a version"]));
    expect(($$(master, "button").find((b) => text(b) === "Save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves edits only when Save is pressed, then says Saved", async () => {
    const { db, container } = await withMaster();
    const master = card(container, "Master resume");
    await type(fields(master, /^Line 1 of Experience/)[0], "Built the reporting model");
    expect((await getMaster(db))!.sections[0].items[0].text).toBe("Built a model");
    await click(button(master, "Save"));
    await waitFor(() => text($(master, ".doc-status")) === "Saved", "Saved");
    expect((await getMaster(db))!.sections[0].items[0].text).toBe("Built the reporting model");
  });

  it("adds, moves and removes lines and sections", async () => {
    const { db, container } = await withMaster();
    const master = card(container, "Master resume");
    await click($$(master, "button").find((b) => text(b) === "Add line")!);
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    await type(document.activeElement, "Led a rollout");
    await click($(master, "[aria-label='Move line 3 up']"));
    expect(values(master, /^Line \d of Experience/)).toEqual(["Built a model", "Led a rollout", "Cut close time"]);
    await click($(master, "[aria-label='Move line 1 down']"));
    expect(values(master, /^Line \d of Experience/)).toEqual(["Led a rollout", "Built a model", "Cut close time"]);
    expect(($(master, "[aria-label='Move line 1 up']") as HTMLButtonElement).disabled).toBe(true);
    await click($(master, "[aria-label='Remove line 2']"));
    expect(values(master, /^Line \d of Experience/)).toEqual(["Led a rollout", "Cut close time"]);
    await click(button(master, "Add section"));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Heading of section 3");
    await type(document.activeElement, "Education");
    await type(fields(master, /^Line 1 of Education/)[0], "B.Com");
    await click($$(master, "button").filter((b) => text(b) === "Remove section")[1]);
    await click(button(master, "Save"));
    await waitFor(() => text($(master, ".doc-status")) === "Saved", "Saved");
    const saved = (await getMaster(db))!.sections;
    expect(saved.map((s) => s.heading)).toEqual(["Experience", "Education"]);
    expect(saved[0].items.map((i) => i.text)).toEqual(["Led a rollout", "Cut close time"]);
  });

  it("saves a bullet's label, a line changed to Job with its location, and clears them again", async () => {
    const { db, container } = await withMaster();
    const master = card(container, "Master resume");
    await type(master.querySelector("[aria-label='Type of line 1 of Experience']"), "bullet");
    await type(fields(master, /^Label of line 1 of Experience/)[0], "Reporting");
    await type(master.querySelector("[aria-label='Type of line 2 of Experience']"), "org");
    await type(fields(master, /^Location of line 2 of Experience/)[0], "Toronto, ON");
    await click(button(master, "Save"));
    await waitFor(() => text($(master, ".doc-status")) === "Saved", "Saved");
    const saved = (await getMaster(db))!.sections[0].items;
    expect(saved[0]).toMatchObject({ text: "Built a model", kind: "bullet", label: "Reporting" });
    expect(saved[1]).toMatchObject({ text: "Cut close time", kind: "org", right: "Toronto, ON" });
    await type(master.querySelector("[aria-label='Type of line 2 of Experience']"), "");
    expect(button(master, "Save")!.hasAttribute("disabled")).toBe(false);
    await click(button(master, "Save"));
    await waitFor(() => button(master, "Save")!.hasAttribute("disabled"), "Save to finish");
    const cleared = (await getMaster(db))!.sections[0].items[1];
    expect(cleared.kind).toBeUndefined();
    expect(cleared.right).toBeUndefined();
    expect(cleared.text).toBe("Cut close time");
  });

  it("can discard what you changed", async () => {
    const { db, container } = await withMaster();
    const master = card(container, "Master resume");
    await type(fields(master, /^Heading of section 1/)[0], "Work");
    await click(button(master, "Discard changes"));
    expect(values(master, /^Heading/)).toEqual(["Experience", "Skills"]);
    expect((await getMaster(db))!.sections[0].heading).toBe("Experience");
  });

  it("keeps unsaved edits when you switch to Cover letters and back", async () => {
    const db = freshDb();
    await saveMaster(db, SECTIONS, "paste");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const props = (q: string): PageProps => ({ db, user, params: {}, query: new URLSearchParams(q), navigate: () => {} });
    const show = async (q: string) => {
      await act(async () => root.render(createElement(ResumePage, props(q))));
      await settle();
    };
    await show("");
    await settle();
    await type(fields(container, /^Heading of section 1/)[0], "Work history");
    await show("tab=cover");
    expect($$(container, ".resume-view").map((v) => v.hasAttribute("hidden"))).toEqual([true, false, true]);
    await show("");
    expect($$(container, ".resume-view").map((v) => v.hasAttribute("hidden"))).toEqual([false, true, true]);
    expect(values(container, /^Heading of section 1/)).toEqual(["Work history"]);
    await act(async () => root.unmount());
    container.remove();
  });

  it("replaces the master by reading text: nothing changes until Save as master resume", async () => {
    const { db, container } = await withMaster();
    await click(button(container, "Paste text"));
    await type($(container, "#resume-paste"), RESUME_TEXT);
    await click(button(container, "Use this text"));
    await click(button(container, "Use the simple converter"));
    expect(text($(container, "h2.section"))).toBe("Replace your master resume");
    expect((await getMaster(db))!.sections.map((s) => s.heading)).toEqual(["Experience", "Skills"]);
    await click(button(container, "Save as master resume"));
    await waitFor(() => $(container, "h2.section")?.textContent === "Master resume", "the card");
    expect((await getMaster(db))!.sections).toHaveLength(3);
    expect(await db.documents.count()).toBe(1);
  });

  it("links Print to the print view", async () => {
    const { db, container } = await withMaster();
    const id = (await getMaster(db))!.id;
    expect($$(card(container, "Master resume"), "a").find((a) => text(a) === "Print")!.getAttribute("href")).toBe(`#/resume/print/${id}`);
  });
});

describe("resume versions", () => {
  async function seed() {
    const db = freshDb();
    const master = await saveMaster(db, SECTIONS, "paste");
    const data = await createVersion(db, { title: "Resume for data roles", sections: SECTIONS, basedOn: master, source: "copy" });
    const product = await createVersion(db, { title: "Resume for product roles", sections: SECTIONS, basedOn: master, source: "copy" });
    for (const company of ["Acme", "Globex"]) await db.applications.update(await addApp(db, company), { resumeId: data });
    const gone = await addApp(db, "Initech");
    await db.applications.update(gone, { resumeId: data, deletedAt: "2026-11-01T00:00:00Z" });
    const page = await mount(db);
    return { db, master, data, product, ...page };
  }

  it("lists a card per version with how many live applications used it, linking to the filtered list", async () => {
    const { container, data, product } = await seed();
    const d = card(container, "Resume for data roles");
    expect(text($(d, ".doc-used"))).toBe("Used for 2 applications");
    expect($(d, ".doc-used a")!.getAttribute("href")).toBe(`#/?resume=${data}`);
    const p = card(container, "Resume for product roles");
    expect(text($(p, ".doc-used"))).toBe("Used for 0 applications");
    expect($(p, ".doc-used a")).toBeNull();
    expect($$(p, "a").find((a) => text(a) === "Print")!.getAttribute("href")).toBe(`#/resume/print/${product}`);
  });

  it("makes a version from the master after asking for a title", async () => {
    const { db, master, container } = await seed();
    await click(button(container, "Make a version"));
    await type($(container, "#version-name"), "Resume for ops roles");
    await click(button(container, "Make version"));
    await waitFor(() => cards(container).some((c) => text($(c, "h2")) === "Resume for ops roles"), "the new card");
    const made = (await liveResumes(db)).find((d) => d.title === "Resume for ops roles")!;
    expect(made).toMatchObject({ master: false, basedOn: master, source: "copy" });
    expect(made.sections.map((s) => s.heading)).toEqual(["Experience", "Skills"]);
  });

  it("refuses a version past the limit, in the app's words", async () => {
    const { db, container } = await seed();
    for (let i = 2; i < MAX_RESUME_VERSIONS; i++) await createVersion(db, { title: `Extra ${i}`, sections: SECTIONS });
    await settle();
    await click(button(container, "Make a version"));
    await type($(container, "#version-name"), "One too many");
    await click(button(container, "Make version"));
    expect(text($(container, ".notice.err"))).toBe(`You can keep ${MAX_RESUME_VERSIONS} resume versions. Delete one to make another.`);
  });

  it("renames a version", async () => {
    const { db, data, container } = await seed();
    const d = card(container, "Resume for data roles");
    await click(button(d, "Rename"));
    await type($(d, "input[type=text]"), "Data and analytics");
    await click(button(d, "Save"));
    await waitFor(() => cards(container).some((c) => text($(c, "h2")) === "Data and analytics"), "the new name");
    expect((await db.documents.get(data))!.title).toBe("Data and analytics");
  });

  it("duplicates a version, based on it", async () => {
    const { db, data, container } = await seed();
    await click(button(card(container, "Resume for data roles"), "Duplicate"));
    await waitFor(() => cards(container).some((c) => text($(c, "h2")) === "Resume for data roles copy"), "the copy");
    const copy = (await liveResumes(db)).find((d) => d.title === "Resume for data roles copy")!;
    expect(copy).toMatchObject({ basedOn: data, source: "copy", master: false });
  });

  it("edits a version and saves it with Save", async () => {
    const { db, product, container } = await seed();
    const p = card(container, "Resume for product roles");
    await click(button(p, "Edit"));
    await type(fields(p, /^Line 1 of Skills/)[0], "Roadmaps and SQL");
    expect((await db.documents.get(product))!.sections[1].items[0].text).toBe("SQL");
    await click(button(p, "Save"));
    await waitFor(() => $(card(container, "Resume for product roles"), "textarea") === null, "the editor to close");
    expect((await db.documents.get(product))!.sections[1].items[0].text).toBe("Roadmaps and SQL");
  });

  it("deletes a version into Recently deleted after a confirmation, and keeps the master", async () => {
    const { db, data, container } = await seed();
    const d = card(container, "Resume for data roles");
    await click(button(d, "Delete"));
    expect(text($(d, ".inline-confirm-q"))).toBe("Delete this resume version?");
    await click(button(d, "Cancel"));
    expect((await db.documents.get(data))!.deletedAt).toBeUndefined();
    await click(button(d, "Delete"));
    await click($$(d, ".inline-confirm button").find((b) => text(b) === "Delete")!);
    await waitFor(() => !cards(container).some((c) => text($(c, "h2")) === "Resume for data roles"), "the card to go");
    expect((await db.documents.get(data))!.deletedAt).toBeTruthy();
    expect(text($(container, ".notice"))).toBe("Deleted Resume for data roles. It's in Recently deleted for 30 days.");
    expect(await getMaster(db)).toBeDefined();
  });
});

describe("cover letters", () => {
  it("shows a single line when there are none", async () => {
    const { container } = await mount(freshDb(), "/resume?tab=cover");
    const view = $(container, ".resume-view:not([hidden])")!;
    expect($$(view, "p").map(text)).toEqual(["No cover letters yet."]);
    expect(button(view, "Save")).toBeNull();
    expect($$(container, "nav[aria-label=Show] a.tab")[1].getAttribute("aria-current")).toBe("true");
  });

  it("lists live cover letters newest first, each linking to its application, and skips deleted ones", async () => {
    const db = freshDb();
    const acme = await addApp(db, "Acme", { role: "Analyst" });
    const globex = await addApp(db, "Globex", { role: "Data Engineer" });
    const initech = await addApp(db, "Initech");
    await saveCoverLetter(db, acme, [{ heading: "", items: lines("Dear Acme") }], "paste", new Date("2026-11-01T12:00:00"));
    await saveCoverLetter(db, globex, [{ heading: "", items: lines("Dear Globex") }], "paste", new Date("2026-11-04T12:00:00"));
    await saveCoverLetter(db, initech, [{ heading: "", items: lines("Dear Initech") }], "paste", new Date("2026-11-03T12:00:00"));
    await db.applications.update(initech, { deletedAt: "2026-11-05T00:00:00Z" });
    const { container } = await mount(db, "/resume?tab=cover");
    const rows = $$($(container, ".resume-view:not([hidden])")!, "li");
    expect(rows.map((r) => text($(r, ".doc-cover-title")))).toEqual(["Cover letter for Globex, Data Engineer", "Cover letter for Acme, Analyst"]);
    expect(text($(rows[0], "p"))).toBe("Globex · Data Engineer · Updated Nov 4");
    expect($(rows[0], ".doc-cover-title")!.getAttribute("href")).toBe(`#/app/${globex}`);
    expect($$(rows[0], "a").find((a) => text(a) === "Open")!.getAttribute("href")).toBe(`#/app/${globex}`);
    expect(button(rows[0], "Save")).toBeNull();
    expect($$(rows[0], "textarea")).toHaveLength(0);
  });
});

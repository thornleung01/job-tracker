import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResumePage from "../../../src/pages/resume";
import { documentText, textFilename } from "../../../src/pages/resume/PrintView";
import type { JobTrackerDB } from "../../../src/db/schema";
import { createVersion, deleteDocument, saveCoverLetter, saveMaster } from "../../../src/sync/documents";
import { $, $$, addApp, button, cleanup, click, freshDb, mountPage, text, waitFor } from "../applications/harness";

afterEach(cleanup);

const lines = (...t: string[]) => t.map((x) => ({ text: x }));
const SECTIONS = [
  { heading: "Experience", items: lines("Built a model", "Cut close time") },
  { heading: "Skills", items: lines("SQL", "Python") },
];

const open = (db: JobTrackerDB, id: string | number) => mountPage(ResumePage, db, `/resume/print/${id}`, { id: String(id) });

describe("the print view", () => {
  it("shows a resume as a one-column document: the title as the name line, headings, and lines as a list", async () => {
    const db = freshDb();
    const id = await createVersion(db, { title: "Resume for data roles", sections: SECTIONS });
    const { container } = await open(db, id);
    await waitFor(() => $(container, ".doc-sheet") !== null, "the document");
    expect(text($(container, "h1"))).toBe("Resume for data roles");
    expect($$(container, ".doc-sheet h2").map(text)).toEqual(["Experience", "Skills"]);
    expect($$(container, ".doc-sheet li").map(text)).toEqual(["Built a model", "Cut close time", "SQL", "Python"]);
    expect($$(container, "button").map(text)).toEqual(["Print or save as PDF", "Download as text"]);
    expect($(container, "nav")).toBeNull();
  });

  it("works for the master resume", async () => {
    const db = freshDb();
    const master = await saveMaster(db, SECTIONS, "paste");
    const first = await open(db, master);
    await waitFor(() => $(first.container, ".doc-sheet") !== null);
    expect(text($(first.container, "h1"))).toBe("Master resume");
  });

  it("prints a cover letter as paragraphs", async () => {
    const db = freshDb();
    const app = await addApp(db, "Acme", { role: "Analyst" });
    const letter = await saveCoverLetter(db, app, [{ heading: "", items: lines("Dear hiring team,", "I'd like to apply.") }], "paste");
    const { container } = await open(db, letter);
    await waitFor(() => $(container, ".doc-sheet") !== null);
    expect($$(container, ".doc-sheet p").map(text)).toEqual(["Dear hiring team,", "I'd like to apply."]);
    expect($$(container, ".doc-sheet li, .doc-sheet h2")).toHaveLength(0);
    expect($(container, "h1")!.classList.contains("sr")).toBe(true);
  });

  it("prints with the browser's print dialog", async () => {
    const db = freshDb();
    const id = await saveMaster(db, SECTIONS, "paste");
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const { container } = await open(db, id);
    await waitFor(() => button(container, "Print or save as PDF") !== null);
    await click(button(container, "Print or save as PDF"));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("downloads the text with a file name made from the title", async () => {
    const db = freshDb();
    const id = await createVersion(db, { title: "Resume for data roles", sections: SECTIONS });
    let blob: Blob | undefined;
    URL.createObjectURL = (b: Blob | MediaSource) => {
      blob = b as Blob;
      return "blob:test";
    };
    URL.revokeObjectURL = () => {};
    const saved: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    const { container } = await open(db, id);
    await waitFor(() => button(container, "Download as text") !== null);
    await click(button(container, "Download as text"));
    expect(saved).toEqual(["resume-for-data-roles.txt"]);
    const body = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(blob!);
    });
    expect(body).toBe("Resume for data roles\n\nExperience\nBuilt a model\nCut close time\n\nSkills\nSQL\nPython\n");
  });

  it.each([["a document that was never there", "9999"], ["a deleted one", "deleted"], ["a word", "abc"], ["a fraction", "1.5"]])("says one line for %s", async (_what, id) => {
    const db = freshDb();
    const gone = await createVersion(db, { title: "Old", sections: SECTIONS });
    await deleteDocument(db, gone);
    const { container } = await open(db, id === "deleted" ? gone : id);
    await waitFor(() => $$(container, "p").some((p) => text(p) === "That document isn't there any more."), "the message");
    expect($(container, ".doc-sheet")).toBeNull();
    expect($$(container, "button")).toHaveLength(0);
  });
});

describe("text export helpers", () => {
  it("makes a plain file name from any title", () => {
    expect(textFilename("Resume for Acme, Analyst")).toBe("resume-for-acme-analyst.txt");
    expect(textFilename("  !!! ")).toBe("document.txt");
    expect(textFilename("Résumé pour données")).toBe("résumé-pour-données.txt");
    expect(textFilename("x".repeat(200)).length).toBeLessThanOrEqual(64);
  });
  it("starts a resume with its title and leaves a letter as just its words", () => {
    const sections = [{ id: "a", heading: "", items: [{ id: "b", text: "Dear team" }] }];
    expect(documentText({ kind: "resume", title: "R", sections })).toBe("R\n\nDear team\n");
    expect(documentText({ kind: "cover", title: "C", sections })).toBe("Dear team\n");
  });
});

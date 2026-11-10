import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResumePage from "../../../src/pages/resume";
import { createElement } from "react";
import { documentText, PrintView, textFilename } from "../../../src/pages/resume/PrintView";
import { CLASSIC_LINE_PX, PRINTABLE_HEIGHT_PX, PRINT_WIDTH_PX, measureSheetHeight, pageVerdict, pageVerdictText } from "../../../src/pages/resume/onepage";
import type { PageProps } from "../../../src/app/pageProps";
import type { JobTrackerDB } from "../../../src/db/schema";
import { createVersion, deleteDocument, saveCoverLetter, saveMaster, updateDocument } from "../../../src/sync/documents";
import { $, $$, addApp, button, cleanup, click, freshDb, mountPage, settle, text, waitFor } from "../applications/harness";

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

const TEMPLATE = [
  { heading: "Header", items: lines("JORDAN LEE", "Toronto, Ontario | (416) 555-0100", "jordan.lee@example.com") },
  { heading: "Professional summary", items: lines("Analyst with 5 years of experience.") },
  { heading: "Skills and qualifications", items: [{ text: "SQL, Python", kind: "skill" as const, label: "Analytics" }] },
  {
    heading: "Work experience",
    items: [
      { text: "Northfield Bank", kind: "org" as const, right: "Toronto, Ontario" },
      { text: "Senior Analyst", kind: "title" as const, right: "2025 – Present" },
      { text: "Built a model.", kind: "bullet" as const, label: "Reporting" },
      { text: "Led a rollout.", kind: "bullet" as const, label: "Dashboards" },
      { text: "Analyst", kind: "title" as const, right: "2023 – 2025" },
      { text: "Wrote pipelines.", kind: "bullet" as const },
    ],
  },
  { heading: "Education", items: [{ text: "Demo University", kind: "school" as const, right: "Toronto, Ontario" }, ...lines("Bachelor of Commerce, 2021")] },
];

describe("the classic template", () => {
  const show = async (sections: unknown, measure?: (el: HTMLElement) => number) => {
    const db = freshDb();
    const id = await createVersion(db, { title: "Resume for data roles", sections });
    const Page = (p: PageProps) => createElement(PrintView, { db: p.db, id: String(id), measure });
    const { container } = await mountPage(Page, db, `/resume/print/${id}`);
    await waitFor(() => $(container, ".doc-sheet") !== null, "the document");
    return container;
  };

  it("is only on a resume, so a cover letter keeps the plain layout", async () => {
    const container = await show(TEMPLATE);
    expect($(container, ".doc-sheet")!.classList.contains("classic")).toBe(true);
    const db = freshDb();
    const app = await addApp(db, "Acme");
    const letter = await saveCoverLetter(db, app, [{ heading: "", items: lines("Dear team,") }], "paste");
    const other = await open(db, letter);
    await waitFor(() => $(other.container, ".doc-sheet") !== null);
    expect($(other.container, ".doc-sheet")!.classList.contains("classic")).toBe(false);
  });

  it("centers the header: the first line is the name, the rest are the contact lines", async () => {
    const container = await show(TEMPLATE);
    expect(text($(container, "h1"))).toBe("JORDAN LEE");
    expect($$(container, ".doc-contact p").map(text)).toEqual(["Toronto, Ontario | (416) 555-0100", "jordan.lee@example.com"]);
    expect($$(container, ".doc-sheet h2").map(text)).toEqual(["Professional summary", "Skills and qualifications", "Work experience", "Education"]);
    expect($$(container, "h1")).toHaveLength(1);
  });

  it("lays out summary, skills, jobs, titles, bullets and schools", async () => {
    const container = await show(TEMPLATE);
    const paragraphs = $$(container, ".doc-block p");
    const skill = paragraphs.find((p) => $(p, "strong"))!;
    expect(paragraphs.filter((p) => p !== skill).map(text)).toEqual(["Analyst with 5 years of experience.", "Bachelor of Commerce, 2021"]);
    expect(text(skill)).toBe("Analytics: SQL, Python");
    expect(text($(skill, "strong"))).toBe("Analytics:");
    const orgs = $$(container, ".doc-org");
    expect(orgs.map((o) => $$(o, "strong").map(text))).toEqual([["Northfield Bank", "Toronto, Ontario"], ["Demo University", "Toronto, Ontario"]]);
    const titles = $$(container, ".doc-title");
    expect(titles.map((t) => $$(t, "em").map(text))).toEqual([["Senior Analyst", "2025 – Present"], ["Analyst", "2023 – 2025"]]);
    expect($$(container, ".doc-bullets li").map(text)).toEqual(["Reporting: Built a model.", "Dashboards: Led a rollout.", "Wrote pipelines."]);
    expect($$(container, ".doc-bullets li strong").map(text)).toEqual(["Reporting:", "Dashboards:"]);
    expect($$(container, ".doc-bullets")).toHaveLength(2);
  });

  it("leaves a row's right side out when it has none, and keeps several plain lines as a list", async () => {
    const container = await show([
      { heading: "Work experience", items: [{ text: "Acme", kind: "org" }] },
      { heading: "Other", items: lines("One", "Two") },
    ]);
    expect($$(container, ".doc-org strong")).toHaveLength(1);
    expect($$(container, ".doc-sheet li").map(text)).toEqual(["One", "Two"]);
  });

  it("says it fits one page when the measured height does", async () => {
    const fits = await show(TEMPLATE, () => 900);
    await waitFor(() => $(fits, ".doc-fit") !== null, "the status");
    expect(text($(fits, ".doc-fit"))).toBe("Fits one page");
  });

  it("says how many lines it runs over one page", async () => {
    const over = await show(TEMPLATE, () => 960 + 17.5 * 3);
    await waitFor(() => $(over, ".doc-fit") !== null, "the status");
    expect(text($(over, ".doc-fit"))).toBe("About 3 lines over one page");
  });

  it("says nothing about pages for a cover letter", async () => {
    const db = freshDb();
    const app = await addApp(db, "Acme");
    const letter = await saveCoverLetter(db, app, [{ heading: "", items: lines("Dear team,") }], "paste");
    const Page = (p: PageProps) => createElement(PrintView, { db: p.db, id: String(letter), measure: () => 5000 });
    const { container } = await mountPage(Page, db, `/resume/print/${letter}`);
    await waitFor(() => $(container, ".doc-sheet") !== null);
    expect($(container, ".doc-fit")).toBeNull();
  });
});

describe("the one-page verdict", () => {
  it("fits when the content is no taller than the page", () => {
    expect(pageVerdict(960, 960, 17.5)).toEqual({ fits: true, overByLines: 0 });
    expect(pageVerdict(0, 960, 17.5)).toEqual({ fits: true, overByLines: 0 });
    expect(pageVerdict(Number.NaN, 960, 17.5)).toEqual({ fits: true, overByLines: 0 });
  });
  it("counts the overflow in lines, rounding up and never saying 0 lines over", () => {
    expect(pageVerdict(961, 960, 17.5)).toEqual({ fits: false, overByLines: 1 });
    expect(pageVerdict(960 + 35, 960, 17.5)).toEqual({ fits: false, overByLines: 2 });
    expect(pageVerdict(960 + 36, 960, 17.5)).toEqual({ fits: false, overByLines: 3 });
  });
  it("words the result", () => {
    expect(pageVerdictText({ fits: true, overByLines: 0 })).toBe("Fits one page");
    expect(pageVerdictText({ fits: false, overByLines: 1 })).toBe("About 1 line over one page");
    expect(pageVerdictText({ fits: false, overByLines: 4 })).toBe("About 4 lines over one page");
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

/** The text file the Download as text button saves. */
async function downloadedText(container: HTMLElement): Promise<string> {
  let blob: Blob | undefined;
  URL.createObjectURL = (b: Blob | MediaSource) => {
    blob = b as Blob;
    return "blob:test";
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await click(button(container, "Download as text"));
  return new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsText(blob!);
  });
}

const showResume = async (sections: unknown, measure?: (el: HTMLElement) => number) => {
  const db = freshDb();
  const id = await createVersion(db, { title: "Resume for data roles", sections });
  const Page = (p: PageProps) => createElement(PrintView, { db: p.db, id: String(id), measure });
  const { container } = await mountPage(Page, db, `/resume/print/${id}`);
  await waitFor(() => $(container, ".doc-sheet") !== null, "the document");
  return container;
};

describe("a classic resume's text file and its edge cases", () => {
  it("downloads the lines the way the sheet shows them: labels, locations and dates", async () => {
    const container = await showResume(TEMPLATE);
    const body = await downloadedText(container);
    expect(body.startsWith("Resume for data roles\n\nHeader\nJORDAN LEE\n")).toBe(true);
    expect(body).toContain("Analytics: SQL, Python");
    expect(body).toContain("Reporting: Built a model.");
    expect(body).toContain("Northfield Bank, Toronto, Ontario");
    expect(body).toContain("Senior Analyst 2025 – Present");
    expect(body).toContain("Demo University, Toronto, Ontario");
    expect(body.endsWith("Bachelor of Commerce, 2021\n")).toBe(true);
  });

  it("uses the resume's title as the name when there is no Header section", async () => {
    const container = await showResume([{ heading: "Experience", items: [{ text: "Acme", kind: "org" }] }]);
    expect(text($(container, "h1"))).toBe("Resume for data roles");
    expect($(container, ".doc-contact")).toBeNull();
    expect($$(container, ".doc-sheet h2").map(text)).toEqual(["Experience"]);
  });

  it("takes a header that is only a name, with an empty contact line", async () => {
    const container = await showResume([{ heading: "Header", items: lines("JORDAN LEE") }, { heading: "Skills", items: lines("SQL") }]);
    expect(text($(container, "h1"))).toBe("JORDAN LEE");
    expect($$(container, ".doc-contact p")).toHaveLength(0);
    expect($$(container, ".doc-sheet h2").map(text)).toEqual(["Skills"]);
  });

  it("finds the header whatever its case, and leaves the Header section out of the sections", async () => {
    const container = await showResume([{ heading: " header ", items: lines("JORDAN LEE", "Toronto") }, { heading: "Skills", items: lines("SQL") }]);
    expect(text($(container, "h1"))).toBe("JORDAN LEE");
    expect($$(container, ".doc-contact p").map(text)).toEqual(["Toronto"]);
    expect($$(container, ".doc-sheet h2").map(text)).toEqual(["Skills"]);
  });

  it("lists bullets that come before any organization", async () => {
    const container = await showResume([{ heading: "Work experience", items: [
      { text: "Led a rollout.", kind: "bullet", label: "Dashboards" },
      { text: "Acme", kind: "org", right: "Toronto" },
    ] }]);
    const block = $(container, ".doc-block")!;
    expect($(block, "h2")!.nextElementSibling!.matches("ul.doc-bullets")).toBe(true);
    expect($$(block, ".doc-bullets li").map(text)).toEqual(["Dashboards: Led a rollout."]);
    expect(block.lastElementChild!.classList.contains("doc-org")).toBe(true);
  });

  it("shows a skill with no label as just its text", async () => {
    const container = await showResume([{ heading: "Skills", items: [{ text: "SQL, Python", kind: "skill" }] }]);
    const p = $(container, ".doc-block p")!;
    expect(text(p)).toBe("SQL, Python");
    expect($(p, "strong")).toBeNull();
  });

  it("leaves a title's and an org's right side out when it has none", async () => {
    const container = await showResume([{ heading: "Work experience", items: [{ text: "Acme", kind: "org" }, { text: "Analyst", kind: "title" }] }]);
    expect($$(container, ".doc-org strong")).toHaveLength(1);
    expect($$(container, ".doc-title em")).toHaveLength(1);
    expect($$(container, ".doc-right")).toHaveLength(0);
  });

  it("shows a bullet with an empty text and only a label", async () => {
    const container = await showResume([{ heading: "Work experience", items: [{ text: "", kind: "bullet", label: "Reporting" }] }]);
    expect($$(container, ".doc-bullets li").map(text)).toEqual(["Reporting:"]);
  });
});

describe("measureSheetHeight", () => {
  const sheet = () => {
    const el = document.createElement("article");
    el.className = "doc-sheet classic";
    el.innerHTML = "<h1>JORDAN LEE</h1><p>Plain</p>";
    document.body.append(el);
    return el;
  };
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("measures a hidden copy at the print width and the print type size, then removes it", () => {
    const el = sheet();
    const appended: HTMLElement[] = [];
    const append = document.body.append.bind(document.body);
    vi.spyOn(document.body, "append").mockImplementation((...nodes: (Node | string)[]) => {
      appended.push(...(nodes as HTMLElement[]));
      append(...nodes);
    });
    const before = document.body.children.length;
    // jsdom has no layout, so the height is 0 and the verdict is "fits"
    const height = measureSheetHeight(el);
    expect(height).toBe(0);
    expect(pageVerdict(height, PRINTABLE_HEIGHT_PX, CLASSIC_LINE_PX).fits).toBe(true);
    expect(appended).toHaveLength(1);
    const copy = appended[0];
    expect(copy).not.toBe(el);
    expect(copy.textContent).toBe(el.textContent);
    expect(copy.style.width).toBe(`${PRINT_WIDTH_PX}px`);
    expect(copy.style.fontSize).toBe("14px");
    expect(copy.style.position).toBe("absolute");
    expect(copy.style.visibility).toBe("hidden");
    expect(copy.style.padding).toBe("0px");
    expect(copy.style.maxWidth).toBe("none");
    // the narrow-screen type scaling in print.css (--classic-fs) must not leak into the measure
    expect(copy.style.getPropertyValue("--classic-fs")).toBe("10.5pt");
    expect(document.body.children.length).toBe(before);
    expect(copy.isConnected).toBe(false);
    // the real sheet is untouched
    expect(el.getAttribute("style")).toBeNull();
  });

  it("removes the copy even when measuring throws", () => {
    const el = sheet();
    const before = document.body.children.length;
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { throw new Error("no layout"); } });
    try {
      expect(() => measureSheetHeight(el)).toThrow("no layout");
    } finally {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", original);
    }
    expect(document.body.children.length).toBe(before);
  });
});

describe("the one-page status as the document and fonts change", () => {
  const roots: { root: Root; container: HTMLElement }[] = [];
  const fontsDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");
  afterEach(async () => {
    for (const { root, container } of roots.splice(0)) {
      await act(async () => root.unmount());
      container.remove();
    }
    if (fontsDescriptor) Object.defineProperty(document, "fonts", fontsDescriptor);
    else delete (document as unknown as { fonts?: unknown }).fonts;
  });
  const stubFonts = (ready: Promise<unknown>) => Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });

  /** Renders the print view directly, so a test can unmount it. */
  async function render(db: JobTrackerDB, id: number, measure: (el: HTMLElement) => number) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push({ root, container });
    await act(async () => root.render(createElement(PrintView, { db, id: String(id), measure })));
    await waitFor(() => $(container, ".doc-sheet") !== null, "the document");
    await settle();
    return { container, root };
  }

  it("measures again once the fonts are ready and shows the new verdict", async () => {
    const db = freshDb();
    const id = await createVersion(db, { title: "Resume", sections: TEMPLATE });
    let release!: () => void;
    stubFonts(new Promise<void>((resolve) => { release = resolve; }));
    let height = 900;
    const { container } = await render(db, id, () => height);
    expect(text($(container, ".doc-fit"))).toBe("Fits one page");
    height = 960 + CLASSIC_LINE_PX * 2;
    await act(async () => { release(); });
    await waitFor(() => text($(container, ".doc-fit")) === "About 2 lines over one page", "the status after fonts load");
  });

  it("ignores the fonts arriving after the view is gone", async () => {
    const db = freshDb();
    const id = await createVersion(db, { title: "Resume", sections: TEMPLATE });
    let release!: () => void;
    stubFonts(new Promise<void>((resolve) => { release = resolve; }));
    let calls = 0;
    const { root } = await render(db, id, () => { calls += 1; return 900; });
    const measured = calls;
    await act(async () => root.unmount());
    await act(async () => { release(); });
    await settle();
    expect(calls).toBe(measured);
  });

  it("updates the status when the document changes after an edit", async () => {
    const db = freshDb();
    const id = await createVersion(db, { title: "Resume", sections: TEMPLATE });
    // a stand-in for layout: each bullet is 100px tall
    const { container } = await render(db, id, (el) => el.querySelectorAll(".doc-bullets li").length * 100);
    expect(text($(container, ".doc-fit"))).toBe("Fits one page");
    const more = Array.from({ length: 12 }, (_, n) => ({ text: `Did thing ${n}`, kind: "bullet" as const }));
    await updateDocument(db, id, { sections: [{ heading: "Work experience", items: more }] });
    await waitFor(() => /over one page/.test(text($(container, ".doc-fit"))), "the status after the edit");
    expect(text($(container, ".doc-fit"))).toBe(`About ${Math.ceil((1200 - 960) / CLASSIC_LINE_PX)} lines over one page`);
  });
});

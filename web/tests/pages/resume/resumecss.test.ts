// @vitest-environment node
// The test runner empties imported CSS, so this reads the stylesheets as text.
import { describe, expect, it } from "vitest";
import { PRINTABLE_HEIGHT_PX, PRINT_WIDTH_PX } from "../../../src/components/documents/onepage";

const NODE_FS = "node:fs";

async function css(path: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync(url: URL, enc: string): string };
  return fs.readFileSync(new URL(`../../../src/${path}`, import.meta.url), "utf8");
}

describe("the split's stylesheet", () => {
  it("keeps focused content clear of the sticky bar with scroll padding the bar's own height sets", async () => {
    const text = await css("pages/resume/split.css");
    expect(text).toMatch(/html:has\(\.rs-bar\)\s*\{[^}]*scroll-padding-bottom:\s*calc\(var\(--rs-bar-h/);
  });
});

const SHEETS = ["pages/resume/resume.css", "pages/resume/print.css", "components/documents/resumesheet.css", "components/documents/sectionseditor.css", "components/documents/documents.css", "pages/resume/convert.css"];

describe.each(SHEETS)("%s", (sheet) => {
  it("uses the app's tokens: no hex colours, no tabular-nums, no underlines, no !important", async () => {
    const text = (await css(sheet)).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(text).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(text).not.toContain("tabular-nums");
    expect(text).not.toMatch(/text-decoration:\s*underline/);
    expect(text).not.toContain("!important");
  });
});

describe("the print stylesheet", () => {
  it("scopes its block rules under .doc-sheet and has no uppercase", async () => {
    const text = (await css("pages/resume/print.css")).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(text).not.toMatch(/(^|\n)\s*\.doc-block/);
    expect(text).not.toMatch(/text-transform:\s*uppercase/);
  });

  it("keeps every classic sheet rule under .doc-sheet.classic, and allows uppercase only there", async () => {
    const text = (await css("components/documents/resumesheet.css")).replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
    expect(rules.some((r) => /text-transform:\s*uppercase/.test(r.body))).toBe(true);
    for (const r of rules) expect(r.selector.split(",").every((x) => x.trim().startsWith(".doc-sheet.classic")), r.selector).toBe(true);
  });

  it("sets a serif letter page with half-inch margins for the classic template only", async () => {
    const text = [await css("pages/resume/print.css"), await css("components/documents/resumesheet.css")].join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
    const body = (selector: string) => rules.filter((r) => r.selector === selector).map((r) => r.body).join(" ");
    expect(body("@page classic")).toMatch(/size:\s*letter/);
    expect(body("@page classic")).toMatch(/margin:\s*0\.5in/);
    expect(body(".doc-sheet.classic")).toMatch(/page:\s*classic/);
    expect(text).toMatch(/--classic-font:[^;}]*"Times New Roman"[^;}]*serif/);
    expect(body(".doc-sheet.classic")).toMatch(/font:[^;}]*var\(--classic-font\)/);
    expect(body(".doc-sheet.classic .doc-row")).toMatch(/display:\s*flex/);
    expect(body(".doc-sheet.classic .doc-row")).toMatch(/justify-content:\s*space-between/);
  });

  it("draws the classic bullets as solid discs of about 1em and puts 10pt above each heading", async () => {
    const text = (await css("components/documents/resumesheet.css")).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(text).toMatch(/\.doc-bullets li::before\s*\{[^}]*font-size:\s*1em/);
    expect(text).toMatch(/\.doc-block h2\s*\{[^}]*margin:\s*10pt 0 3pt/);
  });

  it("agrees with onepage.ts on the page: letter minus the @page classic margin", async () => {
    const text = (await css("pages/resume/print.css")).replace(/\/\*[\s\S]*?\*\//g, "");
    const margin = /@page classic\s*\{[^}]*margin:\s*([\d.]+)in/.exec(text);
    expect(margin).not.toBeNull();
    const inches = Number(margin![1]);
    expect(PRINTABLE_HEIGHT_PX).toBe((11 - 2 * inches) * 96);
    expect(PRINT_WIDTH_PX).toBe((8.5 - 2 * inches) * 96);
  });

  it("scopes the one-page status under .doc-print", async () => {
    const text = (await css("pages/resume/print.css")).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(text).not.toMatch(/(^|\n)\s*\.doc-fit/);
    expect(text).toMatch(/\.doc-print \.doc-fit\s*\{/);
  });

  it("hides the app's header, banners and buttons only while a document is shown", async () => {
    const text = await css("pages/resume/print.css");
    const print = text.slice(text.indexOf("@media print"));
    expect(print).toContain(".wrap:has(.doc-print) > :not(main) { display: none; }");
    expect(print).toContain("main:has(.doc-print) > :not(.doc-print) { display: none; }");
    expect(print).toContain(".doc-print-bar { display: none; }");
    expect(print).toContain(".skip { display: none; }");
  });

  it("is black on white in a system font with no card shadow, and sets page margins", async () => {
    const text = await css("pages/resume/print.css");
    const print = text.slice(text.indexOf("@media print"));
    expect(print).toMatch(/body:has\(\.doc-print\) \{[^}]*background: white; color: black; font: [^}]*system-ui/);
    expect(print).toMatch(/\.doc-sheet \{[^}]*box-shadow: none/);
    expect(text).toMatch(/@page \{ margin: \d+mm; \}/);
  });
});

describe("the editor stylesheet", () => {
  it("keeps every rule under .doc-editor, so the Resume page and the detail page can share it", async () => {
    const text = (await css("components/documents/sectionseditor.css")).replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...text.matchAll(/(^|\n|\{|\})\s*([^@{}\n][^{}]*)\{/g)].map((m) => m[2].trim());
    expect(selectors.length).toBeGreaterThan(5);
    for (const sel of selectors) expect(sel.startsWith(".doc-editor"), sel).toBe(true);
  });
});

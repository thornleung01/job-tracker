// @vitest-environment node
// The test runner empties imported CSS, so this reads the stylesheets as text.
import { describe, expect, it } from "vitest";

const NODE_FS = "node:fs";

async function css(path: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync(url: URL, enc: string): string };
  return fs.readFileSync(new URL(`../../../src/${path}`, import.meta.url), "utf8");
}

const SHEETS = ["pages/resume/resume.css", "pages/resume/print.css", "components/documents/sectionseditor.css", "components/documents/documents.css"];

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
  it("scopes its block rules under .doc-sheet, and allows uppercase only in the classic template", async () => {
    const text = (await css("pages/resume/print.css")).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(text).not.toMatch(/(^|\n)\s*\.doc-block/);
    const rules = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
    const upper = rules.filter((r) => /text-transform:\s*uppercase/.test(r.body));
    expect(upper.length).toBeGreaterThan(0);
    for (const r of upper) expect(r.selector.startsWith(".doc-sheet.classic"), r.selector).toBe(true);
  });

  it("sets a serif letter page with half-inch margins for the classic template only", async () => {
    const text = await css("pages/resume/print.css");
    expect(text).toMatch(/@page classic \{ size: letter; margin: 0\.5in; \}/);
    expect(text).toMatch(/\.doc-sheet\.classic \{[^}]*page: classic/);
    expect(text).toMatch(/\.doc-sheet\.classic \{[^}]*"Times New Roman"[^}]*serif/);
    expect(text).toMatch(/\.doc-sheet\.classic \.doc-row \{[^}]*display: flex; justify-content: space-between/);
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

describe("the phone nav", () => {
  it("clips the full label instead of removing it, so the link keeps its accessible name", async () => {
    const text = await css("styles/base.css");
    const phone = text.slice(text.indexOf("@media (max-width: 520px)"));
    expect(phone).toMatch(/nav a \.nav-full \{[^}]*clip-path: inset\(50%\)/);
    expect(phone).not.toMatch(/\.nav-full \{[^}]*display: none/);
    expect(phone).toMatch(/nav a \.nav-short \{ display: inline; \}/);
    expect(text).toMatch(/nav a \.nav-short \{ display: none; \}/);
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

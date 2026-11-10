// @vitest-environment node
// The test runner empties imported CSS, so this reads the stylesheet as text.
import { describe, expect, it } from "vitest";

const NODE_FS = "node:fs";
async function css(): Promise<string> {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync(url: URL, enc: string): string };
  return fs.readFileSync(new URL("../../../src/components/documents/pageeditor.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The rules inside the @media print block. */
const printBlock = (text: string) => text.slice(text.indexOf("@media print"));

describe("pageeditor.css", () => {
  it("uses the app's tokens: no hex colours, no underlines, no !important", async () => {
    const text = await css();
    expect(text).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(text).not.toMatch(/text-decoration:\s*underline/);
    expect(text).not.toContain("!important");
  });

  it("hides the controls, the add rows, the status line and the placeholders in print", async () => {
    const print = printBlock(await css());
    expect(print).toMatch(/\.pe-controls[^{}]*,?[^{}]*\{[^}]*display:\s*none/);
    expect(print).toMatch(/\.pe-add\b[^{}]*\{[^}]*display:\s*none/);
    expect(print).toContain(".pe-status");
    expect(print).toMatch(/::placeholder\s*\{\s*color:\s*transparent/);
  });

  it("shows the controls on hover and focus-within, and always on a phone, with 44px hit areas", async () => {
    const text = await css();
    expect(text).toMatch(/\.pe-line:hover > \.pe-controls/);
    expect(text).toMatch(/\.pe-line:focus-within > \.pe-controls/);
    const phone = text.slice(text.indexOf("@media (max-width: 720px), (hover: none)"));
    expect(phone).toMatch(/\.pe-controls\s*\{[^}]*opacity:\s*1/);
    expect(phone).toMatch(/\.pe-addbtn\s*\{[^}]*min-height:\s*44px/);
    expect(text).toMatch(/\.pe-ctl\s*\{[^}]*width:\s*44px;\s*height:\s*44px/);
    expect(text).toMatch(/\.pe-addbtn::after\s*\{[^}]*top:\s*-8px;[^}]*bottom:\s*-8px/);
  });

  it("leaves no gap between a line and its controls, so the hover survives the move", async () => {
    const text = await css();
    expect(text).not.toMatch(/calc\(100% \+ \d+px\)/);
    expect(text).toMatch(/\.pe-controls::before\s*\{[^}]*content:\s*""/);
  });

  it("puts the controls in the margin only when the editor is 900px wide or more, else on the line", async () => {
    const text = await css();
    expect(text).toMatch(/\.page-editor\s*\{\s*container:\s*pe \/ inline-size/);
    const wide = text.slice(text.indexOf("@container pe (min-width: 900px)"));
    expect(wide).toMatch(/\.pe-controls\s*\{[^}]*left:\s*100%/);
    // the base rule keeps them inside the line's right edge
    expect(text.slice(0, text.indexOf("@container"))).toMatch(/\.pe-controls\s*\{[^}]*right:\s*0/);
  });

  it("uses 16px type on a phone so fields never zoom the page, and sizes fields with field-sizing", async () => {
    const text = await css();
    expect(text).toMatch(/@media \(max-width: 720px\)\s*\{[^@]*--classic-fs:\s*16px/);
    expect(text).toContain("field-sizing: content");
  });

  it("sizes the right-hand field to its text, never shrunk, and keeps the add row out of the flow so spacing matches the read-only sheet", async () => {
    const text = await css();
    expect(text).toMatch(/input\.pe-right\s*\{[^}]*flex:\s*none/);
    expect(text).toMatch(/input\.pe-right \{ field-sizing: content/);
    expect(text).toMatch(/\.doc-row > \.pe-grow\s*\{[^}]*min-width:\s*0/);
    const base = text.slice(0, text.indexOf("@media (max-width: 720px), (hover: none)"));
    expect(base).toMatch(/\.pe-add\s*\{[^}]*position:\s*absolute/);
    expect(text.slice(text.indexOf("@media (max-width: 720px), (hover: none)"))).toMatch(/\.pe-add\s*\{[^}]*position:\s*static/);
  });
});

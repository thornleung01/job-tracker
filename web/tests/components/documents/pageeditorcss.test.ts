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

  it("shows the controls on hover and focus-within, and always on a phone", async () => {
    const text = await css();
    expect(text).toMatch(/\.pe-line:hover > \.pe-controls/);
    expect(text).toMatch(/\.pe-line:focus-within > \.pe-controls/);
    const phone = text.slice(text.indexOf("@media (max-width: 720px), (hover: none)"));
    expect(phone).toMatch(/\.pe-controls\s*\{[^}]*opacity:\s*1/);
    expect(phone).toMatch(/\.pe-ctl\s*\{[^}]*width:\s*44px;\s*height:\s*44px/);
  });

  it("uses 16px type on a phone so fields never zoom the page, and sizes fields with field-sizing", async () => {
    const text = await css();
    expect(text).toMatch(/@media \(max-width: 720px\)\s*\{[^@]*--classic-fs:\s*16px/);
    expect(text).toContain("field-sizing: content");
  });
});

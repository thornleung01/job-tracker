// @vitest-environment node
// The test runner empties imported CSS, so this reads the stylesheet as text.
import { expect, it } from "vitest";

const NODE_FS = "node:fs";

async function css(path: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync(url: URL, enc: string): string };
  return fs.readFileSync(new URL(`../../../src/${path}`, import.meta.url), "utf8");
}

it("never underlines or uses tabular numbers", async () => {
  const text = await css("components/calendar/calendar.css");
  expect(text).not.toMatch(/text-decoration:\s*underline/);
  expect(text).not.toMatch(/tabular-nums/);
});

it("has forced-colors rules that turn the selected day, today and focus into outlines", async () => {
  const text = await css("components/calendar/calendar.css");
  const block = text.slice(text.indexOf("@media (forced-colors: active)"));
  expect(block).toContain("@media (forced-colors: active)");
  expect(block).toMatch(/aria-selected="true"\][^}]*outline: 2px solid Highlight/);
  expect(block).toMatch(/aria-current="date"\][^}]*outline: 2px solid CanvasText/);
  expect(block).toMatch(/:focus-visible[^}]*outline/);
});

it("animates only under prefers-reduced-motion: no-preference", async () => {
  const text = await css("components/calendar/calendar.css");
  const outside = text.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/, "");
  expect(text).toContain("@media (prefers-reduced-motion: no-preference)");
  expect(outside).not.toMatch(/transition|animation/);
});

it("draws the focus ring inside the cell and sizes controls from --tap, with no new colour tokens", async () => {
  const text = await css("components/calendar/calendar.css");
  expect(text).toMatch(/\.cal-cell:focus-visible \{ outline: 2px solid var\(--ink\); outline-offset: -2px; \}/);
  expect(text).toMatch(/\.cal-nav button[^{]*\{ min-height: var\(--tap\)/);
  expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(text).not.toMatch(/--[a-z-]+\s*:/);   // it defines no custom properties of its own
});

it("uses the shared screen-reader clip pattern", async () => {
  const text = await css("components/calendar/calendar.css");
  expect(text).toContain(".cal-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%);");
});

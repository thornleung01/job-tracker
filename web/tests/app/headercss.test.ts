// @vitest-environment node
// The test runner empties imported CSS, so this reads the stylesheets as text.
import { expect, it } from "vitest";

const NODE_FS = "node:fs";

async function css(path: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync(url: URL, enc: string): string };
  return fs.readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
}

/** The body of the first `@media (max-width: 720px)` block that mentions `needle`. */
function phoneBlock(text: string, needle: string): string {
  const starts = [...text.matchAll(/@media \(max-width: 720px\) \{/g)].map((m) => m.index! + m[0].length);
  for (const at of starts) {
    let depth = 1;
    let i = at;
    while (depth && i < text.length) depth += text[i] === "{" ? 1 : text[i] === "}" ? -1 : 0, i++;
    const body = text.slice(at, i - 1);
    if (body.includes(needle)) return body;
  }
  throw new Error(`no phone block with ${needle}`);
}

it("makes the stage tabs one horizontally scrollable row on a phone, with no scrollbar clutter", async () => {
  const body = phoneBlock(await css("pages/applications/applications.css"), ".stage-tabs");
  const row = body.match(/\.tabs\.stage-tabs \{[^}]*\}/)![0];
  expect(row).toContain("flex-wrap: nowrap");
  expect(row).toContain("overflow-x: auto");
  expect(row).toContain("scrollbar-width: none");
  expect(body).toMatch(/\.stage-tabs::-webkit-scrollbar \{ display: none; \}/);
  // every tab keeps its size and stays on the line
  expect(body).toMatch(/\.stage-tabs \.tab \{[^}]*flex: none/);
  // padding and a matching negative margin leave room for the keyboard focus ring inside the clipped strip
  expect(row).toMatch(/padding: 3px/);
  expect(row).toMatch(/margin: -3px/);
});

it("lays the filter card out as a two-column grid on a phone, so it is short", async () => {
  const body = phoneBlock(await css("pages/applications/applications.css"), "form.filters");
  expect(body).toMatch(/form\.filters \{ display: grid; grid-template-columns: 1fr 1fr;/);
});

it("lets the demo banner and the backup reminder share a line, and wrap as whole rows when they don't fit", async () => {
  for (const [file, rule] of [["app/app.css", ".local-banner"], ["backup/backup.css", ".backup-nudge"]] as const) {
    const text = await css(file);
    const block = text.match(new RegExp(`\\${rule} \\{[^}]*\\}`))![0];
    expect(block, file).toContain("display: inline-flex");
    expect(block, file).toContain("flex-wrap: wrap");
  }
});

it("keeps the new layout rules on tokens, with no underlines or hard-coded colours", async () => {
  for (const file of ["pages/applications/applications.css", "components/goal/goal.css", "components/savedviews/savedviews.css", "backup/backup.css", "app/app.css"]) {
    const text = await css(file);
    expect(text, file).not.toMatch(/text-decoration:\s*underline/);
    expect(text, file).not.toMatch(/tabular-nums/);
    expect(text, file).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b/);
  }
});

it("keeps the current saved-view chip readable: its colour out-ranks the running-text link colour", async () => {
  const text = await css("components/savedviews/savedviews.css");
  expect(text).toMatch(/\.view-chip \.view-chip-link\[aria-current="true"\] \{[^}]*color: var\(--bg\)/);
});

it("has a screen-reader-only class that stays in the accessibility tree", async () => {
  const rule = (await css("styles/base.css")).match(/\.sr-only \{[^}]*\}/)![0];
  expect(rule).toContain("position: absolute");
  expect(rule).not.toMatch(/display:\s*none|visibility:\s*hidden/);
});

// @vitest-environment node
// The test runner empties imported CSS, so this reads the stylesheets as text.
import { expect, it } from "vitest";

const NODE_FS = "node:fs";

async function css(path: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync(url: URL, enc: string): string };
  return fs.readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
}

it("gives primary buttons a fill before any script has run: the accent has a default", async () => {
  const root = (await css("styles/base.css")).match(/:root \{[^}]*\}/)![0];
  expect(root).toMatch(/--accent-l: #000000/);
  expect(root).toMatch(/--accent-d: #ffffff/);
});

it("sets a link in running text apart without an underline: full ink, weight 500, a tonal hover", async () => {
  const text = await css("styles/base.css");
  const rule = text.match(/:is\(p, li, \.notice, \.help, \.small, \.muted\) a:not\([^)]*\) \{[^}]*\}/)![0];
  expect(rule).toContain("color: var(--ink)");
  expect(rule).toContain("font-weight: 500");
  expect(text).toMatch(/a:not\([^)]*\):hover \{ background: var\(--hover\); \}/);
  // Buttons, the back link, the row expander and sort links keep their own look.
  for (const own of [".btn", ".back", ".expander", ".sort"]) expect(rule).toContain(own);
});

it("never underlines or uses tabular numbers", async () => {
  for (const file of ["styles/base.css", "components/components.css", "components/duplicates/duplicates.css", "components/inlineconfirm.css", "pages/signin/signin.css"]) {
    const text = await css(file);
    expect(text, file).not.toMatch(/text-decoration:\s*underline/);
    expect(text, file).not.toMatch(/tabular-nums/);
  }
});

it("styles the shell notice from the shared stylesheet, not from the Settings chunk", async () => {
  const base = await css("styles/base.css");
  expect(base).toContain(".notice > div > .line { margin: 0; }");
  expect(base).toContain(".notice:focus { outline: none; }");
});

it("keeps the quiet fills on tokens that flip in dark, not on black alpha", async () => {
  const base = await css("styles/base.css");
  expect(base).not.toMatch(/button\.quiet[^}]*rgba\(0,0,0/);
  expect(base).not.toMatch(/details\.action\[open\] > summary \{[^}]*rgba\(0,0,0/);
});

it("sizes the small controls from --tap-sm, which is 44px on touch", async () => {
  const base = await css("styles/base.css");
  expect(base).toMatch(/--tap-sm: calc\(var\(--tap\) - 8px\)/);
  expect(base).toMatch(/pointer: coarse\) \{ :root, :root\[data-density="compact"\] \{ --tap: 44px; --tap-sm: 44px; \} \}/);
  for (const file of ["components/bulk/bulk.css", "components/quickedit/quickedit.css", "components/rounds/rounds.css", "components/components.css"]) {
    expect(await css(file), file).toContain("var(--tap-sm)");
  }
});

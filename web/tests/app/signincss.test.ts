// @vitest-environment node
// The test runner empties imported CSS, so this reads the stylesheet as text.
import { expect, it } from "vitest";

// No @types/node in this project, so reach fs through an untyped dynamic import.
const NODE_FS = "node:fs";

async function css(): Promise<string> {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync(url: URL, enc: string): string };
  return fs.readFileSync(new URL("../../src/pages/signin/signin.css", import.meta.url), "utf8");
}

it("has no underline anywhere, and the skip link is medium weight in the ink colour", async () => {
  const text = await css();
  expect(text).not.toMatch(/underline/);
  const skip = text.match(/\.signin-skip \{[^}]*\}/)![0];
  expect(skip).toContain("font-weight: 500");
  expect(skip).toContain("color: var(--ink)");
});

it("keeps the last-used Google ring visible in forced colours", async () => {
  expect(await css()).toMatch(/@media \(forced-colors: active\) \{ \.google-btn\.primary \{ outline: 2px solid; \} \}/);
});

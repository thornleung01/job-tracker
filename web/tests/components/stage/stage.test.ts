import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StageBadge, StageCell, stageClass } from "../../../src/components/StageBadge";
import { COLORS } from "../../../src/pages/flow/layout";

// vitest blanks stylesheets on import, so read the files themselves. (No @types/node here, hence the computed specifier.)
async function read(rel: string): Promise<string> {
  const fs = await import(/* @vite-ignore */ "node" + ":fs");
  return fs.readFileSync(`${(globalThis as unknown as { process: { cwd(): string } }).process.cwd()}/${rel}`, "utf8");
}

const STAGES = ["Applied", "Heard back", "Assessment", "Interview", "Offer", "Rejected"] as const;
const slug = (s: string) => s.toLowerCase().replace(/ /g, "-");

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The stage variables declared in a block, e.g. { "stage-applied": "#5b88d9", ... }. */
function stageVars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--(stage-[\w-]+):\s*(#[0-9a-f]{6})/g)) out[m[1]] = m[2];
  return out;
}

/** The light map (:root), the system-dark map and the forced-dark map, cut out of base.css. */
function maps(css: string) {
  const light = css.slice(css.indexOf(":root {"), css.indexOf("@media (min-width: 721px)"));
  const media = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf(':root[data-theme="dark"] {'));
  const forced = css.slice(css.indexOf(':root[data-theme="dark"] {'), css.indexOf(':root[data-density="compact"]'));
  return { light: stageVars(light), media: stageVars(media), forced: stageVars(forced) };
}

describe("stage colour map", () => {
  it("defines the six graphic and six text colours once per theme, and both dark blocks agree", async () => {
    const { light, media, forced } = maps(await read("src/styles/base.css"));
    const names = STAGES.flatMap((s) => [`stage-${slug(s)}`, `stage-${slug(s)}-text`]);
    for (const m of [light, media, forced]) expect(Object.keys(m).sort()).toEqual([...names].sort());
    expect(media).toEqual(forced);
  });

  it("uses the Wealthsimple data-viz hues for the graphics", async () => {
    const { light, forced } = maps(await read("src/styles/base.css"));
    expect([light["stage-applied"], light["stage-heard-back"], light["stage-assessment"], light["stage-interview"]]).toEqual(["#5b88d9", "#b27ee4", "#e47eca", "#eece2d"]);
    expect([light["stage-offer"], light["stage-rejected"]]).toEqual(["#409652", "#e22b18"]);
    expect([forced["stage-offer"], forced["stage-rejected"]]).toEqual(["#4db565", "#ed4f3c"]);
  });

  it("holds every text colour to 4.5:1, on the page surface and on the tinted rows behind it", async () => {
    const { light, forced } = maps(await read("src/styles/base.css"));
    // surface, hover, open row, and the badge tint (the 5% / 7% fog) over the surface
    const grounds = { light: ["#fafafa", "#ffffff", "#ebebeb", "#e0e0e0"], dark: ["#171717", "#1f1f1f", "#0f0f0f", "#2f2f2f"] };
    for (const s of STAGES) {
      for (const g of grounds.light) expect(ratio(light[`stage-${slug(s)}-text`], g), `${s} text on ${g}`).toBeGreaterThanOrEqual(4.5);
      for (const g of grounds.dark) expect(ratio(forced[`stage-${slug(s)}-text`], g), `${s} text on ${g}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps each text colour in the hue family of its graphic", async () => {
    const { light, forced } = maps(await read("src/styles/base.css"));
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (x * 60 + 360) % 360;
    };
    for (const m of [light, forced]) for (const s of STAGES) expect(Math.abs(hue(m[`stage-${slug(s)}`]) - hue(m[`stage-${slug(s)}-text`])), s).toBeLessThan(12);
  });

  it("gives Flow the same variables the list uses", () => {
    for (const s of STAGES) expect(COLORS[s]).toBe(`var(--stage-${slug(s)})`);
  });

  it("styles the stage badge as a 14px/500 word with a colour dot, no grey pill", async () => {
    const css = await read("src/styles/base.css");
    expect(css).toMatch(/\.badge:is\([^)]*\) \{[^}]*padding: 0; background: none; font-size: 0\.875rem/);
    expect(css).toMatch(/\.badge:is\([^)]*\)::before \{[^}]*background: var\(--st\)/);
    for (const s of STAGES) expect(css).toContain(`--st: var(--stage-${slug(s)}); --st-text: var(--stage-${slug(s)}-text);`);
  });
});

describe("StageBadge and StageCell", () => {
  it("keeps the class contract and puts nothing but the stage word in the badge", () => {
    expect(stageClass("Heard back")).toBe("Heard-back");
    expect(renderToStaticMarkup(h(StageBadge, { stage: "Heard back" }))).toBe('<span class="badge Heard-back">Heard back</span>');
  });

  it("notes a stage you set by hand", () => {
    expect(renderToStaticMarkup(h(StageCell, { stage: "Offer", locked: true }))).toContain("set by you");
    expect(renderToStaticMarkup(h(StageCell, { stage: "Offer", locked: false }))).not.toContain("set by you");
  });
});

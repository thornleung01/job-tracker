// Where the AI code may import from, read from the source files themselves, plus the small shared constants.
import { describe, expect, it } from "vitest";
import { AI_MESSAGES, AI_MODELS, CHECK_MODEL, DEFAULT_MAX_TOKENS, isAiModel } from "../../src/ai";

const sources = import.meta.glob(["../../src/ai/*.ts", "../../src/sync/convert.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const source = (name: string): string => {
  const entry = Object.entries(sources).find(([path]) => path.endsWith(name));
  if (!entry) throw new Error(`no source for ${name}`);
  return entry[1];
};
/** The module names of the file's import and export-from lines. */
const importsOf = (name: string): { from: string; typeOnly: boolean }[] =>
  [...source(name).matchAll(/^(?:import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gms)].map((m) => ({ from: m[2], typeOnly: Boolean(m[1]) }));

describe("layering", () => {
  it("ai/verify.ts doesn't import from sync/", () => {
    expect(importsOf("ai/verify.ts").filter((i) => i.from.includes("sync/"))).toEqual([]);
  });

  it("no file in ai/ imports from sync/ or a page", () => {
    for (const path of Object.keys(sources).filter((p) => p.includes("/src/ai/"))) {
      const name = path.slice(path.indexOf("ai/"));
      expect(importsOf(name).filter((i) => /sync\/|pages\/|components\//.test(i.from)), name).toEqual([]);
    }
  });

  it("sync/convert.ts has no database access: it imports no database module at run time", () => {
    const runtime = importsOf("sync/convert.ts").filter((i) => !i.typeOnly).map((i) => i.from);
    expect(runtime.length).toBeGreaterThan(0);
    for (const from of runtime) expect(from).not.toMatch(/db\/schema|db\/db|dexie|db\/open|\/sync\/(?!convert)/);
    expect(source("sync/convert.ts")).not.toMatch(/\bdb\.\w+\.(get|put|add|where|toArray)/);
  });

  it("sync/convert.ts reaches the AI code through one entry point", () => {
    const aiImports = importsOf("sync/convert.ts").filter((i) => i.from.includes("ai"));
    expect(aiImports.map((i) => i.from)).toEqual(["../ai"]);
  });
});

describe("shared constants", () => {
  it("CHECK_MODEL is the cheapest listed model", () => {
    expect(isAiModel(CHECK_MODEL)).toBe(true);
    expect(AI_MODELS.find((m) => m.id === CHECK_MODEL)?.note).toBe("Cheaper");
  });

  it("has a workspace sentence for keys that aren't tied to a workspace", () => {
    expect(AI_MESSAGES.workspaceKey).toBe("That key isn't tied to a workspace. Create one inside a workspace in the Anthropic console.");
  });

  it("has a positive reply budget", () => {
    expect(DEFAULT_MAX_TOKENS).toBeGreaterThan(0);
  });
});

// @vitest-environment node
// rules.json is generated from jobtracker/rules.yaml (scripts/build_rules_json.py); this fails when they drift apart.
import { expect, it } from "vitest";
import { parse } from "yaml";
import rulesJson from "../../src/pipeline/rules.json";

// No @types/node in this project, so reach fs through an untyped dynamic import.
const NODE_FS = "node:fs";

it("rules.json matches jobtracker/rules.yaml (run scripts/build_rules_json.py to refresh)", async () => {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync(url: URL, enc: string): string };
  const yaml = fs.readFileSync(new URL("../../../jobtracker/rules.yaml", import.meta.url), "utf8");
  expect(rulesJson).toEqual(parse(yaml));
});

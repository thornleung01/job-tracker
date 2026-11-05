import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import fixture from "../fixtures/site-config.empty.json";

describe("the test build's site config", () => {
  it("gets the empty fixture in place of the real web/site-config.json", () => {
    // src/config.ts imports ../site-config.json, which vite.config.ts aliases to the fixture while testing.
    // If the alias broke, an ID committed to site-config.json would show up here as source "file".
    expect(fixture).toEqual({ googleClientId: "", msClientId: "" });
    expect(config.source).toEqual({ google: "none", microsoft: "none" });
  });
});

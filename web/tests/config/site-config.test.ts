// The deploy workflow runs `npm test`, so a malformed ID committed to web/site-config.json stops the deploy here.
import { describe, expect, it } from "vitest";
// Two levels up, so the test alias for src/config.ts's "../site-config.json" doesn't apply: this is the real file.
import real from "../../site-config.json";
import { isGoogleClientId, isMsClientId } from "../../src/config";

describe("web/site-config.json", () => {
  it("has exactly the two ID keys, each empty or a valid ID", () => {
    const file = real as Record<string, unknown>;
    expect(Object.keys(file).sort()).toEqual(["googleClientId", "msClientId"]);
    expect(typeof file.googleClientId).toBe("string");
    expect(typeof file.msClientId).toBe("string");
    expect(file.googleClientId === "" || isGoogleClientId(file.googleClientId as string)).toBe(true);
    expect(file.msClientId === "" || isMsClientId(file.msClientId as string)).toBe(true);
  });
});

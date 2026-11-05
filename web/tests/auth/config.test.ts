import { describe, expect, it } from "vitest";
import { configJsonText, isGoogleClientId, isMsClientId, loadConfig } from "../../src/config";

const GOOGLE_ID = "1234567890-abc123def456.apps.googleusercontent.com";
const MS_ID = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";

describe("loadConfig", () => {
  it("builds the redirect URI from origin and base path", () => {
    const c = loadConfig({ BASE_URL: "/job-tracker/", VITE_GOOGLE_CLIENT_ID: "g", VITE_MS_CLIENT_ID: "m" }, "https://thornleung01.github.io");
    expect(c.redirectUri).toBe("https://thornleung01.github.io/job-tracker/");
    expect(c.googleClientId).toBe("g");
    expect(c.msClientId).toBe("m");
  });

  it("leaves client IDs empty when unset", () => {
    const c = loadConfig({ BASE_URL: "/" }, "http://localhost:5173");
    expect(c.googleClientId).toBe("");
    expect(c.redirectUri).toBe("http://localhost:5173/");
  });

  it("asks for the narrow mail scopes only", () => {
    const c = loadConfig({ BASE_URL: "/" }, "http://localhost");
    expect(c.googleMailScope).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(c.msMailScopes).toEqual(["Mail.Read"]);
    expect(c.msLoginScopes).toEqual(["openid", "profile", "email"]);
  });

  it("reports where each ID came from", () => {
    const none = loadConfig({ BASE_URL: "/" }, "http://localhost");
    expect(none.source).toEqual({ google: "none", microsoft: "none" });
    const file = loadConfig({ BASE_URL: "/" }, "http://localhost", { googleClientId: GOOGLE_ID, msClientId: MS_ID });
    expect(file.googleClientId).toBe(GOOGLE_ID);
    expect(file.msClientId).toBe(MS_ID);
    expect(file.source).toEqual({ google: "file", microsoft: "file" });
    const build = loadConfig({ BASE_URL: "/", VITE_GOOGLE_CLIENT_ID: "g" }, "http://localhost", { msClientId: MS_ID });
    expect(build.source).toEqual({ google: "build", microsoft: "file" });
  });

  it("lets a build value win over the file, even an unchecked one", () => {
    const c = loadConfig({ VITE_GOOGLE_CLIENT_ID: "g", VITE_MS_CLIENT_ID: "m" }, "http://localhost", { googleClientId: GOOGLE_ID, msClientId: MS_ID });
    expect(c.googleClientId).toBe("g");
    expect(c.msClientId).toBe("m");
    expect(c.source).toEqual({ google: "build", microsoft: "build" });
  });

  it("falls back to the file when the build value is empty", () => {
    const c = loadConfig({ VITE_GOOGLE_CLIENT_ID: "" }, "http://localhost", { googleClientId: GOOGLE_ID });
    expect(c.googleClientId).toBe(GOOGLE_ID);
    expect(c.source.google).toBe("file");
  });

  it("ignores a malformed file value and says so", () => {
    const c = loadConfig({}, "http://localhost", { googleClientId: "not-an-id", msClientId: "1234" });
    expect(c.googleClientId).toBe("");
    expect(c.msClientId).toBe("");
    expect(c.source).toEqual({ google: "invalid", microsoft: "invalid" });
  });

  it("ignores a file that isn't an object, or values that aren't strings", () => {
    expect(loadConfig({}, "http://localhost", null).source).toEqual({ google: "none", microsoft: "none" });
    expect(loadConfig({}, "http://localhost", "x").source).toEqual({ google: "none", microsoft: "none" });
    expect(loadConfig({}, "http://localhost", { googleClientId: 5, msClientId: null }).source).toEqual({ google: "none", microsoft: "none" });
  });

  it("checks the ID formats", () => {
    expect(isGoogleClientId(GOOGLE_ID)).toBe(true);
    for (const bad of ["", "abc.apps.googleusercontent.com", "123-abc.apps.googleusercontent.com.evil.test", "123-ABC.apps.googleusercontent.com", " 123-abc.apps.googleusercontent.com", MS_ID]) {
      expect(isGoogleClientId(bad)).toBe(false);
    }
    expect(isMsClientId(MS_ID)).toBe(true);
    expect(isMsClientId(MS_ID.toUpperCase())).toBe(true);
    for (const bad of ["", "g", MS_ID + "0", MS_ID.slice(1), `{${MS_ID}}`, GOOGLE_ID]) expect(isMsClientId(bad)).toBe(false);
  });

  it("writes site-config.json as two-space JSON with a trailing newline", () => {
    expect(configJsonText({ googleClientId: GOOGLE_ID, msClientId: "" })).toBe(`{\n  "googleClientId": "${GOOGLE_ID}",\n  "msClientId": ""\n}\n`);
  });

  it("never reads IDs from the URL or storage", () => {
    window.history.replaceState(null, "", `/?VITE_GOOGLE_CLIENT_ID=${GOOGLE_ID}&googleClientId=${GOOGLE_ID}#/?msClientId=${MS_ID}`);
    window.localStorage.setItem("googleClientId", GOOGLE_ID);
    window.sessionStorage.setItem("msClientId", MS_ID);
    const c = loadConfig({ BASE_URL: "/" }, window.location.origin);
    expect(c.googleClientId).toBe("");
    expect(c.msClientId).toBe("");
    expect(c.source).toEqual({ google: "none", microsoft: "none" });
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});

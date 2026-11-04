import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config";

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
});

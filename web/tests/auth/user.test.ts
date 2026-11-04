import { describe, expect, it } from "vitest";
import { dbNameFor, userFromClaims, userKey } from "../../src/auth/user";

const google = { iss: "https://accounts.google.com", sub: "1098765432" };
const ms = { iss: "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0", sub: "AbC_def-123" };

describe("user identity", () => {
  it("names the database jobtracker:{iss}:{sub}", () => {
    expect(dbNameFor(google)).toBe("jobtracker:https://accounts.google.com:1098765432");
    expect(userKey(google)).toBe("https://accounts.google.com:1098765432");
  });

  it("is stable for the same user", () => {
    expect(dbNameFor({ ...google })).toBe(dbNameFor(google));
  });

  it("never collides for different users", () => {
    const users = [
      google,
      { ...google, sub: "1098765433" },
      ms,
      { ...ms, sub: "other" },
      { iss: "https://login.microsoftonline.com/aaaaaaaa-6c67-4c5b-b112-36a304b66dad/v2.0", sub: ms.sub },
      { iss: "https://accounts.google.com", sub: ms.sub },
    ];
    const names = new Set(users.map(dbNameFor));
    expect(names.size).toBe(users.length);
  });

  it("separates the same sub under different issuers", () => {
    expect(dbNameFor({ iss: "https://accounts.google.com", sub: "42" })).not.toBe(dbNameFor({ iss: "https://login.microsoftonline.com/x/v2.0", sub: "42" }));
  });

  it("refuses ambiguous or empty identities", () => {
    expect(() => userKey({ iss: "https://accounts.google.com", sub: "a:b" })).toThrow();
    expect(() => userKey({ iss: "", sub: "x" })).toThrow();
    expect(() => userKey({ iss: "x", sub: "" })).toThrow();
  });

  it("builds a user from claims, falling back to preferred_username for email", () => {
    expect(userFromClaims("microsoft", { ...ms, preferred_username: "g@outlook.com", name: "G" })).toEqual({
      ...ms,
      provider: "microsoft",
      email: "g@outlook.com",
      name: "G",
    });
  });
});

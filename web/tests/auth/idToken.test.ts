import { describe, expect, it } from "vitest";
import { IdTokenError, MICROSOFT_ISSUER, randomNonce, validateIdToken } from "../../src/auth/idToken";
import { CLIENT_ID, MS_CLIENT_ID, MS_TENANT, NOW, NOW_SEC, googleClaims, makeJwt, msClaims } from "./helpers";

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"]; // generic fixture: Google-shaped claims
const opts = { issuers: GOOGLE_ISSUERS, audience: CLIENT_ID, nonce: "n-1", now: NOW };

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof IdTokenError) return e.code;
    throw e;
  }
  return "no error";
}

describe("validateIdToken", () => {
  it("accepts a good token and returns its claims", () => {
    const claims = validateIdToken(makeJwt(googleClaims()), opts);
    expect(claims.sub).toBe("1098765432");
    expect(claims.email).toBe("ada@example.com");
  });

  it("accepts Google's bare-host issuer form", () => {
    expect(() => validateIdToken(makeJwt(googleClaims({ iss: "accounts.google.com" })), opts)).not.toThrow();
  });

  it("decodes non-ASCII claims", () => {
    const claims = validateIdToken(makeJwt(googleClaims({ name: "Zoë Müller 山田" })), opts);
    expect(claims.name).toBe("Zoë Müller 山田");
  });

  it("rejects the wrong audience", () => {
    expect(codeOf(() => validateIdToken(makeJwt(googleClaims({ aud: "someone-else" })), opts))).toBe("audience");
  });

  it("accepts an audience list only when azp is this app", () => {
    const aud = [CLIENT_ID, "other"];
    expect(codeOf(() => validateIdToken(makeJwt(googleClaims({ aud, azp: CLIENT_ID })), opts))).toBe("no error");
    expect(codeOf(() => validateIdToken(makeJwt(googleClaims({ aud, azp: "other" })), opts))).toBe("audience");
  });

  it("rejects the wrong issuer", () => {
    expect(codeOf(() => validateIdToken(makeJwt(googleClaims({ iss: "https://evil.example.com" })), opts))).toBe("issuer");
    expect(codeOf(() => validateIdToken(makeJwt(googleClaims({ iss: "https://accounts.google.com.evil.example" })), opts))).toBe("issuer");
  });

  it("rejects an expired token but tolerates small clock skew", () => {
    expect(codeOf(() => validateIdToken(makeJwt(googleClaims({ exp: NOW_SEC - 3600 })), opts))).toBe("expired");
    expect(codeOf(() => validateIdToken(makeJwt(googleClaims({ exp: NOW_SEC - 30 })), opts))).toBe("no error");
    expect(codeOf(() => validateIdToken(makeJwt(googleClaims({ exp: NOW_SEC - 120 })), opts))).toBe("expired");
  });

  it("rejects a missing exp", () => {
    const claims = googleClaims();
    delete claims.exp;
    expect(codeOf(() => validateIdToken(makeJwt(claims), opts))).toBe("expired");
  });

  it("rejects a token that is not valid yet (nbf), with skew", () => {
    expect(codeOf(() => validateIdToken(makeJwt(googleClaims({ nbf: NOW_SEC + 3600 })), opts))).toBe("not-yet-valid");
    expect(codeOf(() => validateIdToken(makeJwt(googleClaims({ nbf: NOW_SEC + 30 })), opts))).toBe("no error");
  });

  it("rejects a bad or missing nonce", () => {
    expect(codeOf(() => validateIdToken(makeJwt(googleClaims({ nonce: "replayed" })), opts))).toBe("nonce");
    const claims = googleClaims();
    delete claims.nonce;
    expect(codeOf(() => validateIdToken(makeJwt(claims), opts))).toBe("nonce");
  });

  it("rejects alg none and other algorithms", () => {
    expect(codeOf(() => validateIdToken(makeJwt(googleClaims(), { alg: "none" }), opts))).toBe("alg");
    expect(codeOf(() => validateIdToken(makeJwt(googleClaims(), { alg: "HS256" }), opts))).toBe("alg");
  });

  it("rejects a missing subject", () => {
    expect(codeOf(() => validateIdToken(makeJwt(googleClaims({ sub: "" })), opts))).toBe("subject");
  });

  it("rejects malformed tokens", () => {
    expect(codeOf(() => validateIdToken("not-a-jwt", opts))).toBe("malformed");
    expect(codeOf(() => validateIdToken("a.b.c", opts))).toBe("malformed");
    expect(codeOf(() => validateIdToken("", opts))).toBe("malformed");
  });

  describe("Microsoft issuers", () => {
    const ms = { issuers: [MICROSOFT_ISSUER], audience: MS_CLIENT_ID, nonce: "n-1", now: NOW };

    it("accepts a v2.0 issuer for any tenant GUID", () => {
      expect(codeOf(() => validateIdToken(makeJwt(msClaims()), ms))).toBe("no error");
      expect(codeOf(() => validateIdToken(makeJwt(msClaims({ iss: `https://login.microsoftonline.com/${MS_TENANT.replace("9", "a")}/v2.0` })), ms))).toBe("no error");
    });

    it("rejects look-alike issuers", () => {
      for (const iss of [
        "https://login.microsoftonline.com/common/v2.0",
        `https://login.microsoftonline.com.evil.example/${MS_TENANT}/v2.0`,
        `https://evil.example/https://login.microsoftonline.com/${MS_TENANT}/v2.0`,
        `https://login.microsoftonline.com/${MS_TENANT}/v2.0/extra`,
        `https://sts.windows.net/${MS_TENANT}/`,
      ]) {
        expect(codeOf(() => validateIdToken(makeJwt(msClaims({ iss })), ms)), iss).toBe("issuer");
      }
    });
  });
});

describe("randomNonce", () => {
  it("is long, hex and different each time", () => {
    const a = randomNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomNonce()).not.toBe(a);
  });
});

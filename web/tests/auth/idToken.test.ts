import { describe, expect, it } from "vitest";
import { IdTokenError, MICROSOFT_ISSUER, randomNonce, validateIdToken } from "../../src/auth/idToken";
import { MS_CLIENT_ID, MS_TENANT, NOW, NOW_SEC, makeJwt, msClaims } from "./helpers";

// The one real caller is the Microsoft login, so the fixtures use the shipped issuer pattern and Microsoft-shaped claims.
const opts = { issuers: [MICROSOFT_ISSUER], audience: MS_CLIENT_ID, nonce: "n-1", now: NOW };

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
    const claims = validateIdToken(makeJwt(msClaims()), opts);
    expect(claims.sub).toBe("AAAAAAAAbbbbbbbbCCCCCC");
    expect(claims.preferred_username).toBe("grace@outlook.com");
  });

  it("decodes non-ASCII claims", () => {
    const claims = validateIdToken(makeJwt(msClaims({ name: "Zoë Müller 山田" })), opts);
    expect(claims.name).toBe("Zoë Müller 山田");
  });

  it("rejects the wrong audience", () => {
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ aud: "someone-else" })), opts))).toBe("audience");
  });

  it("accepts an audience list only when azp is this app", () => {
    const aud = [MS_CLIENT_ID, "other"];
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ aud, azp: MS_CLIENT_ID })), opts))).toBe("no error");
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ aud, azp: "other" })), opts))).toBe("audience");
  });

  it("rejects the wrong issuer", () => {
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ iss: "https://evil.example.com" })), opts))).toBe("issuer");
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ iss: "https://accounts.google.com" })), opts))).toBe("issuer");
  });

  it("rejects an expired token but tolerates small clock skew", () => {
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ exp: NOW_SEC - 3600 })), opts))).toBe("expired");
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ exp: NOW_SEC - 30 })), opts))).toBe("no error");
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ exp: NOW_SEC - 120 })), opts))).toBe("expired");
  });

  it("draws the expiry line exactly at the skew: a token is good until the last second of it", () => {
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ exp: NOW_SEC - 60 + 1 })), opts))).toBe("no error");
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ exp: NOW_SEC - 60 })), opts))).toBe("expired");
    // The skew can be set, and the same line moves with it.
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ exp: NOW_SEC - 5 + 1 })), { ...opts, skewSeconds: 5 }))).toBe("no error");
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ exp: NOW_SEC - 5 })), { ...opts, skewSeconds: 5 }))).toBe("expired");
  });

  it("rejects an exp that is text, not a number", () => {
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ exp: String(NOW_SEC + 3600) })), opts))).toBe("expired");
  });

  it("rejects a missing exp", () => {
    const claims = msClaims();
    delete claims.exp;
    expect(codeOf(() => validateIdToken(makeJwt(claims), opts))).toBe("expired");
  });

  it("rejects a token that is not valid yet (nbf), with skew", () => {
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ nbf: NOW_SEC + 3600 })), opts))).toBe("not-yet-valid");
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ nbf: NOW_SEC + 30 })), opts))).toBe("no error");
  });

  it("draws the not-before line exactly at the skew", () => {
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ nbf: NOW_SEC + 60 })), opts))).toBe("no error");
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ nbf: NOW_SEC + 60 + 1 })), opts))).toBe("not-yet-valid");
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ nbf: String(NOW_SEC) })), opts))).toBe("not-yet-valid");
  });

  it("rejects a bad or missing nonce", () => {
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ nonce: "replayed" })), opts))).toBe("nonce");
    const claims = msClaims();
    delete claims.nonce;
    expect(codeOf(() => validateIdToken(makeJwt(claims), opts))).toBe("nonce");
  });

  it("rejects alg none and other algorithms", () => {
    expect(codeOf(() => validateIdToken(makeJwt(msClaims(), { alg: "none" }), opts))).toBe("alg");
    expect(codeOf(() => validateIdToken(makeJwt(msClaims(), { alg: "HS256" }), opts))).toBe("alg");
  });

  it("rejects a missing subject, an empty one and one that is not text", () => {
    const claims = msClaims();
    delete claims.sub;
    expect(codeOf(() => validateIdToken(makeJwt(claims), opts))).toBe("subject");
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ sub: "" })), opts))).toBe("subject");
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ sub: 12 })), opts))).toBe("subject");
  });

  it("rejects several audiences when azp is missing, and accepts a single audience in a list", () => {
    const aud = [MS_CLIENT_ID, "other"];
    const claims = msClaims({ aud });
    delete claims.azp;
    expect(codeOf(() => validateIdToken(makeJwt(claims), opts))).toBe("audience");
    expect(codeOf(() => validateIdToken(makeJwt(msClaims({ aud: [MS_CLIENT_ID] })), opts))).toBe("no error");
  });

  it("does not check the signature: that is deliberate, the access token is what is verified (by tokeninfo or MSAL)", () => {
    const [head, body] = makeJwt(msClaims()).split(".");
    expect(codeOf(() => validateIdToken(`${head}.${body}.not-a-real-signature`, opts))).toBe("no error");
  });

  it("rejects malformed tokens", () => {
    expect(codeOf(() => validateIdToken("not-a-jwt", opts))).toBe("malformed");
    expect(codeOf(() => validateIdToken("a.b.c", opts))).toBe("malformed");
    expect(codeOf(() => validateIdToken("", opts))).toBe("malformed");
  });

  describe("Microsoft issuers", () => {
    it("accepts a v2.0 issuer for any tenant GUID", () => {
      expect(codeOf(() => validateIdToken(makeJwt(msClaims()), opts))).toBe("no error");
      expect(codeOf(() => validateIdToken(makeJwt(msClaims({ iss: `https://login.microsoftonline.com/${MS_TENANT.replace("9", "a")}/v2.0` })), opts))).toBe("no error");
    });

    it("rejects look-alike issuers", () => {
      for (const iss of [
        "https://login.microsoftonline.com/common/v2.0",
        `https://login.microsoftonline.com.evil.example/${MS_TENANT}/v2.0`,
        `https://evil.example/https://login.microsoftonline.com/${MS_TENANT}/v2.0`,
        `https://login.microsoftonline.com/${MS_TENANT}/v2.0/extra`,
        `https://sts.windows.net/${MS_TENANT}/`,
      ]) {
        expect(codeOf(() => validateIdToken(makeJwt(msClaims({ iss })), opts)), iss).toBe("issuer");
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

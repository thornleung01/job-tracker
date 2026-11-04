// Client-side ID token checks.
//
// LIMITATION: this does not verify the JWT signature. Nothing server-side trusts these tokens; the claims
// only pick a local IndexedDB namespace and a display name, and the token reaches us straight from the
// provider over TLS. Anyone who can tamper with it already controls this browser tab.
// TODO(signature): verify RS256 against the provider JWKS with WebCrypto. Microsoft's keys
// (login.microsoftonline.com/common/discovery/v2.0/keys) are already allowed by the CSP; Google's live on
// www.googleapis.com, which would need adding to connect-src in index.html.

export type IdTokenErrorCode =
  | "malformed"
  | "alg"
  | "issuer"
  | "audience"
  | "expired"
  | "not-yet-valid"
  | "nonce"
  | "subject";

export class IdTokenError extends Error {
  constructor(
    public readonly code: IdTokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IdTokenError";
  }
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nbf?: number;
  nonce?: string;
  azp?: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  [claim: string]: unknown;
}

export interface ValidateOptions {
  /** Exact issuer strings or patterns (Microsoft issuers embed the tenant id). */
  issuers: ReadonlyArray<string | RegExp>;
  audience: string;
  nonce: string;
  /** Epoch milliseconds; defaults to Date.now(). */
  now?: number;
  /** Clock skew tolerance, seconds. */
  skewSeconds?: number;
}

function b64urlToBytes(part: string): Uint8Array {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function parsePart(part: string, what: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new IdTokenError("malformed", `ID token ${what} is not valid`);
  }
}

export function decodeJwt(token: string): { header: Record<string, unknown>; claims: Record<string, unknown> } {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => p === "")) throw new IdTokenError("malformed", "ID token is malformed");
  return { header: parsePart(parts[0], "header"), claims: parsePart(parts[1], "payload") };
}

function issuerAllowed(iss: string, issuers: ReadonlyArray<string | RegExp>): boolean {
  return issuers.some((allowed) => (typeof allowed === "string" ? allowed === iss : allowed.test(iss)));
}

export function validateIdToken(token: string, opts: ValidateOptions): IdTokenClaims {
  const { header, claims } = decodeJwt(token);
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const skew = opts.skewSeconds ?? 60;

  if (header.alg !== "RS256") throw new IdTokenError("alg", "ID token must be signed with RS256");

  const { iss, sub, aud, exp, nbf, nonce, azp } = claims;
  if (typeof iss !== "string" || !issuerAllowed(iss, opts.issuers)) {
    throw new IdTokenError("issuer", "ID token was issued by an unexpected party");
  }
  if (typeof sub !== "string" || sub === "") throw new IdTokenError("subject", "ID token has no subject");

  const audiences = typeof aud === "string" ? [aud] : Array.isArray(aud) ? aud : [];
  if (!audiences.includes(opts.audience)) throw new IdTokenError("audience", "ID token is for a different app");
  if (audiences.length > 1 && azp !== opts.audience) {
    throw new IdTokenError("audience", "ID token has several audiences and was not authorized for this app");
  }

  if (typeof exp !== "number" || nowSec >= exp + skew) throw new IdTokenError("expired", "ID token has expired");
  if (nbf !== undefined && (typeof nbf !== "number" || nowSec + skew < nbf)) {
    throw new IdTokenError("not-yet-valid", "ID token is not valid yet");
  }

  if (typeof nonce !== "string" || nonce !== opts.nonce) throw new IdTokenError("nonce", "ID token nonce does not match");

  return claims as IdTokenClaims;
}

export const GOOGLE_ISSUERS: ReadonlyArray<string> = ["https://accounts.google.com", "accounts.google.com"];
/** Microsoft v2.0 issuer: personal accounts and every work or school tenant, always with a GUID tenant id. */
export const MICROSOFT_ISSUER = /^https:\/\/login\.microsoftonline\.com\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/v2\.0$/i;

export function randomNonce(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

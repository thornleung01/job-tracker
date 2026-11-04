export const CLIENT_ID = "client-123.apps.googleusercontent.com";
export const MS_CLIENT_ID = "11111111-2222-3333-4444-555555555555";
export const MS_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
export const NOW = 1_800_000_000_000;
export const NOW_SEC = NOW / 1000;

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Builds an unsigned test JWT; signatures are not checked client-side. */
export function makeJwt(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", typ: "JWT" }): string {
  return `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}.${b64url("sig")}`;
}

export function googleClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://accounts.google.com",
    sub: "1098765432",
    aud: CLIENT_ID,
    exp: NOW_SEC + 3600,
    iat: NOW_SEC,
    nonce: "n-1",
    email: "ada@example.com",
    name: "Ada Lovelace",
    ...over,
  };
}

export function msClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: `https://login.microsoftonline.com/${MS_TENANT}/v2.0`,
    sub: "AAAAAAAAbbbbbbbbCCCCCC",
    aud: MS_CLIENT_ID,
    exp: NOW_SEC + 3600,
    nonce: "n-1",
    preferred_username: "grace@outlook.com",
    name: "Grace Hopper",
    ...over,
  };
}

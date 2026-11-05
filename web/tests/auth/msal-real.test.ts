// The app's own MSAL settings (createMsalClient) run through the real library, with only the network and the pop-up window faked.
// The other Microsoft tests inject a fake client, so without this one the "tokens stay in memory" setting is never executed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMsalClient } from "../../src/auth/microsoft";
import { MS_CLIENT_ID, MS_TENANT, NOW_SEC, makeJwt } from "./helpers";

const REDIRECT = "http://localhost:3000/job-tracker/";
const AUTHORITY = "https://login.microsoftonline.com/common";
const OID = "00000000-0000-0000-66f3-3332eca7ea81";

const b64url = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** What Microsoft's endpoints would answer; every request is recorded. */
function fakeMicrosoftNetwork(nonceOf: () => string) {
  const urls: string[] = [];
  const base = `https://login.microsoftonline.com/${MS_TENANT}`;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = new URL(url).pathname;
    urls.push(path);
    if (path.endsWith("/.well-known/openid-configuration")) {
      return json({
        authorization_endpoint: `${base}/oauth2/v2.0/authorize`,
        token_endpoint: `${base}/oauth2/v2.0/token`,
        end_session_endpoint: `${base}/oauth2/v2.0/logout`,
        issuer: `${base}/v2.0`,
        jwks_uri: `${base}/discovery/v2.0/keys`,
      });
    }
    if (path.endsWith("/oauth2/v2.0/token")) {
      return json({
        token_type: "Bearer",
        scope: "openid profile email Mail.Read",
        expires_in: 3599,
        ext_expires_in: 3599,
        access_token: "eyJ.REAL-LIBRARY-ACCESS-TOKEN",
        refresh_token: "0.REAL-LIBRARY-REFRESH-TOKEN",
        id_token: makeJwt(
          { iss: `${base}/v2.0`, sub: "sub-1", aud: MS_CLIENT_ID, exp: NOW_SEC + 3600, iat: NOW_SEC, nbf: NOW_SEC, nonce: nonceOf(), oid: OID, tid: MS_TENANT, preferred_username: "grace@outlook.com", name: "Grace Hopper" },
        ),
        client_info: b64url({ uid: OID, utid: MS_TENANT }),
      });
    }
    throw new Error(`unexpected request in test: ${url}`);
  });
  return { fetchMock, urls };
}

/**
 * A pop-up that "lands" back on the app with an authorization code as soon as MSAL points it at Microsoft.
 * MSAL opens the window blank inside the click and navigates it with location.assign afterwards.
 */
function fakePopup(onNavigate: (authUrl: URL) => void) {
  const popup = {
    closed: false,
    focus() {},
    close() {
      popup.closed = true;
    },
    location: {
      href: "about:blank",
      hash: "",
      search: "",
      assign(url: string) {
        const authUrl = new URL(url);
        onNavigate(authUrl);
        const hash = `#code=AUTH-CODE&state=${authUrl.searchParams.get("state")}`;
        popup.location.href = REDIRECT + hash;
        popup.location.hash = hash;
      },
    },
  };
  vi.spyOn(window, "open").mockImplementation(() => popup as unknown as Window);
}

const storageContents = () =>
  [localStorage, sessionStorage].flatMap((s) => Array.from({ length: s.length }, (_, i) => `${s.key(i)}=${s.getItem(s.key(i)!)}`));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("the real MSAL client built from the app's settings", () => {
  it("logs in, refreshes and clears without writing anything to localStorage or sessionStorage", async () => {
    let nonce = "";
    const net = fakeMicrosoftNetwork(() => nonce);
    vi.stubGlobal("fetch", net.fetchMock);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    fakePopup((authUrl) => {
      nonce = authUrl.searchParams.get("nonce") ?? "";
    });

    const app = await createMsalClient({ clientId: MS_CLIENT_ID, authority: AUTHORITY, redirectUri: REDIRECT });
    const login = await app.loginPopup({ scopes: ["openid", "profile", "email", "Mail.Read"], nonce: "app-nonce" });

    expect(login.accessToken).toBe("eyJ.REAL-LIBRARY-ACCESS-TOKEN"); // the library ran the whole flow, so the check below means something
    expect(login.account?.username).toBe("grace@outlook.com");
    expect(net.urls.some((p) => p.endsWith("/oauth2/v2.0/token"))).toBe(true);

    const silent = await app.acquireTokenSilent({ scopes: ["Mail.Read"], account: login.account! });
    expect(silent.accessToken).toBe("eyJ.REAL-LIBRARY-ACCESS-TOKEN"); // served from the in-memory cache

    expect(storageContents()).toEqual([]);
    expect(setItem).not.toHaveBeenCalled();

    await app.clearCache();
    expect(storageContents()).toEqual([]);
  });
});

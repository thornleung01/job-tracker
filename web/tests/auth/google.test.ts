import { afterEach, describe, expect, it, vi } from "vitest";
import { GIS_SRC, GMAIL_PROFILE_URL, GOOGLE_LOGIN_SCOPES, GOOGLE_UNREACHABLE, POPUP_HINT, TOKENINFO_URL, createGisLoader, createGoogleAuth, type GisApi } from "../../src/auth/google";
import { NotConnected } from "../../src/types";
import { CLIENT_ID, NOW } from "./helpers";

const MAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const LOGIN_SCOPE = `openid email ${MAIL_SCOPE}`;

type TokenConfig = Parameters<GisApi["accounts"]["oauth2"]["initTokenClient"]>[0];
type Overrides = Parameters<ReturnType<GisApi["accounts"]["oauth2"]["initTokenClient"]>["requestAccessToken"]>[0];

function fakeGis() {
  const s = {
    tokenConfigs: [] as TokenConfig[],
    requests: [] as { cfg: TokenConfig; overrides: Overrides }[],
    revoked: [] as string[],
    respond: ((cfg: TokenConfig) => cfg.callback({ access_token: "ya29.token", expires_in: 3600, scope: `openid email ${MAIL_SCOPE}` })) as (cfg: TokenConfig) => void,
  };
  const api: GisApi = {
    accounts: {
      oauth2: {
        initTokenClient: (cfg) => {
          s.tokenConfigs.push(cfg);
          return {
            requestAccessToken: (overrides) => {
              s.requests.push({ cfg, overrides });
              s.respond(cfg);
            },
          };
        },
        revoke: (t, done) => {
          s.revoked.push(t);
          done?.();
        },
      },
    },
  };
  return { s, api };
}

const infoBody = (over: Record<string, unknown> = {}) => ({ aud: CLIENT_ID, sub: "1098765432", email: "ada@example.com", scope: LOGIN_SCOPE, expires_in: "3599", ...over });
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup(over: Partial<Parameters<typeof createGoogleAuth>[0]> = {}, info: () => Response | Promise<Response> = () => jsonResponse(infoBody())) {
  const { s, api } = fakeGis();
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => info());
  const auth = createGoogleAuth({
    clientId: CLIENT_ID,
    mailScope: MAIL_SCOPE,
    loadGis: async () => api,
    now: () => NOW,
    fetch: fetchMock as unknown as typeof fetch,
    ...over,
  });
  return { s, auth, fetchMock };
}

const rejection = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as Error;

describe("google login scopes", () => {
  it("asks for openid and email only: the app reads the account id and address, never the profile", () => {
    expect(GOOGLE_LOGIN_SCOPES).toBe("openid email");
    expect(GOOGLE_LOGIN_SCOPES.split(" ")).not.toContain("profile");
  });
});

describe("google signIn (token client)", () => {
  it("prepare() creates the token client once, with the login and mail scopes", async () => {
    const { s, auth } = setup();
    await auth.prepare();
    await auth.prepare();
    expect(s.tokenConfigs).toHaveLength(1);
    expect(s.tokenConfigs[0].client_id).toBe(CLIENT_ID);
    expect(s.tokenConfigs[0].scope).toBe("openid email https://www.googleapis.com/auth/gmail.readonly");
    expect(s.requests).toHaveLength(0);
  });

  it("opens the window synchronously inside signIn once prepared, before anything is awaited", async () => {
    const { s, auth } = setup();
    await auth.prepare();
    const p = auth.signIn();
    expect(s.requests).toHaveLength(1);
    expect(s.requests[0].overrides).toEqual({ prompt: "" });
    await p;
  });

  it("falls back to preparing first when signIn comes early", async () => {
    const { s, auth } = setup();
    const p = auth.signIn();
    expect(s.requests).toHaveLength(0);
    await expect(p).resolves.toMatchObject({ user: { provider: "google" } });
    expect(s.tokenConfigs).toHaveLength(1);
    expect(s.requests).toHaveLength(1);
  });

  it("returns the user and the Gmail token from one window", async () => {
    const { auth } = setup();
    await auth.prepare();
    await expect(auth.signIn()).resolves.toEqual({
      user: { iss: "https://accounts.google.com", sub: "1098765432", provider: "google", email: "ada@example.com" },
      mail: { token: "ya29.token", expiresAt: NOW + 3600_000 },
    });
  });

  it("asks tokeninfo with a form POST of the access token", async () => {
    const { auth, fetchMock } = setup();
    await auth.prepare();
    await auth.signIn();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TOKENINFO_URL);
    expect(TOKENINFO_URL).toBe("https://oauth2.googleapis.com/tokeninfo");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(String(init?.body)).toBe("access_token=ya29.token");
  });

  it("retries tokeninfo as a GET when the POST is not accepted", async () => {
    const { auth, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(new Response("", { status: 405 }));
    await auth.prepare();
    await expect(auth.signIn()).resolves.toMatchObject({ user: { sub: "1098765432" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(`${TOKENINFO_URL}?access_token=ya29.token`);
    expect(init?.method).toBe("GET");
  });

  it("retries tokeninfo as a GET when the POST answers 415", async () => {
    const { auth, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(new Response("", { status: 415 }));
    await auth.prepare();
    await expect(auth.signIn()).resolves.toMatchObject({ user: { sub: "1098765432" } });
    expect(fetchMock.mock.calls[1][1]?.method).toBe("GET");
  });

  it("does not put the token in a URL when the POST fails to send: it is not verified", async () => {
    const { auth, fetchMock } = setup();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await auth.prepare();
    await expect(auth.signIn()).rejects.toThrow(/couldn't be verified/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never writes the access token to the console, whatever fails", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const { auth, fetchMock } = setup();
      fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await auth.prepare();
      await rejection(auth.signIn());
      fetchMock.mockResolvedValueOnce(new Response("", { status: 405 }));
      fetchMock.mockResolvedValueOnce(new Response("nope", { status: 400 }));
      await rejection(auth.signIn());
      const written = spies.flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(" ")));
      expect(written.filter((line) => line.includes("ya29.token"))).toEqual([]);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it("does not retry other error statuses as a GET", async () => {
    const { auth, fetchMock } = setup({}, () => jsonResponse({ error: "invalid_token" }, 400));
    await auth.prepare();
    await expect(auth.signIn()).rejects.toThrow(/couldn't be verified/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects when tokeninfo says the token is bad", async () => {
    const { auth } = setup({}, () => jsonResponse({ error: "invalid_token" }, 400));
    await auth.prepare();
    await expect(auth.signIn()).rejects.toThrow(/couldn't be verified/);
  });

  it("rejects a token issued to another client id", async () => {
    const { auth } = setup({}, () => jsonResponse(infoBody({ aud: "other-client.apps.googleusercontent.com" })));
    await auth.prepare();
    await expect(auth.signIn()).rejects.toThrow(/couldn't be verified/);
  });

  it("accepts azp when it matches the client id along with aud", async () => {
    const { auth } = setup({}, () => jsonResponse(infoBody({ azp: CLIENT_ID })));
    await auth.prepare();
    await expect(auth.signIn()).resolves.toMatchObject({ user: { sub: "1098765432" } });
  });

  it("rejects when aud is another client, even if azp matches", async () => {
    const { auth } = setup({}, () => jsonResponse(infoBody({ aud: "something-else", azp: CLIENT_ID })));
    await auth.prepare();
    await expect(auth.signIn()).rejects.toThrow(/couldn't be verified/);
  });

  it("rejects when aud matches but azp is another client", async () => {
    const { auth } = setup({}, () => jsonResponse(infoBody({ azp: "something-else" })));
    await auth.prepare();
    await expect(auth.signIn()).rejects.toThrow(/couldn't be verified/);
  });

  it("rejects a missing or non-numeric sub", async () => {
    for (const sub of [undefined, "", "abc123", "12:34", "1e5", 12345]) {
      const { auth } = setup({}, () => jsonResponse(infoBody({ sub })));
      await auth.prepare();
      await expect(auth.signIn()).rejects.toThrow(/couldn't be verified/);
    }
  });

  it("rejects a missing email", async () => {
    for (const email of [undefined, "", 7]) {
      const { auth } = setup({}, () => jsonResponse(infoBody({ email })));
      await auth.prepare();
      await expect(auth.signIn()).rejects.toThrow(/email/);
    }
  });

  it("logs in without mail when the person unticks Gmail", async () => {
    const { s, auth } = setup();
    s.respond = (cfg) => cfg.callback({ access_token: "ya29.token", expires_in: 3600, scope: "openid https://www.googleapis.com/auth/userinfo.email" });
    await auth.prepare();
    await expect(auth.signIn()).resolves.toEqual({
      user: { iss: "https://accounts.google.com", sub: "1098765432", provider: "google", email: "ada@example.com" },
      mail: null,
    });
  });

  it("with mail: false asks for the login scopes only and returns no mail token", async () => {
    const { s, auth } = setup();
    await auth.prepare();
    const result = await auth.signIn({ mail: false });
    expect(s.requests[0].overrides).toEqual({ prompt: "", scope: "openid email" });
    expect(result.mail).toBeNull();
    expect(result.user.sub).toBe("1098765432");
  });

  it("revokes the token when the person logged in without mail but it can read mail anyway", async () => {
    const { s, auth } = setup();
    await auth.prepare();
    const result = await auth.signIn({ mail: false });
    expect(result.mail).toBeNull();
    expect(s.revoked).toEqual(["ya29.token"]);
  });

  it("does not revoke a token that carries no mail scope, or one that is kept", async () => {
    const { s, auth } = setup();
    await auth.prepare();
    await auth.signIn();
    expect(s.revoked).toEqual([]);
    s.respond = (cfg) => cfg.callback({ access_token: "ya29.login-only", expires_in: 3600, scope: "openid email" });
    await auth.signIn({ mail: false });
    await auth.signIn();
    expect(s.revoked).toEqual([]);
  });

  it("gives the popup hint when the browser blocks the window", async () => {
    const { s, auth } = setup();
    s.respond = (cfg) => cfg.error_callback?.({ type: "popup_failed_to_open" });
    await auth.prepare();
    const err = await rejection(auth.signIn());
    expect(err.message).toBe(POPUP_HINT);
  });

  it("says the login was cancelled when the window is closed or access is denied", async () => {
    const { s, auth } = setup();
    await auth.prepare();
    s.respond = (cfg) => cfg.error_callback?.({ type: "popup_closed" });
    expect((await rejection(auth.signIn())).message).toBe("Login was cancelled.");
    s.respond = (cfg) => cfg.callback({ error: "access_denied" });
    expect((await rejection(auth.signIn())).message).toBe("Login was cancelled.");
  });

  it("reports other failures plainly", async () => {
    const { s, auth } = setup();
    await auth.prepare();
    s.respond = (cfg) => cfg.callback({ error: "interaction_required" });
    expect((await rejection(auth.signIn())).message).toBe("Google login wasn't completed. Try again.");
    s.respond = (cfg) => cfg.callback({});
    expect((await rejection(auth.signIn())).message).toBe("Google login wasn't completed. Try again.");
  });

  it("can try again after a failed prepare", async () => {
    let calls = 0;
    const { api } = fakeGis();
    const { auth } = setup({
      loadGis: async () => {
        if (calls++ === 0) throw new Error("Couldn't load Google login. Check your connection or content blocker.");
        return api;
      },
    });
    await expect(auth.prepare()).rejects.toThrow(/Couldn't load/);
    await expect(auth.prepare()).resolves.toBeUndefined();
  });
});

describe("google mail token (token client)", () => {
  it("requests only gmail.readonly and returns the token with an expiry", async () => {
    const { s, auth } = setup();
    const t = await auth.requestMailToken({ loginHint: "ada@example.com" });
    expect(t).toEqual({ token: "ya29.token", expiresAt: NOW + 3600_000 });
    expect(s.tokenConfigs[0].scope).toBe(MAIL_SCOPE);
    expect(s.tokenConfigs[0].prompt).toBe("");
    expect(s.tokenConfigs[0].login_hint).toBe("ada@example.com");
  });

  it("throws NotConnected when Google needs interaction", async () => {
    const { s, auth } = setup();
    s.respond = (cfg) => cfg.callback({ error: "interaction_required" });
    await expect(auth.requestMailToken()).rejects.toBeInstanceOf(NotConnected);
  });

  it.each(["consent_required", "login_required", "invalid_grant", "access_denied"])("throws NotConnected when Google answers %s: the person has to act", async (error) => {
    const { s, auth } = setup();
    s.respond = (cfg) => cfg.callback({ error });
    await expect(auth.requestMailToken()).rejects.toBeInstanceOf(NotConnected);
  });

  it.each(["server_error", "temporarily_unavailable", "network_error"])("throws a plain retryable error, not NotConnected, when Google answers %s", async (error) => {
    const { s, auth } = setup();
    s.respond = (cfg) => cfg.callback({ error });
    const err = await rejection(auth.requestMailToken());
    expect(err).not.toBeInstanceOf(NotConnected);
    expect(err.message).toBe(GOOGLE_UNREACHABLE);
  });

  it("treats an answer with neither a token nor an error code as transient", async () => {
    const { s, auth } = setup();
    s.respond = (cfg) => cfg.callback({});
    expect(await rejection(auth.requestMailToken())).not.toBeInstanceOf(NotConnected);
  });

  it("treats an unknown window failure as transient, but a blocked or closed window as NotConnected", async () => {
    const { s, auth } = setup();
    s.respond = (cfg) => cfg.error_callback?.({ type: "unknown" });
    const err = await rejection(auth.requestMailToken());
    expect(err).not.toBeInstanceOf(NotConnected);
    expect(err.message).toBe(GOOGLE_UNREACHABLE);
  });

  it("throws NotConnected when the popup is blocked or closed", async () => {
    const { s, auth } = setup();
    s.respond = (cfg) => cfg.error_callback?.({ type: "popup_failed_to_open" });
    await expect(auth.requestMailToken()).rejects.toThrow(NotConnected);
    s.respond = (cfg) => cfg.error_callback?.({ type: "popup_closed" });
    await expect(auth.requestMailToken()).rejects.toThrow(NotConnected);
  });

  it("throws NotConnected when the person unticks the Gmail permission", async () => {
    const { s, auth } = setup();
    s.respond = (cfg) => cfg.callback({ access_token: "t", expires_in: 3600, scope: "openid email" });
    await expect(auth.requestMailToken()).rejects.toThrow(/wasn't granted/);
  });

  it("honours an already aborted signal", async () => {
    const { auth } = setup();
    const ac = new AbortController();
    ac.abort();
    await expect(auth.requestMailToken({ signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("revokes through GIS once loaded, and is a no-op before", async () => {
    const { s, auth } = setup();
    await auth.revoke("early");
    expect(s.revoked).toEqual([]);
    await auth.requestMailToken();
    await auth.revoke("ya29.token");
    expect(s.revoked).toEqual(["ya29.token"]);
  });
});

describe("google mailboxAddress", () => {
  it("reads the Gmail profile with the token as a bearer", async () => {
    const { auth, fetchMock } = setup({}, () => jsonResponse({ emailAddress: "Ada@Gmail.com" }));
    await expect(auth.mailboxAddress("ya29.mail")).resolves.toBe("Ada@Gmail.com");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(GMAIL_PROFILE_URL);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer ya29.mail");
  });

  it("fails plainly when Google answers with an error or no address", async () => {
    await expect(setup({}, () => jsonResponse({}, 401)).auth.mailboxAddress("t")).rejects.toThrow(/didn't share/);
    await expect(setup({}, () => jsonResponse({})).auth.mailboxAddress("t")).rejects.toThrow(/didn't share/);
  });

  it("says Google can't be reached when the request fails to send, with a plain Error", async () => {
    const { auth, fetchMock } = setup();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const err = await rejection(auth.mailboxAddress("t"));
    expect(err).not.toBeInstanceOf(NotConnected);
    expect(err.message).toBe(GOOGLE_UNREACHABLE);
  });

  it("reports an abort as an AbortError", async () => {
    const { auth, fetchMock } = setup();
    const ac = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      ac.abort();
      throw new TypeError("aborted");
    });
    await expect(auth.mailboxAddress("t", ac.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("google signIn when the window can't open", () => {
  it("turns an exception from requestAccessToken into a rejection, and leaves nothing pending", async () => {
    const { s, auth } = setup();
    s.respond = () => { throw new Error("popup blocked by the browser"); };
    await auth.prepare();
    await expect(auth.signIn()).rejects.toThrow("popup blocked by the browser");
    // The next try works: the failed one didn't leave a pending request that would be rejected as cancelled.
    s.respond = (cfg) => cfg.callback({ access_token: "ya29.token", expires_in: 3600, scope: LOGIN_SCOPE });
    await expect(auth.signIn()).resolves.toMatchObject({ user: { sub: "1098765432" } });
  });

  it("wraps something thrown that isn't an Error", async () => {
    const { s, auth } = setup();
    s.respond = () => { throw "nope"; };
    await auth.prepare();
    await expect(auth.signIn()).rejects.toThrow("nope");
  });
});

describe("createGisLoader", () => {
  afterEach(() => {
    delete (window as unknown as { google?: unknown }).google;
    document.head.querySelectorAll("script").forEach((n) => n.remove());
  });

  const scripts = () => [...document.head.querySelectorAll<HTMLScriptElement>("script")].filter((s) => s.src === GIS_SRC);

  it("injects the GIS script once and resolves when it loads", async () => {
    const load = createGisLoader(document, window);
    const a = load();
    const b = load();
    expect(scripts()).toHaveLength(1);
    const { api } = fakeGis();
    (window as unknown as { google: GisApi }).google = api;
    scripts()[0].onload?.(new Event("load"));
    await expect(a).resolves.toBe(api);
    await expect(b).resolves.toBe(api);
    await expect(load()).resolves.toBe(api);
    expect(scripts()).toHaveLength(1);
  });

  it("says so when the script loads but Google's login isn't there (a content blocker can do this), and can retry", async () => {
    const load = createGisLoader(document, window);
    const first = load();
    scripts()[0].onload?.(new Event("load"));
    await expect(first).rejects.toThrow("Google login didn't load. Reload the page and try again.");
    const second = load();
    const { api } = fakeGis();
    (window as unknown as { google: GisApi }).google = api;
    scripts()[1].onload?.(new Event("load"));
    await expect(second).resolves.toBe(api);
  });

  it("can retry after a failed load", async () => {
    const load = createGisLoader(document, window);
    const first = load();
    scripts()[0].onerror?.(new Event("error"));
    await expect(first).rejects.toThrow(/Couldn't load Google login/);
    const second = load();
    expect(scripts()).toHaveLength(1);
    const { api } = fakeGis();
    (window as unknown as { google: GisApi }).google = api;
    scripts()[0].onload?.(new Event("load"));
    await expect(second).resolves.toBe(api);
  });
});

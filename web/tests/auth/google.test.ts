import { afterEach, describe, expect, it, vi } from "vitest";
import { GIS_SRC, createGisLoader, createGoogleAuth, type GisApi } from "../../src/auth/google";
import { NotConnected } from "../../src/types";
import { CLIENT_ID, NOW, googleClaims, makeJwt } from "./helpers";

const MAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

type IdConfig = Parameters<GisApi["accounts"]["id"]["initialize"]>[0];
type TokenConfig = Parameters<GisApi["accounts"]["oauth2"]["initTokenClient"]>[0];

function fakeGis() {
  const s = {
    idConfig: undefined as IdConfig | undefined,
    promptListener: undefined as Parameters<GisApi["accounts"]["id"]["prompt"]>[0],
    tokenConfigs: [] as TokenConfig[],
    revoked: [] as string[],
    respond: ((cfg: TokenConfig) => cfg.callback({ access_token: "ya29.token", expires_in: 3600, scope: MAIL_SCOPE })) as (cfg: TokenConfig) => void,
    renderButton: vi.fn(),
    disableAutoSelect: vi.fn(),
  };
  const api: GisApi = {
    accounts: {
      id: {
        initialize: (c) => void (s.idConfig = c),
        prompt: (l) => void (s.promptListener = l),
        renderButton: s.renderButton,
        disableAutoSelect: s.disableAutoSelect,
        cancel: vi.fn(),
      },
      oauth2: {
        initTokenClient: (cfg) => {
          s.tokenConfigs.push(cfg);
          return { requestAccessToken: () => s.respond(cfg) };
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

function setup(over: Partial<Parameters<typeof createGoogleAuth>[0]> = {}) {
  const { s, api } = fakeGis();
  const nonces = ["nonce-a", "nonce-b", "nonce-c", "nonce-d"];
  const auth = createGoogleAuth({
    clientId: CLIENT_ID,
    mailScope: MAIL_SCOPE,
    loadGis: async () => api,
    makeNonce: () => nonces.shift() ?? "nonce-z",
    now: () => NOW,
    ...over,
  });
  return { s, auth };
}

const credential = (nonce: string, over: Record<string, unknown> = {}) => ({ credential: makeJwt(googleClaims({ nonce, ...over })) });

describe("google signIn (ID token credential)", () => {
  it("passes a fresh nonce to GIS and resolves with the validated user", async () => {
    const { s, auth } = setup();
    const p = auth.signIn();
    await vi.waitFor(() => expect(s.idConfig).toBeDefined());
    expect(s.idConfig?.client_id).toBe(CLIENT_ID);
    expect(s.idConfig?.nonce).toBe("nonce-a");
    s.idConfig?.callback(credential("nonce-a"));
    await expect(p).resolves.toEqual({
      iss: "https://accounts.google.com",
      sub: "1098765432",
      provider: "google",
      email: "ada@example.com",
      name: "Ada Lovelace",
    });
  });

  it("rejects a credential whose nonce is not ours", async () => {
    const { s, auth } = setup();
    const p = auth.signIn();
    await vi.waitFor(() => expect(s.idConfig).toBeDefined());
    s.idConfig?.callback(credential("attacker-nonce"));
    await expect(p).rejects.toMatchObject({ code: "nonce" });
  });

  it("rejects a credential for another client id", async () => {
    const { s, auth } = setup();
    const p = auth.signIn();
    await vi.waitFor(() => expect(s.idConfig).toBeDefined());
    s.idConfig?.callback(credential("nonce-a", { aud: "other-client" }));
    await expect(p).rejects.toMatchObject({ code: "audience" });
  });

  it("treats a nonce as single use: replaying the same credential is rejected", async () => {
    const onButtonSignIn = vi.fn();
    const onButtonError = vi.fn();
    const { s, auth } = setup({ onButtonSignIn, onButtonError });
    await auth.renderButton(document.createElement("div"));
    const first = s.idConfig!;
    const replayed = credential("nonce-a");
    first.callback(replayed);
    expect(s.idConfig?.nonce).toBe("nonce-b");
    s.idConfig?.callback(replayed);
    expect(onButtonSignIn).toHaveBeenCalledTimes(1);
    expect(onButtonError).toHaveBeenCalledTimes(1);
  });

  it("explains when Google does not show the prompt", async () => {
    const { s, auth } = setup();
    const p = auth.signIn();
    await vi.waitFor(() => expect(s.promptListener).toBeDefined());
    s.promptListener?.({ isNotDisplayed: () => true, isSkippedMoment: () => false, isDismissedMoment: () => false });
    await expect(p).rejects.toThrow(/button/);
  });
});

describe("google button", () => {
  it("reports a valid credential through onButtonSignIn", async () => {
    const onButtonSignIn = vi.fn();
    const { s, auth } = setup({ onButtonSignIn });
    const el = document.createElement("div");
    await auth.renderButton(el);
    expect(s.renderButton).toHaveBeenCalledWith(el, expect.objectContaining({ type: "standard" }));
    s.idConfig?.callback(credential("nonce-a"));
    expect(onButtonSignIn).toHaveBeenCalledWith(expect.objectContaining({ sub: "1098765432", provider: "google" }));
  });

  it("reports an invalid credential through onButtonError", async () => {
    const onButtonSignIn = vi.fn();
    const onButtonError = vi.fn();
    const { s, auth } = setup({ onButtonSignIn, onButtonError });
    await auth.renderButton(document.createElement("div"));
    s.idConfig?.callback(credential("wrong"));
    expect(onButtonSignIn).not.toHaveBeenCalled();
    expect(onButtonError).toHaveBeenCalledOnce();
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

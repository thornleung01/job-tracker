import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth, type Auth, type AuthDeps } from "../../src/auth";
import type { GoogleAccessToken, GoogleAuth } from "../../src/auth/google";
import type { MicrosoftAccessToken, MicrosoftAuth } from "../../src/auth/microsoft";
import type { AuthUser } from "../../src/auth/user";
import { NotConnected } from "../../src/types";

const NOW = 1_800_000_000_000;
const ada: AuthUser = { iss: "https://accounts.google.com", sub: "111", provider: "google", email: "ada@example.com" };
const grace: AuthUser = { iss: "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0", sub: "ggg", provider: "microsoft", email: "grace@outlook.com" };

const SECRET_G = "ya29.SECRET-GOOGLE-ACCESS-TOKEN";
const SECRET_M = "eyJ.SECRET-MICROSOFT-ACCESS-TOKEN";

function fakes() {
  const clock = { now: NOW };
  const google = {
    signIn: vi.fn(async () => ada),
    renderButton: vi.fn(async () => {}),
    requestMailToken: vi.fn(async (): Promise<GoogleAccessToken> => ({ token: SECRET_G, expiresAt: clock.now + 3600_000 })),
    revoke: vi.fn(async () => {}),
    disableAutoSelect: vi.fn(),
  } satisfies GoogleAuth;
  const microsoft = {
    signIn: vi.fn(async () => grace),
    requestMailToken: vi.fn(async (): Promise<MicrosoftAccessToken> => ({ token: SECRET_M, expiresAt: clock.now + 3600_000 })),
    clear: vi.fn(async () => {}),
  } satisfies MicrosoftAuth;
  let hooks: Parameters<AuthDeps["google"]>[0] | undefined;
  const memory = new Map<string, string>();
  const hintStorage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) };
  const auth: Auth = createAuth({
    google: (h) => {
      hooks = h;
      return google;
    },
    microsoft,
    now: () => clock.now,
    hintStorage,
  });
  return { auth, google, microsoft, clock, memory, hooks: () => hooks! };
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

describe("session", () => {
  it("starts signed out and tokenSource throws NotConnected", async () => {
    const { auth } = fakes();
    expect(auth.getSession()).toMatchObject({ status: "signed-out", user: null, mail: { gmail: false, outlook: false } });
    expect(auth.currentUser()).toBeNull();
    await expect(auth.tokenSource("gmail")).rejects.toBeInstanceOf(NotConnected);
    await expect(auth.tokenSource("outlook")).rejects.toBeInstanceOf(NotConnected);
  });

  it("signs in with Google and records the user", async () => {
    const { auth } = fakes();
    await expect(auth.signIn("google")).resolves.toEqual(ada);
    expect(auth.getSession()).toMatchObject({ status: "signed-in", user: ada, lastProvider: "google", error: null });
    expect(auth.currentUser()).toEqual(ada);
  });

  it("signs in with Microsoft", async () => {
    const { auth } = fakes();
    await auth.signIn("microsoft");
    expect(auth.currentUser()).toEqual(grace);
  });

  it("shows signing-in while waiting, and the error after a failure", async () => {
    const { auth, google } = fakes();
    const d = deferred<AuthUser>();
    google.signIn.mockReturnValueOnce(d.promise);
    const p = auth.signIn("google");
    expect(auth.getSession().status).toBe("signing-in");
    d.reject(new Error("popup closed"));
    await expect(p).rejects.toThrow("popup closed");
    expect(auth.getSession()).toMatchObject({ status: "signed-out", user: null, error: "popup closed" });
  });

  it("refuses a provider that has no client id configured", async () => {
    const auth = createAuth({ google: () => fakes().google, microsoft: fakes().microsoft, isConfigured: () => false });
    await expect(auth.signIn("google")).rejects.toThrow(/isn't available on this site/);
    expect(auth.getSession().error).toMatch(/isn't available on this site/);
  });

  it("signs in through the rendered Google button", async () => {
    const { auth, hooks, google } = fakes();
    const el = document.createElement("div");
    await auth.renderGoogleButton(el);
    expect(google.renderButton).toHaveBeenCalledWith(el, undefined);
    hooks().onButtonSignIn(ada);
    expect(auth.getSession()).toMatchObject({ status: "signed-in", user: ada });
  });

  it("reports a failed button sign-in", () => {
    const { auth, hooks } = fakes();
    hooks().onButtonError(new Error("nonce mismatch"));
    expect(auth.getSession()).toMatchObject({ status: "signed-out", error: "nonce mismatch" });
  });

  it("works with useSyncExternalStore: stable snapshots, notifies, unsubscribes", async () => {
    const { auth } = fakes();
    const first = auth.getSession();
    expect(auth.getSession()).toBe(first);
    const cb = vi.fn();
    const off = auth.subscribe(cb);
    await auth.signIn("google");
    expect(cb).toHaveBeenCalled();
    expect(auth.getSession()).not.toBe(first);
    const calls = cb.mock.calls.length;
    off();
    await auth.signOut();
    expect(cb.mock.calls.length).toBe(calls);
  });

  it("remembers only the last provider, across instances", async () => {
    const f = fakes();
    await f.auth.signIn("microsoft");
    expect([...f.memory.entries()]).toEqual([["jobtracker:lastProvider", "microsoft"]]);
    const next = createAuth({ google: () => f.google, microsoft: f.microsoft, hintStorage: { getItem: (k) => f.memory.get(k) ?? null, setItem: () => {} } });
    expect(next.getSession().lastProvider).toBe("microsoft");
    expect(next.getSession().status).toBe("signed-out");
  });
});

describe("connectMail and tokenSource", () => {
  it("requires sign-in first", async () => {
    const { auth, google } = fakes();
    await expect(auth.connectMail("gmail")).rejects.toBeInstanceOf(NotConnected);
    expect(google.requestMailToken).not.toHaveBeenCalled();
  });

  it("throws NotConnected for a mailbox that was never connected", async () => {
    const { auth } = fakes();
    await auth.signIn("google");
    await expect(auth.tokenSource("gmail")).rejects.toThrow(/Gmail isn't connected/);
  });

  it("connects Gmail with a login hint and serves the cached token", async () => {
    const { auth, google } = fakes();
    await auth.signIn("google");
    await auth.connectMail("gmail");
    expect(google.requestMailToken).toHaveBeenCalledWith({ signal: undefined, loginHint: "ada@example.com" });
    expect(auth.getSession().mail).toEqual({ gmail: true, outlook: false });
    await expect(auth.tokenSource("gmail")).resolves.toBe(SECRET_G);
    await expect(auth.tokenSource("gmail")).resolves.toBe(SECRET_G);
    expect(google.requestMailToken).toHaveBeenCalledTimes(1);
  });

  it("connects Outlook interactively and refreshes silently later", async () => {
    const { auth, microsoft, clock } = fakes();
    await auth.signIn("google");
    await auth.connectMail("outlook");
    expect(microsoft.requestMailToken).toHaveBeenLastCalledWith({ interactive: true, signal: undefined });
    clock.now += 3600_000;
    await expect(auth.tokenSource("outlook")).resolves.toBe(SECRET_M);
    expect(microsoft.requestMailToken).toHaveBeenLastCalledWith({ interactive: false, signal: undefined });
  });

  it("accepts the identity names as aliases for the mailboxes", async () => {
    const { auth, microsoft } = fakes();
    await auth.signIn("microsoft");
    await auth.connectMail("microsoft");
    expect(microsoft.requestMailToken).toHaveBeenCalled();
    await expect(auth.tokenSource("outlook")).resolves.toBe(SECRET_M);
  });

  it("re-acquires an expiring token silently, sharing one request between callers", async () => {
    const { auth, google, clock } = fakes();
    await auth.signIn("google");
    await auth.connectMail("gmail");
    clock.now += 3600_000 - 30_000; // inside the 60 s safety margin
    const d = deferred<GoogleAccessToken>();
    google.requestMailToken.mockReturnValueOnce(d.promise);
    const a = auth.tokenSource("gmail");
    const b = auth.tokenSource("gmail");
    d.resolve({ token: "fresh", expiresAt: clock.now + 3600_000 });
    await expect(Promise.all([a, b])).resolves.toEqual(["fresh", "fresh"]);
    expect(google.requestMailToken).toHaveBeenCalledTimes(2);
  });

  it("surfaces NotConnected and marks the mailbox disconnected when silent refresh needs interaction", async () => {
    const { auth, google, clock } = fakes();
    await auth.signIn("google");
    await auth.connectMail("gmail");
    clock.now += 3600_000;
    google.requestMailToken.mockRejectedValueOnce(new NotConnected("Gmail connection wasn't completed"));
    await expect(auth.tokenSource("gmail")).rejects.toBeInstanceOf(NotConnected);
    expect(auth.getSession().mail.gmail).toBe(false);
    expect(auth.getSession().error).toBe("Gmail connection wasn't completed");
    await expect(auth.tokenSource("gmail")).rejects.toThrow(/isn't connected/);
  });

  it("lets other failures (network) through without disconnecting", async () => {
    const { auth, google, clock } = fakes();
    await auth.signIn("google");
    await auth.connectMail("gmail");
    clock.now += 3600_000;
    google.requestMailToken.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(auth.tokenSource("gmail")).rejects.toBeInstanceOf(TypeError);
    expect(auth.getSession().mail.gmail).toBe(true);
  });

  it("rejects an aborted caller without cancelling the shared request", async () => {
    const { auth, google, clock } = fakes();
    await auth.signIn("google");
    await auth.connectMail("gmail");
    clock.now += 3600_000;
    const d = deferred<GoogleAccessToken>();
    google.requestMailToken.mockReturnValueOnce(d.promise);
    const ac = new AbortController();
    const p = auth.tokenSource("gmail", ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    d.resolve({ token: "later", expiresAt: clock.now + 3600_000 });
    await expect(auth.tokenSource("gmail")).resolves.toBe("later");
  });

  it("keeps a failed connect visible in the session", async () => {
    const { auth, google } = fakes();
    await auth.signIn("google");
    google.requestMailToken.mockRejectedValueOnce(new NotConnected("Allow pop-ups for this site and connect Gmail again"));
    await expect(auth.connectMail("gmail")).rejects.toBeInstanceOf(NotConnected);
    expect(auth.getSession().mail.gmail).toBe(false);
    expect(auth.getSession().error).toMatch(/pop-ups/);
  });
});

describe("signOut", () => {
  it("wipes tokens, resets the session, revokes Google and clears MSAL", async () => {
    const { auth, google, microsoft } = fakes();
    await auth.signIn("google");
    await auth.connectMail("gmail");
    await auth.connectMail("outlook");
    await auth.signOut();
    expect(auth.getSession()).toMatchObject({ status: "signed-out", user: null, mail: { gmail: false, outlook: false } });
    expect(google.revoke).toHaveBeenCalledWith(SECRET_G);
    expect(google.disableAutoSelect).toHaveBeenCalled();
    expect(microsoft.clear).toHaveBeenCalled();
    await expect(auth.tokenSource("gmail")).rejects.toBeInstanceOf(NotConnected);
    await expect(auth.tokenSource("outlook")).rejects.toBeInstanceOf(NotConnected);
  });

  it("does not revoke when no Google token exists", async () => {
    const { auth, google } = fakes();
    await auth.signIn("google");
    await auth.signOut();
    expect(google.revoke).not.toHaveBeenCalled();
  });

  it("completes even if revoking fails or hangs", async () => {
    vi.useFakeTimers();
    try {
      const { auth, google } = fakes();
      await auth.signIn("google");
      await auth.connectMail("gmail");
      google.revoke.mockReturnValueOnce(new Promise(() => {}));
      const p = auth.signOut();
      await vi.advanceTimersByTimeAsync(3500);
      await expect(p).resolves.toBeUndefined();
      expect(auth.getSession().status).toBe("signed-out");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a token request still in flight cannot revive the session after sign-out", async () => {
    const { auth, google, clock } = fakes();
    await auth.signIn("google");
    await auth.connectMail("gmail");
    clock.now += 3600_000;
    const d = deferred<GoogleAccessToken>();
    google.requestMailToken.mockReturnValueOnce(d.promise);
    const p = auth.tokenSource("gmail");
    await auth.signOut();
    d.resolve({ token: "late", expiresAt: clock.now + 3600_000 });
    await expect(p).rejects.toBeInstanceOf(NotConnected);
    await expect(auth.tokenSource("gmail")).rejects.toBeInstanceOf(NotConnected);
    expect(auth.getSession().status).toBe("signed-out");
  });

  it("a sign-in that finishes after sign-out is discarded", async () => {
    const { auth, google } = fakes();
    const d = deferred<AuthUser>();
    google.signIn.mockReturnValueOnce(d.promise);
    const p = auth.signIn("google");
    await auth.signOut();
    d.resolve(ada);
    await expect(p).rejects.toThrow(/cancelled/);
    expect(auth.getSession().status).toBe("signed-out");
  });

  it("signing in as someone else drops the previous person's tokens", async () => {
    const { auth, microsoft } = fakes();
    await auth.signIn("google");
    await auth.connectMail("gmail");
    await auth.signIn("microsoft");
    expect(auth.currentUser()).toEqual(grace);
    expect(auth.getSession().mail).toEqual({ gmail: false, outlook: false });
    expect(microsoft.clear).toHaveBeenCalled();
    await expect(auth.tokenSource("gmail")).rejects.toBeInstanceOf(NotConnected);
  });
});

describe("token storage", () => {
  let setItem: ReturnType<typeof vi.spyOn>;
  let cookie: ReturnType<typeof vi.spyOn>;
  let replaceState: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setItem = vi.spyOn(Storage.prototype, "setItem");
    cookie = vi.spyOn(document, "cookie", "set");
    replaceState = vi.spyOn(history, "replaceState");
  });
  afterEach(() => vi.restoreAllMocks());

  it("never writes a token to localStorage, sessionStorage, cookies or the URL", async () => {
    const { auth } = fakes();
    // no hintStorage injected here: the default (real localStorage) is exercised through the spy
    const real = createAuth({
      google: () => ({
        signIn: async () => ada,
        renderButton: async () => {},
        requestMailToken: async () => ({ token: SECRET_G, expiresAt: NOW + 3600_000 }),
        revoke: async () => {},
        disableAutoSelect: () => {},
      }),
      microsoft: {
        signIn: async () => grace,
        requestMailToken: async () => ({ token: SECRET_M, expiresAt: NOW + 3600_000 }),
        clear: async () => {},
      },
      now: () => NOW,
    });
    for (const a of [auth, real]) {
      await a.signIn("google");
      await a.connectMail("gmail");
      await a.connectMail("outlook");
      await a.tokenSource("gmail");
      await a.tokenSource("outlook");
      await a.signOut();
    }
    for (const [, value] of setItem.mock.calls) {
      expect(String(value)).not.toContain("SECRET");
    }
    // the only thing the real instance stores is the provider hint
    expect(setItem.mock.calls.map(([k]) => k)).toEqual(["jobtracker:lastProvider"]);
    expect(cookie).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) expect(store.getItem(store.key(i)!)).not.toContain("SECRET");
    }
    expect(window.location.href).not.toContain("SECRET");
  });
});

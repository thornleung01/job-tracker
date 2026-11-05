import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth, type Auth } from "../../src/auth";
import type { GoogleAccessToken, GoogleAuth, GoogleSignInResult } from "../../src/auth/google";
import type { MicrosoftAccessToken, MicrosoftAuth, MicrosoftSignInResult } from "../../src/auth/microsoft";
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
    prepare: vi.fn(async () => {}),
    signIn: vi.fn(async (_opts?: { mail?: boolean }): Promise<GoogleSignInResult> => ({ user: ada, mail: null })),
    requestMailToken: vi.fn(async (): Promise<GoogleAccessToken> => ({ token: SECRET_G, expiresAt: clock.now + 3600_000 })),
    revoke: vi.fn(async () => {}),
  } satisfies GoogleAuth;
  const microsoft = {
    prepare: vi.fn(async () => {}),
    signIn: vi.fn(async (_opts?: { mail?: boolean }): Promise<MicrosoftSignInResult> => ({ user: grace, mail: null })),
    requestMailToken: vi.fn(async (): Promise<MicrosoftAccessToken> => ({ token: SECRET_M, expiresAt: clock.now + 3600_000 })),
    clear: vi.fn(async () => {}),
  } satisfies MicrosoftAuth;
  const memory = new Map<string, string>();
  const hintStorage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) };
  const auth: Auth = createAuth({
    google,
    microsoft,
    now: () => clock.now,
    hintStorage,
  });
  return { auth, google, microsoft, clock, memory };
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
    const d = deferred<GoogleSignInResult>();
    google.signIn.mockReturnValueOnce(d.promise);
    const p = auth.signIn("google");
    expect(auth.getSession().status).toBe("signing-in");
    d.reject(new Error("popup closed"));
    await expect(p).rejects.toThrow("popup closed");
    expect(auth.getSession()).toMatchObject({ status: "signed-out", user: null, error: "popup closed" });
  });

  it("refuses a provider that has no client id configured", async () => {
    const auth = createAuth({ google: fakes().google, microsoft: fakes().microsoft, isConfigured: () => false });
    await expect(auth.signIn("google")).rejects.toThrow(/isn't available on this site/);
    expect(auth.getSession().error).toMatch(/isn't available on this site/);
  });

  it("prepares each provider", async () => {
    const { auth, google, microsoft } = fakes();
    await auth.prepare("google");
    expect(google.prepare).toHaveBeenCalledOnce();
    expect(microsoft.prepare).not.toHaveBeenCalled();
    await auth.prepare("microsoft");
    expect(microsoft.prepare).toHaveBeenCalledOnce();
  });

  it("calls the provider before awaiting anything, so its window opens inside the click", () => {
    const { auth, google, microsoft } = fakes();
    void auth.signIn("google").catch(() => undefined);
    expect(google.signIn).toHaveBeenCalledOnce();
    void auth.signIn("microsoft").catch(() => undefined);
    expect(microsoft.signIn).not.toHaveBeenCalled(); // already signing in: the first one has to be signed out first
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
    const next = createAuth({ google: f.google, microsoft: f.microsoft, hintStorage: { getItem: (k) => f.memory.get(k) ?? null, setItem: () => {} } });
    expect(next.getSession().lastProvider).toBe("microsoft");
    expect(next.getSession().status).toBe("signed-out");
  });
});

describe("one-click login that also connects the mailbox", () => {
  const mailToken = () => ({ token: SECRET_G, expiresAt: NOW + 3600_000 });

  it("signs in with Google by default asking for mail, sets mail.gmail and serves the token without another request", async () => {
    const { auth, google } = fakes();
    google.signIn.mockResolvedValueOnce({ user: ada, mail: mailToken() });
    await expect(auth.signIn("google")).resolves.toEqual(ada);
    expect(google.signIn).toHaveBeenCalledWith({});
    expect(auth.getSession().mail).toEqual({ gmail: true, outlook: false });
    await expect(auth.tokenSource("gmail")).resolves.toBe(SECRET_G);
    expect(google.requestMailToken).not.toHaveBeenCalled();
  });

  it("sets pendingSync, and takePendingSync returns it once and then null", async () => {
    const { auth, google } = fakes();
    google.signIn.mockResolvedValueOnce({ user: ada, mail: mailToken() });
    await auth.signIn("google");
    expect(auth.getSession().pendingSync).toBe("gmail");
    expect(auth.takePendingSync()).toBe("gmail");
    expect(auth.getSession().pendingSync).toBeNull();
    expect(auth.takePendingSync()).toBeNull();
    expect(auth.getSession().mail.gmail).toBe(true);
  });

  it("does the same for Microsoft with the outlook mailbox", async () => {
    const { auth, microsoft } = fakes();
    microsoft.signIn.mockResolvedValueOnce({ user: grace, mail: { token: SECRET_M, expiresAt: NOW + 3600_000 } });
    await auth.signIn("microsoft");
    expect(auth.getSession().mail).toEqual({ gmail: false, outlook: true });
    expect(auth.takePendingSync()).toBe("outlook");
    await expect(auth.tokenSource("outlook")).resolves.toBe(SECRET_M);
    expect(microsoft.requestMailToken).not.toHaveBeenCalled();
  });

  it("passes mail: false through and leaves the mailbox unconnected with nothing pending", async () => {
    const { auth, google } = fakes();
    await auth.signIn("google", { mail: false });
    expect(google.signIn).toHaveBeenCalledWith({ mail: false });
    expect(auth.getSession().mail).toEqual({ gmail: false, outlook: false });
    expect(auth.takePendingSync()).toBeNull();
    await expect(auth.tokenSource("gmail")).rejects.toThrow(/Gmail isn't connected/);
  });

  it("logs in without mail when the person declined Gmail", async () => {
    const { auth } = fakes(); // the fake returns mail: null
    await auth.signIn("google");
    expect(auth.getSession()).toMatchObject({ status: "signed-in", mail: { gmail: false, outlook: false }, pendingSync: null });
  });

  it("signing out clears a pending first sync and revokes the Google token from the login", async () => {
    const { auth, google } = fakes();
    google.signIn.mockResolvedValueOnce({ user: ada, mail: mailToken() });
    await auth.signIn("google");
    await auth.signOut();
    expect(auth.getSession().pendingSync).toBeNull();
    expect(google.revoke).toHaveBeenCalledWith(SECRET_G);
  });

  it("a login that finishes after sign-out keeps no mail token", async () => {
    const { auth, google } = fakes();
    const d = deferred<GoogleSignInResult>();
    google.signIn.mockReturnValueOnce(d.promise);
    const p = auth.signIn("google");
    await auth.signOut();
    d.resolve({ user: ada, mail: mailToken() });
    await expect(p).rejects.toThrow(/cancelled/);
    expect(auth.getSession()).toMatchObject({ status: "signed-out", pendingSync: null, mail: { gmail: false, outlook: false } });
    await expect(auth.tokenSource("gmail")).rejects.toBeInstanceOf(NotConnected);
  });

  it("keeps the failure message and leaves nothing pending", async () => {
    const { auth, microsoft } = fakes();
    microsoft.signIn.mockRejectedValueOnce(new Error("Your organization has to approve mail access. You can log in without it."));
    await expect(auth.signIn("microsoft")).rejects.toThrow(/organization/);
    expect(auth.getSession()).toMatchObject({ status: "signed-out", error: "Your organization has to approve mail access. You can log in without it.", pendingSync: null });
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
    const d = deferred<GoogleSignInResult>();
    google.signIn.mockReturnValueOnce(d.promise);
    const p = auth.signIn("google");
    await auth.signOut();
    d.resolve({ user: ada, mail: { token: SECRET_G, expiresAt: NOW + 3600_000 } });
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
      google: {
        prepare: async () => {},
        signIn: async () => ({ user: ada, mail: { token: SECRET_G, expiresAt: NOW + 3600_000 } }),
        requestMailToken: async () => ({ token: SECRET_G, expiresAt: NOW + 3600_000 }),
        revoke: async () => {},
      },
      microsoft: {
        prepare: async () => {},
        signIn: async () => ({ user: grace, mail: { token: SECRET_M, expiresAt: NOW + 3600_000 } }),
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

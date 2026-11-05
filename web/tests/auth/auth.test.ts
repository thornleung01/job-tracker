import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth, type Auth } from "../../src/auth";
import { createMicrosoftAuth, type MsalAccount, type MsalLike } from "../../src/auth/microsoft";
import { createGoogleAuth, type GisApi, type GoogleAccessToken, type GoogleAuth, type GoogleSignInResult } from "../../src/auth/google";
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
    mailboxAddress: vi.fn(async (_token: string, _signal?: AbortSignal) => "ada@gmail.com"),
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
    await expect(auth.tokenSource("gmail")).rejects.toBeInstanceOf(NotConnected);
    await expect(auth.tokenSource("outlook")).rejects.toBeInstanceOf(NotConnected);
  });

  it("signs in with Google and records the user", async () => {
    const { auth } = fakes();
    await expect(auth.signIn("google")).resolves.toEqual(ada);
    expect(auth.getSession()).toMatchObject({ status: "signed-in", user: ada, lastProvider: "google", error: null });
  });

  it("signs in with Microsoft", async () => {
    const { auth } = fakes();
    await auth.signIn("microsoft");
    expect(auth.getSession().user).toEqual(grace);
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

  it("revokes the Google token of a login that finishes after sign-out", async () => {
    const { auth, google } = fakes();
    const d = deferred<GoogleSignInResult>();
    google.signIn.mockReturnValueOnce(d.promise);
    const p = auth.signIn("google");
    await auth.signOut();
    expect(google.revoke).not.toHaveBeenCalled();
    d.resolve({ user: ada, mail: mailToken() });
    await expect(p).rejects.toThrow(/cancelled/);
    expect(google.revoke).toHaveBeenCalledWith(SECRET_G);
  });

  it("does not throw when revoking a discarded token fails", async () => {
    const { auth, google } = fakes();
    const d = deferred<GoogleSignInResult>();
    google.signIn.mockReturnValueOnce(d.promise);
    google.revoke.mockRejectedValueOnce(new Error("offline"));
    const p = auth.signIn("google");
    await auth.signOut();
    d.resolve({ user: ada, mail: mailToken() });
    await expect(p).rejects.toThrow(/cancelled/);
  });

  it("keeps the failure message and leaves nothing pending", async () => {
    const { auth, microsoft } = fakes();
    microsoft.signIn.mockRejectedValueOnce(new Error("Your organization has to approve mail access. You can log in without it."));
    await expect(auth.signIn("microsoft")).rejects.toThrow(/organization/);
    expect(auth.getSession()).toMatchObject({ status: "signed-out", error: "Your organization has to approve mail access. You can log in without it.", pendingSync: null });
  });
});

describe("a declined mail permission", () => {
  it("starts null and stays null when mail was connected", async () => {
    const { auth, google } = fakes();
    expect(auth.getSession().mailDeclined).toBeNull();
    google.signIn.mockResolvedValueOnce({ user: ada, mail: { token: SECRET_G, expiresAt: NOW + 3600_000 } });
    await auth.signIn("google");
    expect(auth.getSession().mailDeclined).toBeNull();
  });

  it("names gmail when Google logged in without the mail token", async () => {
    const { auth } = fakes(); // the fake returns mail: null
    await auth.signIn("google");
    expect(auth.getSession().mailDeclined).toBe("gmail");
    expect(auth.getSession().mail.gmail).toBe(false);
  });

  it("names outlook when Microsoft logged in without Mail.Read", async () => {
    const { auth } = fakes();
    await auth.signIn("microsoft");
    expect(auth.getSession().mailDeclined).toBe("outlook");
  });

  it("is not set when the login never asked for mail", async () => {
    const { auth } = fakes();
    await auth.signIn("google", { mail: false });
    expect(auth.getSession().mailDeclined).toBeNull();
  });

  it("is cleared when a mailbox is connected later, and by sign-out", async () => {
    const { auth } = fakes();
    await auth.signIn("google");
    expect(auth.getSession().mailDeclined).toBe("gmail");
    await auth.connectMail("gmail");
    expect(auth.getSession().mailDeclined).toBeNull();
    await auth.signOut();
    await auth.signIn("microsoft");
    expect(auth.getSession().mailDeclined).toBe("outlook");
    await auth.signOut();
    expect(auth.getSession().mailDeclined).toBeNull();
  });

  it("stays set when a later connect attempt fails", async () => {
    const { auth, google } = fakes();
    await auth.signIn("google");
    google.requestMailToken.mockRejectedValueOnce(new NotConnected("nope"));
    await expect(auth.connectMail("gmail")).rejects.toBeInstanceOf(NotConnected);
    expect(auth.getSession().mailDeclined).toBe("gmail");
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

describe("a silent refresh must belong to the mailbox that was connected", () => {
  const otherToken = (clock: { now: number }): GoogleAccessToken => ({ token: "ya29.OTHER-MAILBOX", expiresAt: clock.now + 3600_000 });
  const addressByToken = (map: Record<string, string>) => async (token: string) => map[token] ?? "ada@gmail.com";

  async function connected() {
    const f = fakes();
    f.google.signIn.mockResolvedValueOnce({ user: ada, mail: { token: SECRET_G, expiresAt: NOW + 3600_000 } });
    await f.auth.signIn("google");
    return f;
  }

  it("refuses a refreshed token that belongs to another Google account, and revokes it", async () => {
    const { auth, google, clock } = await connected();
    clock.now += 3600_000;
    google.requestMailToken.mockResolvedValueOnce(otherToken(clock));
    google.mailboxAddress.mockImplementation(addressByToken({ "ya29.OTHER-MAILBOX": "someone-else@gmail.com" }));
    const err = await auth.tokenSource("gmail").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotConnected);
    expect((err as Error).message).toMatch(/different Google account/);
    expect(google.revoke).toHaveBeenCalledWith("ya29.OTHER-MAILBOX");
    expect(auth.getSession().mail.gmail).toBe(false);
    expect(auth.getSession().error).toMatch(/different Google account/);
    await expect(auth.tokenSource("gmail")).rejects.toThrow(/isn't connected/); // the foreign token was never kept
  });

  it("accepts a refreshed token for the same mailbox, however the address is capitalised", async () => {
    const { auth, google, clock } = await connected();
    clock.now += 3600_000;
    google.requestMailToken.mockResolvedValueOnce({ token: "fresh", expiresAt: clock.now + 3600_000 });
    google.mailboxAddress.mockResolvedValue("Ada@Gmail.com");
    await expect(auth.tokenSource("gmail")).resolves.toBe("fresh");
    expect(auth.getSession().mail.gmail).toBe(true);
  });

  it("does not use the token or disconnect when the address can't be checked right now", async () => {
    const { auth, google, clock } = await connected();
    clock.now += 3600_000;
    google.requestMailToken.mockResolvedValueOnce({ token: "unchecked", expiresAt: clock.now + 3600_000 });
    google.mailboxAddress.mockRejectedValueOnce(new Error("Couldn't reach Google. Check your connection and try again."));
    const err = await auth.tokenSource("gmail").catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(NotConnected);
    expect(auth.getSession().mail.gmail).toBe(true);
    google.requestMailToken.mockResolvedValueOnce({ token: "retry", expiresAt: clock.now + 3600_000 });
    await expect(auth.tokenSource("gmail")).resolves.toBe("retry");
  });

  it("a deliberate connect can pick another account, and that account is the one checked afterwards", async () => {
    const { auth, google, clock } = await connected();
    google.requestMailToken.mockResolvedValueOnce(otherToken(clock));
    google.mailboxAddress.mockImplementation(addressByToken({ "ya29.OTHER-MAILBOX": "bob@gmail.com" }));
    await auth.connectMail("gmail");
    clock.now += 3600_000;
    google.requestMailToken.mockResolvedValueOnce({ token: "bob-fresh", expiresAt: clock.now + 3600_000 });
    google.mailboxAddress.mockResolvedValue("bob@gmail.com");
    await expect(auth.tokenSource("gmail")).resolves.toBe("bob-fresh");
    clock.now += 3600_000;
    google.requestMailToken.mockResolvedValueOnce({ token: "ada-again", expiresAt: clock.now + 3600_000 });
    google.mailboxAddress.mockResolvedValue("ada@gmail.com");
    await expect(auth.tokenSource("gmail")).rejects.toBeInstanceOf(NotConnected);
  });

  it("checks Gmail only: an Outlook refresh needs no lookup", async () => {
    const { auth, google, clock } = fakes();
    await auth.signIn("microsoft");
    await auth.connectMail("outlook");
    clock.now += 3600_000;
    await auth.tokenSource("outlook");
    expect(google.mailboxAddress).not.toHaveBeenCalled();
  });

  it("forgets the connected mailbox on sign-out, so the next person's connect is not compared with it", async () => {
    const { auth, google, clock } = await connected();
    await auth.signOut();
    await auth.signIn("microsoft");
    google.requestMailToken.mockResolvedValueOnce(otherToken(clock));
    google.mailboxAddress.mockImplementation(addressByToken({ "ya29.OTHER-MAILBOX": "someone-else@gmail.com" }));
    await auth.connectMail("gmail");
    clock.now += 3600_000;
    google.requestMailToken.mockResolvedValueOnce({ token: "fresh", expiresAt: clock.now + 3600_000 });
    google.mailboxAddress.mockResolvedValue("someone-else@gmail.com");
    await expect(auth.tokenSource("gmail")).resolves.toBe("fresh");
  });

  it("with the real Google module: another account's token from the chooser never reaches a sync", async () => {
    // The hinted Google session is gone, so the silent request ends in the account chooser and the person picks someone else.
    const owner: Record<string, string> = { "ya29.ADA": "ada@gmail.com", "ya29.OTHER": "someone-else@gmail.com" };
    let pick = "ya29.ADA";
    const gis: GisApi = {
      accounts: {
        oauth2: {
          initTokenClient: (cfg) => ({
            requestAccessToken: () => cfg.callback({ access_token: pick, expires_in: 3600, scope: "https://www.googleapis.com/auth/gmail.readonly" }),
          }),
          revoke: (_t, done) => done?.(),
        },
      },
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const bearer = (init?.headers as Record<string, string>).Authorization.replace("Bearer ", "");
      return new Response(JSON.stringify({ emailAddress: owner[bearer] }), { status: 200 });
    });
    const clock = { now: NOW };
    const realGoogle = createGoogleAuth({ clientId: "client", mailScope: "https://www.googleapis.com/auth/gmail.readonly", loadGis: async () => gis, now: () => clock.now, fetch: fetchMock as unknown as typeof fetch });
    const auth = createAuth({ google: realGoogle, microsoft: fakes().microsoft, now: () => clock.now, hintStorage: { getItem: () => null, setItem: () => {} } });
    // the login window is not under test: stub it to end signed in with Ada's Gmail token
    vi.spyOn(realGoogle, "signIn").mockResolvedValue({ user: ada, mail: { token: "ya29.ADA", expiresAt: NOW + 3600_000 } });
    await auth.signIn("google");
    await expect(auth.tokenSource("gmail")).resolves.toBe("ya29.ADA");
    clock.now += 3600_000;
    pick = "ya29.OTHER";
    await expect(auth.tokenSource("gmail")).rejects.toBeInstanceOf(NotConnected);
    expect(auth.getSession().mail.gmail).toBe(false);
  });
});

describe("an offline Outlook refresh", () => {
  it("keeps Outlook connected and lets the next sync try again", async () => {
    const account = { homeAccountId: "h", username: "grace@outlook.com" } as MsalAccount;
    let offline = false;
    const fake: MsalLike = {
      loginPopup: vi.fn(async () => ({ idToken: "", accessToken: "", expiresOn: null, account })),
      acquireTokenSilent: vi.fn(async () => {
        if (offline) throw Object.assign(new Error("offline"), { name: "BrowserAuthError", errorCode: "no_network_connectivity" });
        return { idToken: "", accessToken: SECRET_M, expiresOn: new Date(NOW + 3600_000), account };
      }),
      acquireTokenPopup: vi.fn(async () => ({ idToken: "", accessToken: SECRET_M, expiresOn: new Date(NOW + 3600_000), account })),
      clearCache: vi.fn(async () => {}),
    };
    const clock = { now: NOW };
    const realMicrosoft = createMicrosoftAuth({
      settings: { clientId: "c", authority: "a", redirectUri: "r" },
      loginScopes: ["openid"],
      mailScopes: ["Mail.Read"],
      createClient: async () => fake,
      now: () => clock.now,
    });
    const auth = createAuth({ google: fakes().google, microsoft: realMicrosoft, now: () => clock.now, hintStorage: { getItem: () => null, setItem: () => {} } });
    vi.spyOn(realMicrosoft, "signIn").mockResolvedValue({ user: grace, mail: null });
    await auth.signIn("microsoft");
    await auth.connectMail("outlook");
    clock.now += 3600_000;
    offline = true;
    const err = await auth.tokenSource("outlook").catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(NotConnected);
    expect(auth.getSession().mail.outlook).toBe(true);
    offline = false;
    await expect(auth.tokenSource("outlook")).resolves.toBe(SECRET_M);
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
    expect(auth.getSession().user).toEqual(grace);
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
        mailboxAddress: async () => "ada@gmail.com",
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

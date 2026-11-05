import { describe, expect, it, vi } from "vitest";
import { createMicrosoftAuth, type MsalAccount, type MsalLike, type MsalResult } from "../../src/auth/microsoft";
import { NotConnected } from "../../src/types";
import { MS_CLIENT_ID, NOW, makeJwt, msClaims } from "./helpers";

const account = { homeAccountId: "h", username: "grace@outlook.com" } as MsalAccount;
const settings = { clientId: MS_CLIENT_ID, authority: "https://login.microsoftonline.com/common", redirectUri: "https://thornleung01.github.io/job-tracker/" };

function interactionRequired() {
  return Object.assign(new Error("interaction_required"), { name: "InteractionRequiredAuthError", errorCode: "interaction_required" });
}

function setup(over: Partial<MsalLike> = {}, claimsOver: (nonce: string) => Record<string, unknown> = (nonce) => msClaims({ nonce })) {
  const result = (extra: Partial<MsalResult> = {}): MsalResult => ({
    accessToken: "",
    idToken: "",
    expiresOn: null,
    account,
    ...extra,
  });
  const fake: MsalLike = {
    loginPopup: vi.fn(async ({ nonce }) => result({ idToken: makeJwt(claimsOver(nonce ?? "")) })),
    acquireTokenSilent: vi.fn(async () => result({ accessToken: "eyJ.mail", expiresOn: new Date(NOW + 3600_000) })),
    acquireTokenPopup: vi.fn(async () => result({ accessToken: "eyJ.popup", expiresOn: new Date(NOW + 3600_000) })),
    clearCache: vi.fn(async () => {}),
    ...over,
  };
  const createClient = vi.fn(async () => fake);
  const auth = createMicrosoftAuth({
    settings,
    loginScopes: ["openid", "profile", "email"],
    mailScopes: ["Mail.Read"],
    createClient,
    makeNonce: () => "ms-nonce",
    now: () => NOW,
  });
  return { auth, fake, createClient };
}

describe("microsoft signIn", () => {
  it("asks for the login and mail scopes in one window, sends our nonce and returns the user", async () => {
    const { auth, fake } = setup();
    const { user } = await auth.signIn();
    expect(fake.loginPopup).toHaveBeenCalledWith({ scopes: ["openid", "profile", "email", "Mail.Read"], nonce: "ms-nonce" });
    expect(user).toMatchObject({ provider: "microsoft", sub: "AAAAAAAAbbbbbbbbCCCCCC", email: "grace@outlook.com", name: "Grace Hopper" });
  });

  it("returns the access token from the same window as the mail token when Mail.Read was granted", async () => {
    const { auth, fake } = setup({
      loginPopup: vi.fn(async ({ nonce }) => ({
        idToken: makeJwt(msClaims({ nonce })),
        accessToken: "eyJ.mail-from-login",
        expiresOn: new Date(NOW + 3000_000),
        account,
        scopes: ["openid", "profile", "email", "Mail.Read"],
      })),
    });
    const { mail } = await auth.signIn({ mail: true });
    expect(mail).toEqual({ token: "eyJ.mail-from-login", expiresAt: NOW + 3000_000 });
    // the account is remembered, so later silent refreshes work
    await auth.requestMailToken({ interactive: false });
    expect(fake.acquireTokenSilent).toHaveBeenCalledWith({ scopes: ["Mail.Read"], account });
  });

  it("matches the granted scope name regardless of case", async () => {
    const { auth } = setup({
      loginPopup: vi.fn(async ({ nonce }) => ({ idToken: makeJwt(msClaims({ nonce })), accessToken: "t", expiresOn: null, account, scopes: ["mail.read", "openid"] })),
    });
    expect((await auth.signIn()).mail?.token).toBe("t");
  });

  it("returns no mail token when the result does not include Mail.Read", async () => {
    const { auth } = setup({
      loginPopup: vi.fn(async ({ nonce }) => ({ idToken: makeJwt(msClaims({ nonce })), accessToken: "graph-profile-token", expiresOn: null, account, scopes: ["openid", "profile", "User.Read"] })),
    });
    expect((await auth.signIn()).mail).toBeNull();
  });

  it("with mail: false asks for the login scopes only and returns no mail token", async () => {
    const { auth, fake } = setup();
    const { mail } = await auth.signIn({ mail: false });
    expect(fake.loginPopup).toHaveBeenCalledWith({ scopes: ["openid", "profile", "email"], nonce: "ms-nonce" });
    expect(mail).toBeNull();
  });

  it.each([
    ["AADSTS65001", Object.assign(new Error("AADSTS65001: The user or administrator has not consented"), { errorCode: "invalid_grant" })],
    ["AADSTS90094", Object.assign(new Error("AADSTS90094: Admin consent is required"), { errorCode: "access_denied" })],
    ["consent_required", Object.assign(new Error("x"), { errorCode: "consent_required" })],
    ["interaction_required with admin", Object.assign(new Error("interaction_required: needs admin approval"), { errorCode: "interaction_required" })],
  ])("explains an admin consent block (%s)", async (_name, error) => {
    const { auth } = setup({ loginPopup: vi.fn(async () => Promise.reject(error)) });
    await expect(auth.signIn()).rejects.toThrow("Your organization has to approve mail access. You can log in without it.");
  });

  it("does not blame the organization when the person closed the window", async () => {
    const { auth } = setup({ loginPopup: vi.fn(async () => Promise.reject(Object.assign(new Error("user_cancelled"), { errorCode: "user_cancelled" }))) });
    await expect(auth.signIn()).rejects.toThrow(/Allow pop-ups/);
  });

  it("does not use the admin text when mail was not requested", async () => {
    const { auth } = setup({ loginPopup: vi.fn(async () => Promise.reject(new Error("AADSTS65001"))) });
    await expect(auth.signIn({ mail: false })).rejects.toThrow(/Allow pop-ups/);
  });

  it("prepare() warms the MSAL client without opening a window", async () => {
    const { auth, createClient, fake } = setup();
    await auth.prepare();
    await auth.prepare();
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(fake.loginPopup).not.toHaveBeenCalled();
  });

  it("rejects an ID token with the wrong nonce", async () => {
    const { auth } = setup({}, () => msClaims({ nonce: "other" }));
    await expect(auth.signIn()).rejects.toMatchObject({ code: "nonce" });
  });

  it("rejects an ID token for another app", async () => {
    const { auth } = setup({}, (nonce) => msClaims({ nonce, aud: "someone-else" }));
    await expect(auth.signIn()).rejects.toMatchObject({ code: "audience" });
  });

  it("rejects a foreign issuer", async () => {
    const { auth } = setup({}, (nonce) => msClaims({ nonce, iss: "https://evil.example/v2.0" }));
    await expect(auth.signIn()).rejects.toMatchObject({ code: "issuer" });
  });

  it("turns a closed popup into a readable error", async () => {
    const { auth } = setup({ loginPopup: vi.fn(async () => Promise.reject(new Error("user_cancelled"))) });
    await expect(auth.signIn()).rejects.toThrow(/Allow pop-ups/);
  });

  it("creates the MSAL client lazily and only once", async () => {
    const { auth, createClient } = setup();
    expect(createClient).not.toHaveBeenCalled();
    await auth.signIn();
    await auth.requestMailToken({ interactive: false });
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});

describe("microsoft mail token", () => {
  it("acquires Mail.Read silently for the signed-in account", async () => {
    const { auth, fake } = setup();
    await auth.signIn();
    const t = await auth.requestMailToken({ interactive: true });
    expect(fake.acquireTokenSilent).toHaveBeenCalledWith({ scopes: ["Mail.Read"], account });
    expect(fake.acquireTokenPopup).not.toHaveBeenCalled();
    expect(t).toEqual({ token: "eyJ.mail", expiresAt: NOW + 3600_000 });
  });

  it("falls back to a popup when consent is needed and the call is interactive", async () => {
    const { auth, fake } = setup({ acquireTokenSilent: vi.fn(async () => Promise.reject(interactionRequired())) });
    await auth.signIn();
    const t = await auth.requestMailToken({ interactive: true });
    expect(fake.acquireTokenPopup).toHaveBeenCalledWith({ scopes: ["Mail.Read"], account });
    expect(t.token).toBe("eyJ.popup");
  });

  it("throws NotConnected instead of opening a popup when not interactive", async () => {
    const { auth, fake } = setup({ acquireTokenSilent: vi.fn(async () => Promise.reject(interactionRequired())) });
    await auth.signIn();
    await expect(auth.requestMailToken({ interactive: false })).rejects.toBeInstanceOf(NotConnected);
    expect(fake.acquireTokenPopup).not.toHaveBeenCalled();
  });

  it("can connect Outlook with no Microsoft sign-in (Google identity) via popup", async () => {
    const { auth, fake } = setup();
    await expect(auth.requestMailToken({ interactive: false })).rejects.toBeInstanceOf(NotConnected);
    const t = await auth.requestMailToken({ interactive: true });
    expect(fake.acquireTokenPopup).toHaveBeenCalledWith({ scopes: ["Mail.Read"] });
    expect(t.token).toBe("eyJ.popup");
  });

  it("maps a closed popup to NotConnected", async () => {
    const { auth } = setup({ acquireTokenPopup: vi.fn(async () => Promise.reject(new Error("user_cancelled"))) });
    await expect(auth.requestMailToken({ interactive: true })).rejects.toBeInstanceOf(NotConnected);
  });

  it("lets non-auth failures such as network errors through", async () => {
    const { auth } = setup({ acquireTokenSilent: vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) });
    await auth.signIn();
    await expect(auth.requestMailToken({ interactive: false })).rejects.toBeInstanceOf(TypeError);
  });

  it("clear() empties the MSAL cache and forgets the account", async () => {
    const { auth, fake } = setup();
    await auth.signIn();
    await auth.clear();
    expect(fake.clearCache).toHaveBeenCalledOnce();
    await expect(auth.requestMailToken({ interactive: false })).rejects.toBeInstanceOf(NotConnected);
  });

  it("a login that finishes after clear() leaves no account behind and cancels", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    const { auth, fake } = setup({
      loginPopup: vi.fn(async ({ nonce }) => {
        await gate;
        return { idToken: makeJwt(msClaims({ nonce })), accessToken: "t", expiresOn: null, account, scopes: ["openid", "Mail.Read"] };
      }),
    });
    const p = auth.signIn();
    const settled = p.then(() => null, (e: unknown) => e as Error);
    await vi.waitFor(() => expect(fake.loginPopup).toHaveBeenCalled());
    await auth.clear();
    finish();
    expect((await settled)?.message).toMatch(/cancelled/);
    expect(fake.clearCache).toHaveBeenCalledTimes(2); // the sign-out, and again for what the late login cached
    await expect(auth.requestMailToken({ interactive: false })).rejects.toBeInstanceOf(NotConnected);
    expect(fake.acquireTokenSilent).not.toHaveBeenCalled();
  });

  it("clear() before any use does nothing", async () => {
    const { auth, createClient } = setup();
    await auth.clear();
    expect(createClient).not.toHaveBeenCalled();
  });
});

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
  it("logs in with OIDC scopes only, sends our nonce and returns the user", async () => {
    const { auth, fake } = setup();
    const user = await auth.signIn();
    expect(fake.loginPopup).toHaveBeenCalledWith({ scopes: ["openid", "profile", "email"], nonce: "ms-nonce" });
    expect(user).toMatchObject({ provider: "microsoft", sub: "AAAAAAAAbbbbbbbbCCCCCC", email: "grace@outlook.com", name: "Grace Hopper" });
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

  it("clear() before any use does nothing", async () => {
    const { auth, createClient } = setup();
    await auth.clear();
    expect(createClient).not.toHaveBeenCalled();
  });
});

// Microsoft identity via MSAL.js: authorization code + PKCE, popup interaction, in-memory cache.
// Popups are used instead of redirects so nothing has to survive a page navigation (and so MSAL's cache
// can stay in memory instead of sessionStorage).
import type { AccountInfo } from "@azure/msal-browser";
import { NotConnected } from "../types";
import { MICROSOFT_ISSUER, randomNonce, validateIdToken } from "./idToken";
import { userFromClaims, type AuthUser } from "./user";

export type MsalAccount = AccountInfo;
export interface MsalResult {
  accessToken: string;
  idToken: string;
  expiresOn: Date | null;
  account: MsalAccount | null;
  /** Scopes the token was granted for. */
  scopes?: string[];
}
/** The slice of PublicClientApplication this module uses; tests provide a fake. */
export interface MsalLike {
  loginPopup(request: { scopes: string[]; nonce?: string }): Promise<MsalResult>;
  acquireTokenSilent(request: { scopes: string[]; account: MsalAccount }): Promise<MsalResult>;
  acquireTokenPopup(request: { scopes: string[]; account?: MsalAccount }): Promise<MsalResult>;
  clearCache(): Promise<void>;
}

export interface MsalSettings {
  clientId: string;
  authority: string;
  redirectUri: string;
}

/** Lifetime assumed for a token whose response has no expiry, a little under MSAL's usual hour. */
const DEFAULT_TOKEN_MS = 55 * 60_000;

export async function createMsalClient(s: MsalSettings): Promise<MsalLike> {
  const { PublicClientApplication } = await import("@azure/msal-browser");
  const app = new PublicClientApplication({
    auth: {
      clientId: s.clientId,
      authority: s.authority,
      redirectUri: s.redirectUri,
      postLogoutRedirectUri: s.redirectUri,
      navigateToLoginRequestUrl: false,
    },
    // Tokens and interaction state stay in this tab's memory: nothing in localStorage or sessionStorage.
    cache: { cacheLocation: "memoryStorage", temporaryCacheLocation: "memoryStorage" },
  });
  await app.initialize();
  return app;
}

export interface MicrosoftDeps {
  settings: MsalSettings;
  loginScopes: string[];
  mailScopes: string[];
  createClient?: (s: MsalSettings) => Promise<MsalLike>;
  makeNonce?: () => string;
  now?: () => number;
}

export interface MicrosoftAccessToken {
  token: string;
  /** epoch ms */
  expiresAt: number;
}

export interface MicrosoftSignInResult {
  user: AuthUser;
  /** The Outlook access token from the same window, or null when mail wasn't asked for or wasn't granted. */
  mail: MicrosoftAccessToken | null;
}

export interface MicrosoftAuth {
  /** Starts MSAL early so the click isn't delayed by loading it. Safe to call often. */
  prepare(): Promise<void>;
  signIn(opts?: { mail?: boolean }): Promise<MicrosoftSignInResult>;
  /** Silent first; with `interactive` it falls back to a popup (needs a user gesture). */
  requestMailToken(opts: { interactive: boolean; signal?: AbortSignal }): Promise<MicrosoftAccessToken>;
  /** Drops every cached account and token for this tab. */
  clear(): Promise<void>;
}

// Every MSAL error carries a string errorCode, network failures included (network_error, no_network_connectivity, timed_out),
// so "has an errorCode" cannot mean "the person must act". Only these do; anything else is transient and keeps the mailbox connected.
const INTERACTION_CODES = new Set(["interaction_required", "consent_required", "login_required", "no_account_error", "invalid_grant"]);

function needsInteraction(e: unknown): boolean {
  const err = e as { name?: string; errorCode?: string } | null;
  return err?.name === "InteractionRequiredAuthError" || (typeof err?.errorCode === "string" && INTERACTION_CODES.has(err.errorCode));
}

/** What to tell the person when their organization blocks the mail permission. */
export const ADMIN_CONSENT_HINT = "Your organization has to approve mail access. You can log in without it.";

function needsAdminConsent(e: unknown): boolean {
  const err = e as { errorCode?: string; errorMessage?: string; message?: string; subError?: string } | null;
  const text = `${err?.errorCode ?? ""} ${err?.subError ?? ""} ${err?.errorMessage ?? ""} ${err?.message ?? ""}`;
  if (/AADSTS65001|AADSTS90094|consent_required/i.test(text)) return true;
  return /interaction_required/i.test(text) && /admin/i.test(text);
}

export function createMicrosoftAuth(deps: MicrosoftDeps): MicrosoftAuth {
  const create = deps.createClient ?? createMsalClient;
  const makeNonce = deps.makeNonce ?? (() => randomNonce());
  const now = deps.now ?? (() => Date.now());
  let client: Promise<MsalLike> | null = null;
  let account: MsalAccount | null = null;
  /** Bumped by clear(), so a login or token request that finishes after sign-out cannot bring the account back. */
  let generation = 0;

  const msal = () => (client ??= create(deps.settings).catch((e) => {
    client = null;
    throw e;
  }));

  function toToken(r: MsalResult, gen: number): MicrosoftAccessToken {
    if (!r.accessToken) throw new NotConnected("Outlook didn't return an access token. Try again.");
    if (r.account && gen === generation) account = r.account;
    return { token: r.accessToken, expiresAt: r.expiresOn?.getTime() ?? now() + DEFAULT_TOKEN_MS };
  }

  async function popup(app: MsalLike, gen: number): Promise<MicrosoftAccessToken> {
    try {
      return toToken(await app.acquireTokenPopup({ scopes: deps.mailScopes, ...(account ? { account } : {}) }), gen);
    } catch (e) {
      if (e instanceof NotConnected) throw e;
      throw new NotConnected("Outlook connection wasn't completed. Allow pop-ups and try again.");
    }
  }

  return {
    async prepare() {
      await msal();
    },

    async signIn(opts = {}) {
      const mail = opts.mail ?? true;
      const app = await msal();
      const gen = generation;
      const nonce = makeNonce();
      let result: MsalResult;
      try {
        result = await app.loginPopup({ scopes: mail ? [...deps.loginScopes, ...deps.mailScopes] : deps.loginScopes, nonce });
      } catch (e) {
        if (mail && needsAdminConsent(e)) throw new Error(ADMIN_CONSENT_HINT, { cause: e });
        throw new Error("Microsoft login wasn't completed. Allow pop-ups and try again.", { cause: e });
      }
      const claims = validateIdToken(result.idToken, {
        issuers: [MICROSOFT_ISSUER],
        audience: deps.settings.clientId,
        nonce,
        now: now(),
      });
      if (gen !== generation) {
        // Signed out while the window was open: forget what this login just cached and keep nothing.
        await app.clearCache().catch(() => undefined);
        throw new Error("Login was cancelled.");
      }
      account = result.account;
      const user = userFromClaims("microsoft", claims);
      const granted = (result.scopes ?? []).map((x) => x.toLowerCase());
      const gotMail = mail && !!result.accessToken && deps.mailScopes.every((x) => granted.includes(x.toLowerCase()));
      return { user, mail: gotMail ? toToken(result, gen) : null };
    },

    async requestMailToken({ interactive, signal }) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const app = await msal();
      const gen = generation;
      if (account) {
        try {
          return toToken(await app.acquireTokenSilent({ scopes: deps.mailScopes, account }), gen);
        } catch (e) {
          if (e instanceof NotConnected) throw e;
          if (!needsInteraction(e)) throw e;
        }
      }
      if (!interactive) throw new NotConnected("Outlook needs you to reconnect.");
      return popup(app, gen);
    },

    async clear() {
      generation++;
      account = null;
      const pending = client;
      client = null;
      if (pending) await (await pending.catch(() => null))?.clearCache();
    },
  };
}

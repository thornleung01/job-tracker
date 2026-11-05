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

export interface MicrosoftAuth {
  signIn(): Promise<AuthUser>;
  /** Silent first; with `interactive` it falls back to a popup (needs a user gesture). */
  requestMailToken(opts: { interactive: boolean; signal?: AbortSignal }): Promise<MicrosoftAccessToken>;
  /** Drops every cached account and token for this tab. */
  clear(): Promise<void>;
}

function needsInteraction(e: unknown): boolean {
  const err = e as { name?: string; errorCode?: string } | null;
  return err?.name === "InteractionRequiredAuthError" || typeof err?.errorCode === "string";
}

export function createMicrosoftAuth(deps: MicrosoftDeps): MicrosoftAuth {
  const create = deps.createClient ?? createMsalClient;
  const makeNonce = deps.makeNonce ?? (() => randomNonce());
  const now = deps.now ?? (() => Date.now());
  let client: Promise<MsalLike> | null = null;
  let account: MsalAccount | null = null;

  const msal = () => (client ??= create(deps.settings).catch((e) => {
    client = null;
    throw e;
  }));

  function toToken(r: MsalResult): MicrosoftAccessToken {
    if (!r.accessToken) throw new NotConnected("Outlook didn't return an access token. Try again.");
    if (r.account) account = r.account;
    return { token: r.accessToken, expiresAt: r.expiresOn?.getTime() ?? now() + 55 * 60_000 };
  }

  async function popup(app: MsalLike): Promise<MicrosoftAccessToken> {
    try {
      return toToken(await app.acquireTokenPopup({ scopes: deps.mailScopes, ...(account ? { account } : {}) }));
    } catch (e) {
      if (e instanceof NotConnected) throw e;
      throw new NotConnected("Outlook connection wasn't completed. Allow pop-ups and try again.");
    }
  }

  return {
    async signIn() {
      const app = await msal();
      const nonce = makeNonce();
      let result: MsalResult;
      try {
        result = await app.loginPopup({ scopes: deps.loginScopes, nonce });
      } catch (e) {
        throw new Error("Microsoft login wasn't completed. Allow pop-ups and try again.", { cause: e });
      }
      const claims = validateIdToken(result.idToken, {
        issuers: [MICROSOFT_ISSUER],
        audience: deps.settings.clientId,
        nonce,
        now: now(),
      });
      account = result.account;
      return userFromClaims("microsoft", claims);
    },

    async requestMailToken({ interactive, signal }) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const app = await msal();
      if (account) {
        try {
          return toToken(await app.acquireTokenSilent({ scopes: deps.mailScopes, account }));
        } catch (e) {
          if (e instanceof NotConnected) throw e;
          if (!needsInteraction(e)) throw e;
        }
      }
      if (!interactive) throw new NotConnected("Outlook needs you to reconnect.");
      return popup(app);
    },

    async clear() {
      account = null;
      const pending = client;
      client = null;
      if (pending) await (await pending.catch(() => null))?.clearCache();
    },
  };
}

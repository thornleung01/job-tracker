// Google Identity Services. One OAuth token-client window logs the person in and (unless they decline) grants
// Gmail read access. Identity comes from Google's tokeninfo endpoint for the access token; mail access is that same
// short-lived access token (no refresh token). Tokens stay in memory only.
import { NotConnected } from "../types";
import { userFromClaims, type AuthUser } from "./user";

export const GIS_SRC = "https://accounts.google.com/gsi/client";
export const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
// Not imported from providers/gmail: auth does not depend on the provider layer.
export const GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const DEFAULT_TOKEN_SECONDS = 3600;
/** Scopes that identify the person: only `sub` and `email` are read, so no `profile`. The mail scope is added when the person connects their mailbox. */
export const GOOGLE_LOGIN_SCOPES = "openid email";
const GOOGLE_ISSUER = "https://accounts.google.com";

/** What to tell the person when Google's sign-in window did not open or the silent token request failed. */
export const POPUP_HINT = "Your browser may have blocked the Google login window. Allow pop-ups for this site and try again.";
const CANCELLED = "Login was cancelled.";
const NOT_COMPLETED = "Google login wasn't completed. Try again.";
const NOT_VERIFIED = "Google login couldn't be verified. Try again.";
/** A failure that is not the person's doing (network, Google busy): the mailbox stays connected and a retry can work. */
export const GOOGLE_UNREACHABLE = "Couldn't reach Google. Check your connection and try again.";
const NEEDS_PERMISSION = "Gmail needs your permission to read your emails. Try again and allow access when Google asks.";
// What GIS answers when a silent request needs the person: consent, a login, or a window they have to see.
// Anything else (server_error, temporarily_unavailable, no code at all) is treated as transient.
const INTERACTION_ERRORS = new Set(["access_denied", "interaction_required", "consent_required", "login_required", "invalid_grant", "immediate_failed"]);

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string; scope?: string }): void;
}
export interface GisApi {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        prompt?: string;
        login_hint?: string;
        callback: (response: GisTokenResponse) => void;
        error_callback?: (error: { type?: string; message?: string }) => void;
      }): GisTokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}

/** Loads the GIS script once per loader; a failed load can be retried. */
export function createGisLoader(doc: Document = document, win: Window = window): () => Promise<GisApi> {
  let loading: Promise<GisApi> | null = null;
  const current = () => (win as unknown as { google?: GisApi }).google;
  return () => {
    const existing = current();
    if (existing?.accounts) return Promise.resolve(existing);
    loading ??= new Promise<GisApi>((resolve, reject) => {
      const script = doc.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.onload = () => {
        const gis = current();
        if (gis?.accounts) resolve(gis);
        else {
          loading = null;
          reject(new Error("Google login didn't load. Reload the page and try again."));
        }
      };
      script.onerror = () => {
        loading = null;
        script.remove();
        reject(new Error("Couldn't load Google login. Check your connection or content blocker."));
      };
      doc.head.appendChild(script);
    });
    return loading;
  };
}

export interface GoogleAccessToken {
  token: string;
  /** epoch ms */
  expiresAt: number;
}

export interface GoogleSignInResult {
  user: AuthUser;
  /** The Gmail access token from the same window, or null when mail wasn't asked for or wasn't granted. */
  mail: GoogleAccessToken | null;
}

export interface GoogleDeps {
  clientId: string;
  mailScope: string;
  loadGis: () => Promise<GisApi>;
  now?: () => number;
  fetch?: typeof fetch;
}

export interface GoogleAuth {
  /** Loads GIS and creates the token client, so signIn() can open its window inside the click. Safe to call often. */
  prepare(): Promise<void>;
  /**
   * Opens Google's window. When prepare() has finished, requestAccessToken runs synchronously in this call
   * (nothing awaited first), which keeps popup blockers happy. Call it directly from a click handler.
   */
  signIn(opts?: { mail?: boolean }): Promise<GoogleSignInResult>;
  /**
   * Needs a user gesture the first time; later calls re-acquire silently while the Google session lives.
   * Throws NotConnected only when the person has to act (consent, login, pop-up); a network or Google-side failure throws a plain Error.
   */
  requestMailToken(opts?: { loginHint?: string; signal?: AbortSignal }): Promise<GoogleAccessToken>;
  /** The Gmail address a mail token belongs to (the same lookup the account row uses). Lets a refreshed token be checked against the mailbox that was connected. */
  mailboxAddress(token: string, signal?: AbortSignal): Promise<string>;
  revoke(token: string): Promise<void>;
}

interface Pending {
  resolve(r: GisTokenResponse): void;
  reject(e: Error): void;
}

interface TokenInfo {
  aud?: unknown;
  azp?: unknown;
  sub?: unknown;
  email?: unknown;
  scope?: unknown;
}

export function createGoogleAuth(deps: GoogleDeps): GoogleAuth {
  const now = deps.now ?? (() => Date.now());
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  let loaded: GisApi | null = null;
  let loginClient: GisTokenClient | null = null;
  let preparing: Promise<void> | null = null;
  let pending: Pending | null = null;

  async function gis(): Promise<GisApi> {
    loaded = await deps.loadGis();
    return loaded;
  }

  function settle(): Pending | null {
    const p = pending;
    pending = null;
    return p;
  }

  function prepare(): Promise<void> {
    preparing ??= gis().then(
      (api) => {
        loginClient = api.accounts.oauth2.initTokenClient({
          client_id: deps.clientId,
          scope: `${GOOGLE_LOGIN_SCOPES} ${deps.mailScope}`,
          callback: (r) => settle()?.resolve(r),
          error_callback: (e) => {
            settle()?.reject(new Error(e.type === "popup_failed_to_open" ? POPUP_HINT : e.type === "popup_closed" ? CANCELLED : NOT_COMPLETED));
          },
        });
      },
      (e: unknown) => {
        preparing = null;
        throw e;
      },
    );
    return preparing;
  }

  /** Must run synchronously from the click. */
  function open(client: GisTokenClient, mail: boolean): Promise<GisTokenResponse> {
    settle()?.reject(new Error(CANCELLED));
    return new Promise<GisTokenResponse>((resolve, reject) => {
      pending = { resolve, reject };
      try {
        client.requestAccessToken(mail ? { prompt: "" } : { prompt: "", scope: GOOGLE_LOGIN_SCOPES });
      } catch (e) {
        settle();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  async function tokenInfo(accessToken: string): Promise<TokenInfo> {
    const body = new URLSearchParams({ access_token: accessToken });
    try {
      // Always a form POST: the token is never put in a URL, where it could end up in a log.
      const res = await doFetch(TOKENINFO_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
      if (!res.ok) throw new Error(NOT_VERIFIED);
      const info: unknown = await res.json();
      if (typeof info !== "object" || info === null) throw new Error(NOT_VERIFIED);
      return info as TokenInfo;
    } catch {
      throw new Error(NOT_VERIFIED);
    }
  }

  async function finish(r: GisTokenResponse, mail: boolean): Promise<GoogleSignInResult> {
    if (r.error === "access_denied") throw new Error(CANCELLED);
    if (r.error || !r.access_token) throw new Error(NOT_COMPLETED);
    const info = await tokenInfo(r.access_token);
    if (info.aud !== deps.clientId || (info.azp !== undefined && info.azp !== deps.clientId)) throw new Error(NOT_VERIFIED);
    if (typeof info.sub !== "string" || !/^\d+$/.test(info.sub)) throw new Error(NOT_VERIFIED);
    if (typeof info.email !== "string" || info.email === "") throw new Error("Google didn't share your email address. Try again.");
    const user = userFromClaims("google", { iss: GOOGLE_ISSUER, sub: info.sub, email: info.email });
    const granted = (r.scope ?? (typeof info.scope === "string" ? info.scope : "")).split(" ");
    const hasMailScope = granted.includes(deps.mailScope);
    if (!mail || !hasMailScope) {
      // Logged in without mail, but Google handed back a token that can read it anyway: it is never used, so end it.
      if (hasMailScope) void revoke(r.access_token).catch(() => undefined);
      return { user, mail: null };
    }
    const seconds = Number(r.expires_in ?? DEFAULT_TOKEN_SECONDS);
    return { user, mail: { token: r.access_token, expiresAt: now() + seconds * 1000 } };
  }

  async function mailboxAddress(token: string, signal?: AbortSignal): Promise<string> {
    let res: Response;
    try {
      res = await doFetch(GMAIL_PROFILE_URL, { method: "GET", headers: { Authorization: `Bearer ${token}` }, signal });
    } catch (e) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      throw new Error(GOOGLE_UNREACHABLE, { cause: e });
    }
    const data: unknown = res.ok ? await res.json().catch(() => null) : null;
    const address = typeof data === "object" && data !== null ? (data as { emailAddress?: unknown }).emailAddress : undefined;
    if (typeof address !== "string" || address === "") throw new Error("Gmail didn't share this account's email address. Try again.");
    return address;
  }

  async function revoke(token: string): Promise<void> {
    const api = loaded;
    if (!api) return;
    await new Promise<void>((resolve) => api.accounts.oauth2.revoke(token, () => resolve()));
  }

  return {
    prepare,

    signIn(opts = {}) {
      const mail = opts.mail ?? true;
      // Prepared: open the window right now, inside the caller's click.
      const response = loginClient ? open(loginClient, mail) : prepare().then(() => open(loginClient!, mail));
      return response.then((r) => finish(r, mail));
    },

    async requestMailToken({ loginHint, signal } = {}) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const api = await gis();
      return new Promise<GoogleAccessToken>((resolve, reject) => {
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
        signal?.addEventListener("abort", onAbort, { once: true });
        const done = <T,>(fn: (v: T) => void) => (v: T) => {
          signal?.removeEventListener("abort", onAbort);
          fn(v);
        };
        const client = api.accounts.oauth2.initTokenClient({
          client_id: deps.clientId,
          scope: deps.mailScope,
          prompt: "",
          ...(loginHint ? { login_hint: loginHint } : {}),
          callback: done((r: GisTokenResponse) => {
            if (r.error || !r.access_token) {
              if (r.error === "access_denied") reject(new NotConnected(NEEDS_PERMISSION));
              else if (r.error && INTERACTION_ERRORS.has(r.error)) reject(new NotConnected(POPUP_HINT));
              else reject(new Error(GOOGLE_UNREACHABLE));
            } else if (r.scope && !r.scope.split(" ").includes(deps.mailScope)) {
              reject(new NotConnected("Gmail access wasn't granted. Try again and allow access when Google asks."));
            } else {
              const seconds = Number(r.expires_in ?? DEFAULT_TOKEN_SECONDS);
              resolve({ token: r.access_token, expiresAt: now() + seconds * 1000 });
            }
          }),
          error_callback: done((e: { type?: string }) => {
            // The window did not open or was closed: the person has to act. Any other type is Google failing, not them.
            if (e.type === "popup_failed_to_open") reject(new NotConnected(POPUP_HINT));
            else if (e.type === "popup_closed") reject(new NotConnected("Gmail connection wasn't completed. Try again."));
            else reject(new Error(GOOGLE_UNREACHABLE));
          }),
        });
        client.requestAccessToken({ prompt: "" });
      });
    },

    mailboxAddress,

    revoke,
  };
}

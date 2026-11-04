// Google Identity Services. Identity comes from the ID token credential (so iss/aud/exp/nonce can be checked);
// mail access comes from the OAuth token client (short-lived access token, no refresh token).
import { NotConnected } from "../types";
import { GOOGLE_ISSUERS, randomNonce, validateIdToken } from "./idToken";
import { userFromClaims, type AuthUser } from "./user";

export const GIS_SRC = "https://accounts.google.com/gsi/client";

interface GisCredentialResponse {
  credential?: string;
}
interface GisPromptNotification {
  isNotDisplayed(): boolean;
  isSkippedMoment(): boolean;
  isDismissedMoment(): boolean;
}
interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
export interface GisApi {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: GisCredentialResponse) => void;
        nonce?: string;
        auto_select?: boolean;
        use_fedcm_for_prompt?: boolean;
      }): void;
      prompt(listener?: (notification: GisPromptNotification) => void): void;
      renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
      disableAutoSelect(): void;
      cancel(): void;
    };
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
          reject(new Error("Google sign-in loaded but is not available"));
        }
      };
      script.onerror = () => {
        loading = null;
        script.remove();
        reject(new Error("Could not load Google sign-in. Check your connection or content blocker."));
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

export interface GoogleDeps {
  clientId: string;
  mailScope: string;
  loadGis: () => Promise<GisApi>;
  makeNonce?: () => string;
  now?: () => number;
  /** Called when the rendered Google button (not signIn()) produced a valid identity. */
  onButtonSignIn?: (user: AuthUser) => void;
  onButtonError?: (error: Error) => void;
}

export interface GoogleAuth {
  /** Shows Google's prompt. It can be suppressed by the browser; renderButton is the dependable path. */
  signIn(): Promise<AuthUser>;
  renderButton(parent: HTMLElement, options?: Record<string, unknown>): Promise<void>;
  /** Needs a user gesture the first time; later calls re-acquire silently while the Google session lives. */
  requestMailToken(opts?: { loginHint?: string; signal?: AbortSignal }): Promise<GoogleAccessToken>;
  revoke(token: string): Promise<void>;
  disableAutoSelect(): void;
}

interface Settle {
  resolve(user: AuthUser): void;
  reject(error: Error): void;
}

export function createGoogleAuth(deps: GoogleDeps): GoogleAuth {
  const makeNonce = deps.makeNonce ?? (() => randomNonce());
  const now = deps.now ?? (() => Date.now());
  let loaded: GisApi | null = null;
  let activeNonce = "";
  let settle: Settle | null = null;

  function initialize(gis: GisApi): void {
    activeNonce = makeNonce();
    gis.accounts.id.initialize({
      client_id: deps.clientId,
      nonce: activeNonce,
      auto_select: false,
      use_fedcm_for_prompt: true,
      callback: onCredential,
    });
  }

  function onCredential(response: GisCredentialResponse): void {
    const pending = settle;
    settle = null;
    try {
      if (!response.credential) throw new Error("Google did not return a sign-in credential");
      const claims = validateIdToken(response.credential, {
        issuers: GOOGLE_ISSUERS,
        audience: deps.clientId,
        nonce: activeNonce,
        now: now(),
      });
      const user = userFromClaims("google", claims);
      if (pending) pending.resolve(user);
      else deps.onButtonSignIn?.(user);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (pending) pending.reject(err);
      else deps.onButtonError?.(err);
    } finally {
      // A nonce is single use; the rendered button keeps working with a fresh one.
      if (loaded) initialize(loaded);
    }
  }

  async function gis(): Promise<GisApi> {
    loaded = await deps.loadGis();
    return loaded;
  }

  return {
    async signIn() {
      const api = await gis();
      initialize(api);
      return new Promise<AuthUser>((resolve, reject) => {
        settle = { resolve, reject };
        api.accounts.id.prompt((n) => {
          if (n.isNotDisplayed() || n.isSkippedMoment()) {
            settle = null;
            reject(new Error("Google did not show its sign-in prompt. Use the Google button instead."));
          } else if (n.isDismissedMoment() && settle) {
            settle = null;
            reject(new Error("Sign-in was cancelled"));
          }
        });
      });
    },

    async renderButton(parent, options = {}) {
      const api = await gis();
      initialize(api);
      api.accounts.id.renderButton(parent, { type: "standard", theme: "outline", size: "large", text: "signin_with", ...options });
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
              reject(new NotConnected(`Gmail access needs your permission${r.error ? ` (${r.error})` : ""}`));
            } else if (r.scope && !r.scope.split(" ").includes(deps.mailScope)) {
              reject(new NotConnected("Gmail access was not granted"));
            } else {
              const seconds = Number(r.expires_in ?? 3600);
              resolve({ token: r.access_token, expiresAt: now() + seconds * 1000 });
            }
          }),
          error_callback: done((e: { type?: string }) => {
            reject(new NotConnected(e.type === "popup_failed_to_open" ? "Allow pop-ups for this site and connect Gmail again" : "Gmail connection was not completed"));
          }),
        });
        client.requestAccessToken({ prompt: "" });
      });
    },

    async revoke(token) {
      const api = loaded;
      if (!api) return;
      await new Promise<void>((resolve) => api.accounts.oauth2.revoke(token, () => resolve()));
    },

    disableAutoSelect() {
      loaded?.accounts.id.disableAutoSelect();
    },
  };
}

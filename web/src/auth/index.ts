// Auth entry point. Access tokens live only in this module's memory: never in localStorage, sessionStorage,
// cookies or the URL. The single persisted item is a non-secret "last used provider" hint (see session.ts).
import { config } from "../config";
import { NotConnected, type ProviderName, type TokenSource } from "../types";
import { createGisLoader, createGoogleAuth, type GoogleAuth } from "./google";
import { createMicrosoftAuth, type MicrosoftAuth } from "./microsoft";
import { readLastProvider, SessionStore, writeLastProvider, type Listener, type Session } from "./session";
import type { AuthUser, IdentityProvider } from "./user";

export { dbNameFor, userKey, type AuthUser, type IdentityProvider } from "./user";
export { IdTokenError, validateIdToken } from "./idToken";
export type { Session } from "./session";

const EXPIRY_MARGIN_MS = 60_000;
const REVOKE_TIMEOUT_MS = 3_000;
const MAIL_LABEL: Record<ProviderName, string> = { gmail: "Gmail", outlook: "Outlook" };

export type MailTarget = ProviderName | IdentityProvider;

function toMailProvider(p: MailTarget): ProviderName {
  return p === "google" ? "gmail" : p === "microsoft" ? "outlook" : p;
}

interface GoogleHooks {
  onButtonSignIn(user: AuthUser): void;
  onButtonError(error: Error): void;
}

export interface AuthDeps {
  google: (hooks: GoogleHooks) => GoogleAuth;
  microsoft: MicrosoftAuth;
  isConfigured?: (provider: IdentityProvider) => boolean;
  now?: () => number;
  /** Where the last-provider hint is kept; defaults to localStorage. */
  hintStorage?: Pick<Storage, "getItem" | "setItem">;
}

export interface Auth {
  signIn(provider: IdentityProvider): Promise<AuthUser>;
  /** Renders Google's own button; the session updates when the person completes it. */
  renderGoogleButton(parent: HTMLElement, options?: Record<string, unknown>): Promise<void>;
  signOut(): Promise<void>;
  connectMail(provider: MailTarget): Promise<void>;
  tokenSource: TokenSource;
  getSession(): Session;
  subscribe(listener: Listener): () => void;
  currentUser(): AuthUser | null;
}

interface StoredToken {
  token: string;
  expiresAt: number;
}

const abortError = () => new DOMException("Aborted", "AbortError");

function raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function withTimeout(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    p.then(
      () => {
        clearTimeout(t);
        resolve();
      },
      () => {
        clearTimeout(t);
        resolve();
      },
    );
  });
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createAuth(deps: AuthDeps): Auth {
  const now = deps.now ?? (() => Date.now());
  const store = new SessionStore(readLastProvider(deps.hintStorage));
  const tokens = new Map<ProviderName, StoredToken>();
  const inflight = new Map<ProviderName, Promise<string>>();
  /** Bumped on every sign-out so a request that was in flight cannot revive tokens afterwards. */
  let generation = 0;

  function completeSignIn(user: AuthUser): void {
    tokens.clear();
    inflight.clear();
    writeLastProvider(user.provider, deps.hintStorage);
    store.update({ status: "signed-in", user, mail: { gmail: false, outlook: false }, error: null, lastProvider: user.provider });
  }

  const google = deps.google({
    onButtonSignIn: completeSignIn,
    onButtonError: (e) => store.update({ status: "signed-out", error: message(e) }),
  });
  const microsoft = deps.microsoft;

  function setMail(provider: ProviderName, connected: boolean): void {
    store.update({ mail: { ...store.getSnapshot().mail, [provider]: connected } });
  }

  async function signOut(): Promise<void> {
    generation++;
    const googleToken = tokens.get("gmail")?.token;
    tokens.clear();
    inflight.clear();
    store.reset();
    google.disableAutoSelect();
    await Promise.allSettled([
      googleToken ? withTimeout(google.revoke(googleToken), REVOKE_TIMEOUT_MS) : Promise.resolve(),
      microsoft.clear(),
    ]);
  }

  async function signIn(provider: IdentityProvider): Promise<AuthUser> {
    if (deps.isConfigured && !deps.isConfigured(provider)) {
      const err = new Error(`${provider === "google" ? "Google" : "Microsoft"} login isn't available on this site yet.`);
      store.update({ status: "signed-out", error: err.message });
      throw err;
    }
    if (store.getSnapshot().status !== "signed-out") await signOut();
    const gen = generation;
    store.update({ status: "signing-in", error: null });
    try {
      const user = await (provider === "google" ? google.signIn() : microsoft.signIn());
      if (gen !== generation) throw new Error("Login was cancelled.");
      completeSignIn(user);
      return user;
    } catch (e) {
      if (gen === generation) store.update({ status: "signed-out", error: message(e) });
      throw e;
    }
  }

  async function acquire(provider: ProviderName, interactive: boolean, signal?: AbortSignal): Promise<StoredToken> {
    const user = store.getSnapshot().user;
    if (provider === "gmail") {
      return google.requestMailToken({ signal, ...(user?.provider === "google" && user.email ? { loginHint: user.email } : {}) });
    }
    return microsoft.requestMailToken({ interactive, signal });
  }

  async function connectMail(target: MailTarget): Promise<void> {
    const provider = toMailProvider(target);
    if (store.getSnapshot().status !== "signed-in") throw new NotConnected("Log in before you connect a mailbox.");
    const gen = generation;
    try {
      const t = await acquire(provider, true);
      if (gen !== generation) throw new NotConnected("You were logged out. Log in and try again.");
      tokens.set(provider, t);
      setMail(provider, true);
      store.update({ error: null });
    } catch (e) {
      if (gen === generation && e instanceof NotConnected) store.update({ error: e.message });
      throw e;
    }
  }

  const tokenSource: TokenSource = async (target, signal) => {
    const provider = toMailProvider(target);
    if (signal?.aborted) throw abortError();
    const session = store.getSnapshot();
    if (session.status !== "signed-in") throw new NotConnected("Log in first, then try again.");
    const cached = tokens.get(provider);
    if (cached && cached.expiresAt - now() > EXPIRY_MARGIN_MS) return cached.token;
    if (!session.mail[provider]) throw new NotConnected(`${MAIL_LABEL[provider]} isn't connected. Reconnect it and try again.`);

    let pending = inflight.get(provider);
    if (!pending) {
      const gen = generation;
      pending = (async () => {
        try {
          const t = await acquire(provider, false);
          if (gen !== generation) throw new NotConnected("Logged out");
          tokens.set(provider, t);
          return t.token;
        } catch (e) {
          if (gen === generation && e instanceof NotConnected) {
            tokens.delete(provider);
            setMail(provider, false);
            store.update({ error: e.message });
          }
          throw e;
        } finally {
          if (gen === generation) inflight.delete(provider);
        }
      })();
      inflight.set(provider, pending);
    }
    return raceAbort(pending, signal);
  };

  return {
    signIn,
    renderGoogleButton: (parent, options) => google.renderButton(parent, options),
    signOut,
    connectMail,
    tokenSource,
    getSession: store.getSnapshot,
    subscribe: store.subscribe,
    currentUser: () => store.getSnapshot().user,
  };
}

let instance: Auth | null = null;

function auth(): Auth {
  return (instance ??= createAuth({
    google: (hooks) =>
      createGoogleAuth({
        clientId: config.googleClientId,
        mailScope: config.googleMailScope,
        loadGis: createGisLoader(),
        ...hooks,
      }),
    microsoft: createMicrosoftAuth({
      settings: { clientId: config.msClientId, authority: config.msAuthority, redirectUri: config.redirectUri },
      loginScopes: config.msLoginScopes,
      mailScopes: config.msMailScopes,
    }),
    isConfigured: (p) => (p === "google" ? config.googleClientId !== "" : config.msClientId !== ""),
  }));
}

export const signIn = (provider: IdentityProvider) => auth().signIn(provider);
export const renderGoogleButton = (parent: HTMLElement, options?: Record<string, unknown>) => auth().renderGoogleButton(parent, options);
export const signOut = () => auth().signOut();
export const connectMail = (provider: MailTarget) => auth().connectMail(provider);
export const tokenSource: TokenSource = (provider, signal) => auth().tokenSource(provider, signal);
export const getSession = (): Session => auth().getSession();
export const subscribe = (listener: Listener): (() => void) => auth().subscribe(listener);
export const currentUser = (): AuthUser | null => auth().currentUser();

/**
 * True inside the Microsoft sign-in popup after it lands back on the app with the response in the URL.
 * The app should render nothing there and must not rewrite location.hash, or the opener cannot read the response.
 */
export function isAuthPopupWindow(win: Window = window): boolean {
  return win.opener != null && /[#&](code|error|state)=/.test(win.location.hash);
}

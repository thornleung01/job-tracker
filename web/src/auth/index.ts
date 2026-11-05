// Auth entry point. Access tokens live only in this module's memory: never in localStorage, sessionStorage,
// cookies or the URL. The single persisted item is a non-secret "last used provider" hint (see session.ts).
import { config } from "../config";
import { NotConnected, PROVIDER_LABEL, type ProviderName, type TokenSource } from "../types";
import { createGisLoader, createGoogleAuth, type GoogleAuth } from "./google";
import { createMicrosoftAuth, type MicrosoftAuth } from "./microsoft";
import { readLastProvider, SessionStore, writeLastProvider, type Listener, type Session } from "./session";
import type { AuthUser, IdentityProvider } from "./user";

export { dbNameFor, userKey, type AuthUser, type IdentityProvider } from "./user";
export { IdTokenError, validateIdToken } from "./idToken";
export type { Session } from "./session";

const EXPIRY_MARGIN_MS = 60_000;
const REVOKE_TIMEOUT_MS = 3_000;
const WRONG_ACCOUNT = "That's a different Google account from the one you connected. Reconnect Gmail with the right account.";

export type MailTarget = ProviderName | IdentityProvider;

function toMailProvider(p: MailTarget): ProviderName {
  return p === "google" ? "gmail" : p === "microsoft" ? "outlook" : p;
}

export interface AuthDeps {
  google: GoogleAuth;
  microsoft: MicrosoftAuth;
  isConfigured?: (provider: IdentityProvider) => boolean;
  now?: () => number;
  /** Where the last-provider hint is kept; defaults to localStorage. */
  hintStorage?: Pick<Storage, "getItem" | "setItem">;
}

export interface SignInOptions {
  /** Ask for mailbox access in the same window. Defaults to true. */
  mail?: boolean;
}

export interface Auth {
  /** Loads what the provider needs so signIn() can open its window straight from a click. Safe to call often. */
  prepare(provider: IdentityProvider): Promise<void>;
  /** Call it directly from a click handler: the provider window opens before anything is awaited. */
  signIn(provider: IdentityProvider, opts?: SignInOptions): Promise<AuthUser>;
  /** The mailbox the last login just connected, once; null afterwards or when none was connected. */
  takePendingSync(): ProviderName | null;
  signOut(): Promise<void>;
  connectMail(provider: MailTarget): Promise<void>;
  tokenSource: TokenSource;
  getSession(): Session;
  subscribe(listener: Listener): () => void;
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
  /**
   * The Gmail address (lowercase) the connected Google token belongs to, in memory only like the tokens. A silent refresh
   * can hand back another Google account's token (the hinted session is gone and the person picks another one in the chooser),
   * so every refreshed token is checked against this before it is used.
   */
  const mailboxes = new Map<ProviderName, string>();
  /** Bumped on every sign-out so a request that was in flight cannot revive tokens afterwards. */
  let generation = 0;

  function completeSignIn(user: AuthUser, mail: { token: string; expiresAt: number } | null, mailRequested: boolean, address: string | null): void {
    tokens.clear();
    inflight.clear();
    mailboxes.clear();
    writeLastProvider(user.provider, deps.hintStorage);
    const mailbox = toMailProvider(user.provider);
    const connected: Record<ProviderName, boolean> = { gmail: false, outlook: false };
    if (mail) {
      tokens.set(mailbox, { token: mail.token, expiresAt: mail.expiresAt });
      if (address) mailboxes.set(mailbox, address);
      connected[mailbox] = true;
    }
    store.update({
      status: "signed-in",
      user,
      mail: connected,
      pendingSync: mail ? mailbox : null,
      mailDeclined: mailRequested && !mail ? mailbox : null,
      error: null,
      lastProvider: user.provider,
    });
  }

  const google = deps.google;
  const microsoft = deps.microsoft;

  function setMail(provider: ProviderName, connected: boolean): void {
    store.update({ mail: { ...store.getSnapshot().mail, [provider]: connected } });
  }

  /** Ends a Google token nobody will use. Best effort: it never throws and never waits longer than the revoke timeout. */
  function discardGoogleToken(token: string): void {
    try {
      void withTimeout(google.revoke(token), REVOKE_TIMEOUT_MS);
    } catch {
      // nothing to do
    }
  }

  async function signOut(): Promise<void> {
    generation++;
    const googleToken = tokens.get("gmail")?.token;
    tokens.clear();
    inflight.clear();
    mailboxes.clear();
    store.reset();
    await Promise.allSettled([
      googleToken ? withTimeout(google.revoke(googleToken), REVOKE_TIMEOUT_MS) : Promise.resolve(),
      microsoft.clear(),
    ]);
  }

  /** Which Gmail address a token belongs to, or null when Google can't say right now (a retry will look again). */
  async function lookUpAddress(token: string): Promise<string | null> {
    try {
      return (await google.mailboxAddress(token)).toLowerCase();
    } catch {
      return null;
    }
  }

  function takePendingSync(): ProviderName | null {
    const pending = store.getSnapshot().pendingSync;
    if (pending) store.update({ pendingSync: null });
    return pending;
  }

  const prepare = (provider: IdentityProvider): Promise<void> => (provider === "google" ? google.prepare() : microsoft.prepare());

  // No await before the provider call when signed out: the provider's window has to open inside the click.
  async function signIn(provider: IdentityProvider, opts: SignInOptions = {}): Promise<AuthUser> {
    if (deps.isConfigured && !deps.isConfigured(provider)) {
      const err = new Error(`${provider === "google" ? "Google" : "Microsoft"} login isn't available on this site yet.`);
      store.update({ status: "signed-out", error: err.message });
      throw err;
    }
    if (store.getSnapshot().status !== "signed-out") await signOut();
    const gen = generation;
    store.update({ status: "signing-in", error: null });
    try {
      const { user, mail } = await (provider === "google" ? google.signIn(opts) : microsoft.signIn(opts));
      const address = mail && provider === "google" ? await lookUpAddress(mail.token) : null;
      if (gen !== generation) {
        if (mail && provider === "google") discardGoogleToken(mail.token);
        throw new Error("Login was cancelled.");
      }
      completeSignIn(user, mail, opts.mail !== false, address);
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
      // A deliberate connect may pick a different Google account than before: that account becomes the one that is checked from now on.
      const address = provider === "gmail" ? await lookUpAddress(t.token) : null;
      if (gen !== generation) throw new NotConnected("You were logged out. Log in and try again.");
      tokens.set(provider, t);
      if (address) mailboxes.set(provider, address);
      else mailboxes.delete(provider);
      store.update({ mail: { ...store.getSnapshot().mail, [provider]: true }, mailDeclined: null, error: null });
    } catch (e) {
      if (gen === generation && e instanceof NotConnected) store.update({ error: e.message });
      throw e;
    }
  }

  /** A token that comes back from a silent refresh must belong to the mailbox that was connected. Throws a plain Error when that can't be checked now. */
  async function checkMailbox(provider: ProviderName, t: StoredToken, gen: number): Promise<void> {
    if (provider !== "gmail") return; // MSAL refreshes against the remembered account and never switches it silently
    const address = (await google.mailboxAddress(t.token)).toLowerCase();
    if (gen !== generation) return; // logged out meanwhile: the caller drops the token
    const known = mailboxes.get(provider);
    if (known === undefined) {
      mailboxes.set(provider, address); // the connect-time lookup failed: trust the first one that works
    } else if (known !== address) {
      discardGoogleToken(t.token);
      throw new NotConnected(WRONG_ACCOUNT);
    }
  }

  const tokenSource: TokenSource = async (target, signal) => {
    const provider = toMailProvider(target);
    if (signal?.aborted) throw abortError();
    const session = store.getSnapshot();
    if (session.status !== "signed-in") throw new NotConnected("Log in first, then try again.");
    const cached = tokens.get(provider);
    if (cached && cached.expiresAt - now() > EXPIRY_MARGIN_MS) return cached.token;
    if (!session.mail[provider]) throw new NotConnected(`${PROVIDER_LABEL[provider]} isn't connected. Reconnect it and try again.`);

    let pending = inflight.get(provider);
    if (!pending) {
      const gen = generation;
      pending = (async () => {
        try {
          const t = await acquire(provider, false);
          await checkMailbox(provider, t, gen);
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
    prepare,
    signIn,
    takePendingSync,
    signOut,
    connectMail,
    tokenSource,
    getSession: store.getSnapshot,
    subscribe: store.subscribe,
  };
}

let instance: Auth | null = null;

function auth(): Auth {
  return (instance ??= createAuth({
    google: createGoogleAuth({
      clientId: config.googleClientId,
      mailScope: config.googleMailScope,
      loadGis: createGisLoader(),
    }),
    microsoft: createMicrosoftAuth({
      settings: { clientId: config.msClientId, authority: config.msAuthority, redirectUri: config.redirectUri },
      loginScopes: config.msLoginScopes,
      mailScopes: config.msMailScopes,
    }),
    isConfigured: (p) => (p === "google" ? config.googleClientId !== "" : config.msClientId !== ""),
  }));
}

export const prepare = (provider: IdentityProvider) => auth().prepare(provider);
export const signIn = (provider: IdentityProvider, opts?: SignInOptions) => auth().signIn(provider, opts);
export const takePendingSync = () => auth().takePendingSync();
export const signOut = () => auth().signOut();
export const connectMail = (provider: MailTarget) => auth().connectMail(provider);
export const tokenSource: TokenSource = (provider, signal) => auth().tokenSource(provider, signal);
export const getSession = (): Session => auth().getSession();
export const subscribe = (listener: Listener): (() => void) => auth().subscribe(listener);

/**
 * True inside the Microsoft sign-in popup after it lands back on the app with the response in the URL.
 * The app should render nothing there and must not rewrite location.hash, or the opener cannot read the response.
 */
export function isAuthPopupWindow(win: Window = window): boolean {
  return win.opener != null && /[#&](code|error|state)=/.test(win.location.hash);
}

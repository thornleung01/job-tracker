import type { ProviderName } from "../types";
import type { AuthUser, IdentityProvider } from "./user";

export interface Session {
  status: "signed-out" | "signing-in" | "signed-in";
  user: AuthUser | null;
  /** Which mailboxes have been connected in this tab. Never holds the tokens themselves. */
  mail: Record<ProviderName, boolean>;
  /** Last user-facing problem, cleared by the next attempt. */
  error: string | null;
  /** Non-secret hint from a previous visit, to highlight the provider the person used last. */
  lastProvider: IdentityProvider | null;
}

export type Listener = () => void;

const SIGNED_OUT: Omit<Session, "lastProvider"> = {
  status: "signed-out",
  user: null,
  mail: { gmail: false, outlook: false },
  error: null,
};

/** Tiny observable store. `getSnapshot` returns a stable object until something changes (useSyncExternalStore). */
export class SessionStore {
  private state: Session;
  private listeners = new Set<Listener>();

  constructor(lastProvider: IdentityProvider | null = null) {
    this.state = { ...SIGNED_OUT, lastProvider };
  }

  getSnapshot = (): Session => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update(patch: Partial<Session>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  reset(): void {
    this.update({ ...SIGNED_OUT });
  }
}

// The one thing that persists across visits: which provider was used last. It is not a secret and holds no token.
const LAST_PROVIDER_KEY = "jobtracker:lastProvider";

export function readLastProvider(storage: Pick<Storage, "getItem"> | undefined = safeLocalStorage()): IdentityProvider | null {
  try {
    const v = storage?.getItem(LAST_PROVIDER_KEY);
    return v === "google" || v === "microsoft" ? v : null;
  } catch {
    return null;
  }
}

export function writeLastProvider(provider: IdentityProvider, storage: Pick<Storage, "setItem"> | undefined = safeLocalStorage()): void {
  try {
    storage?.setItem(LAST_PROVIDER_KEY, provider);
  } catch {
    // storage may be blocked; the hint is optional
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

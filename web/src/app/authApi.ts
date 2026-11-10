// The slice of the auth module the shell and sign-in screen use. Tests pass a fake with the same shape.
import { getSession, prepare, signIn, signOut, subscribe, takePendingSync } from "../auth";
import type { Session } from "../auth";
import type { IdentityProvider } from "../auth/user";
import { lockAllVaults } from "../ai";
import { signOutAndForget } from "../sync/mailbox";
import type { ProviderName } from "../types";
import { clearAllFlows } from "./resumeFlowStorage";

export interface ShellAuth {
  getSession(): Session;
  subscribe(listener: () => void): () => void;
  /** Loads the provider so signIn can open its window inside the click. Call on mount; failures can be ignored. */
  prepare(provider: IdentityProvider): Promise<void>;
  /** Call directly from a click handler. `mail` defaults to true: the one window also connects the mailbox. */
  signIn(provider: IdentityProvider, opts?: { mail?: boolean }): Promise<void>;
  /** The provider whose mailbox the login just connected, once. Null otherwise. */
  takePendingSync(): ProviderName | null;
  signOut(): Promise<void>;
}

export const defaultAuth: ShellAuth = {
  getSession,
  subscribe,
  prepare,
  // The shell reads the result from the session, so the user isn't returned here.
  signIn: (provider, opts) => signIn(provider, opts).then(() => undefined),
  takePendingSync,
  // The remembered mailbox addresses go with the tokens, the unlocked AI key is locked again and the Resume page's saved job is dropped.
  signOut: signOutAndForget(signOut, () => {
    lockAllVaults();
    clearAllFlows();
  }),
};

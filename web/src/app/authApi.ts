// The slice of the auth module the shell and sign-in screen use. Tests pass a fake with the same shape.
import { getSession, renderGoogleButton, signIn, signOut, subscribe } from "../auth";
import type { Session } from "../auth";
import type { AuthUser, IdentityProvider } from "../auth/user";

export interface ShellAuth {
  getSession(): Session;
  subscribe(listener: () => void): () => void;
  signIn(provider: IdentityProvider): Promise<AuthUser>;
  renderGoogleButton(parent: HTMLElement, options?: Record<string, unknown>): Promise<void>;
  signOut(): Promise<void>;
}

export const defaultAuth: ShellAuth = { getSession, subscribe, signIn, renderGoogleButton, signOut };

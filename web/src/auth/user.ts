export type IdentityProvider = "google" | "microsoft";

/** The signed-in person. `{iss, sub}` is the identity; the rest is display only. */
export interface AuthUser {
  iss: string;
  sub: string;
  provider: IdentityProvider;
  email?: string;
  name?: string;
}

export type UserId = Pick<AuthUser, "iss" | "sub">;

/**
 * Stable string for a user. `sub` never contains ":" for Google or Microsoft, and `iss` comes from a fixed
 * allowlist, so `iss:sub` cannot be forged to equal another user's key.
 */
export function userKey(user: UserId): string {
  if (!user.iss || !user.sub) throw new Error("A user needs both iss and sub");
  if (user.sub.includes(":")) throw new Error("sub must not contain ':'");
  return `${user.iss}:${user.sub}`;
}

/** Name of this user's IndexedDB database, so two people on one browser never share data. */
export function dbNameFor(user: UserId): string {
  return `jobtracker:${userKey(user)}`;
}

interface ClaimsLike {
  iss: string;
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
}

export function userFromClaims(provider: IdentityProvider, claims: ClaimsLike): AuthUser {
  const email = claims.email ?? claims.preferred_username;
  const user: AuthUser = { iss: claims.iss, sub: claims.sub, provider };
  if (typeof email === "string") user.email = email;
  if (typeof claims.name === "string") user.name = claims.name;
  userKey(user); // reject unusable subjects early
  return user;
}

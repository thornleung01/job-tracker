// The stand-in "user" for builds with no OAuth client IDs (see isLocalMode in config.ts). It is a separate type, not
// a fourth AuthUser provider, so real-auth code keeps its narrow types. Only the local branch of App creates one.
import { LOCAL_DB_NAME } from "../config";
import { dbNameFor, type AuthUser } from "../auth/user";

export interface LocalUser {
  iss: "local";
  sub: "local";
  provider: "local";
  email?: undefined;
  name?: undefined;
}

export const LOCAL_USER: LocalUser = { iss: "local", sub: "local", provider: "local" };

/** What pages receive as `user`: a signed-in person, or the local stand-in. */
export type PageUser = AuthUser | LocalUser;

export const isLocalUser = (user: PageUser): user is LocalUser => user.provider === "local";

/** The one local database for the local user, or the per-user database for a signed-in person. */
export const dbNameForUser = (user: PageUser): string => (isLocalUser(user) ? LOCAL_DB_NAME : dbNameFor(user));

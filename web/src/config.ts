// Public build-time settings. Client IDs are public by design; there are no secrets in this app.
// They come from web/site-config.json (committed; the #/setup page generates it), or from the build environment
// (VITE_GOOGLE_CLIENT_ID and VITE_MS_CLIENT_ID in web/.env.local or repository variables), which wins.
// They are never read from the URL or from browser storage.
import siteConfig from "../site-config.json";

/** Google OAuth web client IDs look like 1234567890-abc123def.apps.googleusercontent.com */
export const GOOGLE_CLIENT_ID_RE = /^\d+-[0-9a-z]+\.apps\.googleusercontent\.com$/;
/** Microsoft application (client) IDs are GUIDs. */
export const MS_CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isGoogleClientId = (v: string): boolean => GOOGLE_CLIENT_ID_RE.test(v);
export const isMsClientId = (v: string): boolean => MS_CLIENT_ID_RE.test(v);

/** Where a client ID came from. "invalid" means site-config.json holds something that isn't an ID, so it is ignored. */
export type IdSource = "build" | "file" | "none" | "invalid";

export interface AppConfig {
  googleClientId: string;
  msClientId: string;
  /** Where each ID came from, for the setup page. */
  source: { google: IdSource; microsoft: IdSource };
  /** Vite base path, always starting and ending with a slash, e.g. /job-tracker/ */
  baseUrl: string;
  /** Microsoft SPA redirect URI: origin + base path. Must match the Entra registration exactly. */
  redirectUri: string;
  googleMailScope: string;
  msMailScopes: string[];
  msLoginScopes: string[];
  msAuthority: string;
}

type Env = Record<string, string | undefined>;

function pick(fromEnv: string | undefined, fromFile: unknown, valid: (v: string) => boolean): { id: string; source: IdSource } {
  if (fromEnv) return { id: fromEnv, source: "build" };
  const file = typeof fromFile === "string" ? fromFile.trim() : "";
  if (file === "") return { id: "", source: "none" };
  return valid(file) ? { id: file, source: "file" } : { id: "", source: "invalid" };
}

/** `file` is the parsed site-config.json. A non-empty build value wins and is not checked, the file value must match the ID format. */
export function loadConfig(env: Env = import.meta.env as Env, origin: string = window.location.origin, file: unknown = {}): AppConfig {
  const baseUrl = env.BASE_URL || "/";
  const f = (file && typeof file === "object" ? file : {}) as Record<string, unknown>;
  const google = pick(env.VITE_GOOGLE_CLIENT_ID, f.googleClientId, isGoogleClientId);
  const microsoft = pick(env.VITE_MS_CLIENT_ID, f.msClientId, isMsClientId);
  return {
    googleClientId: google.id,
    msClientId: microsoft.id,
    source: { google: google.source, microsoft: microsoft.source },
    baseUrl,
    redirectUri: origin + baseUrl,
    googleMailScope: "https://www.googleapis.com/auth/gmail.readonly",
    msMailScopes: ["Mail.Read"],
    msLoginScopes: ["openid", "profile", "email"],
    // "common" accepts work, school and personal accounts.
    msAuthority: "https://login.microsoftonline.com/common",
  };
}

/** The text of web/site-config.json for the two IDs: what the setup page asks the owner to commit. */
export function configJsonText(ids: { googleClientId: string; msClientId: string }): string {
  return JSON.stringify({ googleClientId: ids.googleClientId, msClientId: ids.msClientId }, null, 2) + "\n";
}

export const config: AppConfig = loadConfig(import.meta.env as Env, window.location.origin, siteConfig);

/**
 * True when this build has no OAuth client IDs at all. The app then opens without sign-in against one local
 * database (LOCAL_DB_NAME) in this browser, with no mailbox connection. Builds with IDs always require sign-in.
 */
export function isLocalMode(c: AppConfig = config): boolean {
  return c.googleClientId === "" && c.msClientId === "";
}

export const LOCAL_DB_NAME = "jobtracker:local";

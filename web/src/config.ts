// Public build-time settings. Client IDs are public by design; there are no secrets in this app.
// Set them in web/.env.local (git-ignored) or as repository variables in the Pages workflow.

export interface AppConfig {
  googleClientId: string;
  msClientId: string;
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

export function loadConfig(env: Env = import.meta.env as Env, origin: string = window.location.origin): AppConfig {
  const baseUrl = env.BASE_URL || "/";
  return {
    googleClientId: env.VITE_GOOGLE_CLIENT_ID ?? "",
    msClientId: env.VITE_MS_CLIENT_ID ?? "",
    baseUrl,
    redirectUri: origin + baseUrl,
    googleMailScope: "https://www.googleapis.com/auth/gmail.readonly",
    msMailScopes: ["Mail.Read"],
    msLoginScopes: ["openid", "profile", "email"],
    // "common" accepts work, school and personal accounts.
    msAuthority: "https://login.microsoftonline.com/common",
  };
}

export const config: AppConfig = loadConfig();

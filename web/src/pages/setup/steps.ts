// Values and links for the setup guide. Pure: nothing here reads the page, the config file or the network.

export interface SetupValues {
  /** The site's origin, the Authorized JavaScript origin for Google. */
  origin: string;
  /** Origin plus base path, the Single-page application redirect URI for Microsoft. */
  redirectUri: string;
  googleScopes: string;
  msScopes: string;
  privacyUrl: string;
}

/** `baseUrl` is Vite's BASE_URL: it starts and ends with a slash, like /job-tracker/. */
export function setupValues(origin: string, baseUrl: string): SetupValues {
  const redirectUri = origin + baseUrl;
  return {
    origin,
    redirectUri,
    googleScopes: "openid email https://www.googleapis.com/auth/gmail.readonly",
    msScopes: "openid profile email Mail.Read",
    privacyUrl: redirectUri + "privacy.html",
  };
}

export const googleLinks = {
  createProject: "https://console.cloud.google.com/projectcreate",
  gmailApi: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
  branding: "https://console.cloud.google.com/auth/branding",
  audience: "https://console.cloud.google.com/auth/audience",
  dataAccess: "https://console.cloud.google.com/auth/scopes",
  clients: "https://console.cloud.google.com/auth/clients",
} as const;

export const microsoftLinks = {
  appRegistrations: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
  freeAzure: "https://azure.microsoft.com/free",
} as const;

/** The message the owner sends to someone they've added as a Google test user. `siteUrl` is origin plus base path. */
export function inviteText(siteUrl: string): string {
  return [
    `Job Tracker is at ${siteUrl}`,
    "Choose Continue with Google and allow mail access.",
    "Google may say it hasn't verified the app. Choose Advanced, then Go to Job Tracker.",
    "Outlook needs nothing extra. Choose Continue with Microsoft instead.",
  ].join("\n");
}

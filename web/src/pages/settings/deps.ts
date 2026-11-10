// What the Settings sections reach outside the page for, so tests can hand in fakes: auth, the mail providers and the
// two file downloads. SettingsPage merges a test's partial deps over `defaultDeps`.
import { realAiDeps, type AiDeps } from "../../ai";
import { lockAllVaults } from "../../ai";
import { clearAllFlows } from "../../app/resumeFlowStorage";
import * as realAuth from "../../auth";
import type { Session } from "../../auth/session";
import { createProvider, getAddress } from "../../providers";
import type { ProviderName, TokenSource } from "../../types";
import { signOutAndForget, type MailDeps } from "../../sync/mailbox";
import type { BackupDeps } from "../../backup/deps";
import { downloadText } from "../../app/download";
import { config, type AppConfig } from "../../config";
import { downloadCsv } from "./exportCsv";

export interface SettingsAuth {
  getSession(): Session;
  subscribe(listener: () => void): () => void;
  signOut(): Promise<void>;
  connectMail(provider: ProviderName): Promise<void>;
  tokenSource: TokenSource;
}

export interface SettingsDeps extends Pick<MailDeps, "createProvider" | "getAddress"> {
  auth: SettingsAuth;
  download(filename: string, text: string): void;
  /** saves the applications spreadsheet; its own function because it is a different file type */
  downloadCsv(filename: string, text: string): void;
  /** the backup file and the storage status; left out, Your data uses the real browser APIs (backup/deps.ts) */
  backup?: BackupDeps;
  /** the AI key vault and the API call */
  ai: AiDeps;
}

export const defaultDeps: SettingsDeps = {
  auth: {
    getSession: realAuth.getSession,
    subscribe: realAuth.subscribe,
    signOut: signOutAndForget(realAuth.signOut, () => {
      lockAllVaults();
      clearAllFlows();
    }),
    connectMail: realAuth.connectMail,
    tokenSource: realAuth.tokenSource,
  },
  createProvider,
  getAddress,
  download: downloadText,
  downloadCsv,
  ai: realAiDeps,
};

/** The mail providers this site can connect: the ones with a client ID in the build. A build with neither (a test, the demo) offers both. */
export function availableProviders(c: Pick<AppConfig, "googleClientId" | "msClientId"> = config): ProviderName[] {
  const have: ProviderName[] = [];
  if (c.googleClientId) have.push("gmail");
  if (c.msClientId) have.push("outlook");
  return have.length > 0 ? have : ["gmail", "outlook"];
}

const NOT_SET_UP = "Mail sync isn't set up on this site.";
const SIGNED_OUT: Session = { status: "signed-out", user: null, mail: { gmail: false, outlook: false }, error: null, lastProvider: null, pendingSync: null, mailDeclined: null };

/** What Settings sees of auth in a local build: nothing. Never reaches the real auth module. */
export const NO_AUTH: SettingsAuth = {
  getSession: () => SIGNED_OUT,
  subscribe: () => () => undefined,
  signOut: async () => undefined,
  connectMail: async () => { throw new Error(NOT_SET_UP); },
  tokenSource: async () => { throw new Error(NOT_SET_UP); },
};

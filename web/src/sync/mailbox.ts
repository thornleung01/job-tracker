// Connecting a mailbox and syncing the connected ones: what the Settings page and the sync banner share, kept out of the
// components so it can be tested with fakes.
import { userKey, type AuthUser } from "../auth/user";
import { listAccounts, upsertAccount } from "../db/repo";
import type { AccountRow, JobTrackerDB } from "../db/schema";
import type { createProvider as createProviderFn, getAddress as getAddressFn } from "../providers";
import { NotConnected, type ProviderName, type TokenSource } from "../types";
import { accountLabel } from "./accountLabel";
import { syncAccount, syncFailureText, type Counts, type SyncProgress } from "./sync";

// -- which mailbox is connected in this tab ---------------------------------------------------
// Tokens live in the auth module and only know the provider. We also remember which address the person
// connected, so an account row is never synced with another mailbox's token. Memory only, like the tokens.
const connected = new Map<string, string>();
const keyFor = (user: AuthUser, provider: ProviderName) => `${userKey(user)}|${provider}`;

export const connectedAddress = (user: AuthUser, provider: ProviderName): string | null => connected.get(keyFor(user, provider)) ?? null;
export const forgetConnections = (): void => connected.clear();

/**
 * Wraps the auth module's signOut so the address map goes with the tokens, even when revoking them fails. `alsoForget` is anything else
 * that must not outlive the login (the AI key's unlocked copy), handed in so sync never imports it.
 */
export function signOutAndForget(signOut: () => Promise<void>, alsoForget?: () => void): () => Promise<void> {
  return async () => {
    try {
      await signOut();
    } finally {
      forgetConnections();
      alsoForget?.();
    }
  };
}

export interface MailDeps {
  connectMail(provider: ProviderName): Promise<void>;
  tokenSource: TokenSource;
  createProvider: typeof createProviderFn;
  getAddress: typeof getAddressFn;
}

export type RegisterResult = { id: number; address: string } | { inactive: AccountRow };

/**
 * Looks up the address of a mailbox whose token is already in memory and saves the account row. No window opens.
 * A mailbox the person switched off on purpose stays off unless `reactivate` is set (a deliberate Connect click).
 */
export async function registerMailbox(
  db: JobTrackerDB, user: AuthUser, provider: ProviderName, deps: Pick<MailDeps, "tokenSource" | "getAddress">, opts: { reactivate: true },
): Promise<{ id: number; address: string }>;
export async function registerMailbox(
  db: JobTrackerDB, user: AuthUser, provider: ProviderName, deps: Pick<MailDeps, "tokenSource" | "getAddress">, opts?: { reactivate?: boolean },
): Promise<RegisterResult>;
export async function registerMailbox(
  db: JobTrackerDB, user: AuthUser, provider: ProviderName, deps: Pick<MailDeps, "tokenSource" | "getAddress">, opts: { reactivate?: boolean } = {},
): Promise<RegisterResult> {
  const address = await deps.getAddress(provider, deps.tokenSource);
  if (!opts.reactivate) {
    const existing = await db.accounts.where("[provider+address]").equals([provider, address]).first();
    if (existing && !existing.active) return { inactive: existing };
  }
  const id = await upsertAccount(db, provider, address);
  connected.set(keyFor(user, provider), address);
  return { id, address };
}

/** Asks for mail access, looks up the address, and saves (or switches back on) the account row. */
export async function connectMailbox(db: JobTrackerDB, user: AuthUser, provider: ProviderName, deps: MailDeps): Promise<{ id: number; address: string }> {
  await deps.connectMail(provider);
  return registerMailbox(db, user, provider, deps, { reactivate: true });
}

export function isConnected(user: AuthUser, account: Pick<AccountRow, "provider" | "address">, sessionMail: Record<ProviderName, boolean>): boolean {
  return sessionMail[account.provider] && connectedAddress(user, account.provider) === account.address;
}

// -- sync --------------------------------------------------------------------------------------

export interface SyncReport {
  synced: { account: AccountRow; counts: Counts }[];
  /** accounts that need to be connected again before they can sync */
  needConnect: AccountRow[];
  failed: { account: AccountRow; message: string }[];
  stopped: boolean;
}

export interface SyncDeps extends Pick<MailDeps, "tokenSource" | "createProvider"> {
  isConnected(account: AccountRow): boolean;
}

export interface SyncOptions {
  /** 0 or undefined: new mail since the last sync (or the lookback setting on a first sync) */
  days?: number;
  signal?: AbortSignal;
  onAccount?(label: string): void;
  onProgress?(p: SyncProgress): void;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** Syncs the active accounts one after another. One broken account does not stop the rest. */
export async function runSync(db: JobTrackerDB, deps: SyncDeps, opts: SyncOptions = {}): Promise<SyncReport> {
  const report: SyncReport = { synced: [], needConnect: [], failed: [], stopped: false };
  for (const account of await listAccounts(db, { activeOnly: true })) {
    if (opts.signal?.aborted) {
      report.stopped = true;
      break;
    }
    if (!deps.isConnected(account)) {
      report.needConnect.push(account);
      continue;
    }
    opts.onAccount?.(accountLabel(account));
    let total: number | null = null;
    try {
      // Both providers yield oldest first and the sync saves as it reads (syncAccount's `incremental`): memory stays bounded on a
      // long Outlook scan, and a stopped or failed run keeps what it read. The last-sync time moves only when a run finishes, so
      // such a run is simply repeated from the same window (see the "stop" tests in tests/sync/perf3.test.ts).
      const provider = deps.createProvider(
        account.provider, deps.tokenSource,
        account.provider === "gmail" ? { oldestFirst: true, onPending: (n) => (total = n) } : { oldestFirst: true },
      );
      const counts = await syncAccount(db, account, provider, {
        days: opts.days || undefined,
        signal: opts.signal,
        progress: opts.onProgress,
        total: () => total,
        incremental: true,
      });
      report.synced.push({ account, counts });
    } catch (err) {
      if (isAbort(err)) {
        report.stopped = true;
        break;
      }
      if (err instanceof NotConnected) report.needConnect.push(account);
      else report.failed.push({ account, message: syncFailureText(err, account.provider) });
    }
  }
  return report;
}

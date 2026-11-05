// The logic behind the Settings buttons, kept out of the component so it can be tested with fakes.
import { listAccounts, upsertAccount } from "../../db/repo";
import type { AccountRow, JobTrackerDB } from "../../db/schema";
import { userKey, type AuthUser } from "../../auth/user";
import { importAll, importFromPythonExport, ImportError, PYTHON_FORMAT, type ImportSummary } from "../../portability";
import type { createProvider as createProviderFn, getAddress as getAddressFn } from "../../providers";
import { syncAccount, syncFailureText, type Counts, type SyncProgress } from "../../sync/sync";
import { NotConnected, type ProviderName, type TokenSource } from "../../types";

export const PROVIDER_LABEL: Record<ProviderName, string> = { gmail: "Gmail", outlook: "Outlook" };

// -- which mailbox is connected in this tab ---------------------------------------------------
// Tokens live in the auth module and only know the provider. We also remember which address the person
// connected, so an account row is never synced with another mailbox's token. Memory only, like the tokens.
const connected = new Map<string, string>();
const keyFor = (user: AuthUser, provider: ProviderName) => `${userKey(user)}|${provider}`;

export const connectedAddress = (user: AuthUser, provider: ProviderName): string | null => connected.get(keyFor(user, provider)) ?? null;
export const forgetConnections = (): void => connected.clear();

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

export const accountLabel = (a: Pick<AccountRow, "provider" | "address">) => `${PROVIDER_LABEL[a.provider]} ${a.address}`;

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
      const gmail = account.provider === "gmail";
      const provider = deps.createProvider(account.provider, deps.tokenSource, gmail ? { oldestFirst: true, onPending: (n) => (total = n) } : {});
      const counts = await syncAccount(db, account, provider, {
        days: opts.days || undefined,
        signal: opts.signal,
        progress: opts.onProgress,
        total: () => total,
        incremental: gmail,
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

/** Plain sentences for the result notice. */
export function describeSync(report: SyncReport): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  const added = report.synced.reduce((n, s) => n + (s.counts["applied-to-application"] ?? 0), 0);
  const review = report.synced.reduce((n, s) => n + (s.counts.review ?? 0), 0);
  if (report.synced.length > 0) {
    const n = report.synced.length;
    lines.push(`Synced ${n} account${n === 1 ? "" : "s"}. ${added} added to applications, ${review} ${review === 1 ? "needs" : "need"} review.`);
  }
  for (const a of report.needConnect) lines.push(`Reconnect ${accountLabel(a)}, then try again.`);
  for (const f of report.failed) lines.push(`${accountLabel(f.account)}: ${f.message}`);
  if (report.stopped) lines.push("Sync stopped.");
  if (lines.length === 0) lines.push("There are no accounts to sync.");
  return { ok: report.needConnect.length === 0 && report.failed.length === 0 && !report.stopped, lines };
}

// -- import ------------------------------------------------------------------------------------

export type ImportKind = "web" | "python";

export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export interface ParsedImport {
  kind: ImportKind;
  data: unknown;
}

/** Reads a chosen file. Throws ImportError when it is not JSON; deeper checks happen when importing. */
export function parseImportText(text: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError(["The file isn't valid JSON. Choose a file exported from Job Tracker."]);
  }
  const kind: ImportKind = (data as { format?: unknown } | null)?.format === PYTHON_FORMAT ? "python" : "web";
  return { kind, data };
}

export function runImport(db: JobTrackerDB, parsed: ParsedImport): Promise<ImportSummary> {
  return parsed.kind === "python" ? importFromPythonExport(db, parsed.data) : importAll(db, parsed.data);
}

export function describeImport(s: ImportSummary): string {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return `Imported ${n(s.applications, "application", "applications")} and ${n(s.emails, "email", "emails")}.`;
}

export function downloadText(filename: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const exportFilename = (now: Date = new Date()) => `job-tracker-${now.toISOString().slice(0, 10)}.json`;

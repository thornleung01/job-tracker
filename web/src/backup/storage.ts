// Persistent storage. Everything lives in IndexedDB, which a browser may clear when the device runs low on space unless
// the site has been granted persistent storage. persist() asks for that. Chrome and Edge decide silently from how the
// site is used; Firefox may show its own permission prompt (that is why it is asked once per session, and only when
// there is something to lose). Safari may refuse. estimate() reports how much space this site uses.
import { formatBytes } from "./format";

/** The parts of navigator.storage this uses, so tests can pass a fake. */
export interface StorageManagerLike {
  persist?(): Promise<boolean>;
  persisted?(): Promise<boolean>;
  estimate?(): Promise<{ usage?: number; quota?: number }>;
}

export type Persisted = "yes" | "no" | "unknown";

export interface StorageStatus {
  persisted: Persisted;
  /** bytes this site uses (all its storage, not just the data), or null when the browser doesn't say */
  usage: number | null;
  quota: number | null;
}

const realManager = (): StorageManagerLike | undefined => (typeof navigator === "undefined" ? undefined : navigator.storage);

/** Whether the browser will keep the data, and how much space it uses. Never throws: what a browser won't say is "unknown" or null. */
export async function storageStatus(manager: StorageManagerLike | undefined = realManager()): Promise<StorageStatus> {
  let persisted: Persisted = "unknown";
  let usage: number | null = null;
  let quota: number | null = null;
  try {
    if (manager?.persisted) persisted = (await manager.persisted()) ? "yes" : "no";
  } catch {
    // stays unknown
  }
  try {
    const estimate = await manager?.estimate?.();
    if (typeof estimate?.usage === "number") usage = estimate.usage;
    if (typeof estimate?.quota === "number") quota = estimate.quota;
  } catch {
    // stays null
  }
  return { persisted, usage, quota };
}

/** The status line under Your data. */
export function describeStorage(status: StorageStatus): string[] {
  const lines: string[] = [];
  if (status.persisted === "yes") lines.push("Your browser will keep this data.");
  else if (status.persisted === "no") lines.push("Your browser may clear this data if it runs low on space. Export a backup to be safe.");
  if (status.usage !== null) lines.push(`Job Tracker uses ${formatBytes(status.usage)} in this browser.`);
  return lines;
}

const ASKED_KEY = "jobtracker:persist-asked";
/** Where the answer is remembered when sessionStorage is blocked, so it is still asked once per page load. */
let askedInMemory = false;

function alreadyAsked(): boolean {
  if (askedInMemory) return true;
  try {
    return sessionStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

function markAsked(): void {
  askedInMemory = true;
  try {
    sessionStorage.setItem(ASKED_KEY, "1");
  } catch {
    // the in-memory flag still holds for this page load
  }
}

/** For tests: forget that this session asked. */
export function resetPersistAsked(): void {
  askedInMemory = false;
}

/**
 * Asks the browser to keep the data, at most once per session (tab session: a reload doesn't ask again) and only when
 * there is data. Does nothing when the browser has no persist(), or already keeps the data. Returns whether it asked.
 */
export async function requestPersistence(hasData: boolean, manager: StorageManagerLike | undefined = realManager()): Promise<boolean> {
  if (!hasData || !manager?.persist || alreadyAsked()) return false;
  markAsked();
  try {
    if (manager.persisted && (await manager.persisted())) return false;
    await manager.persist();
    return true;
  } catch {
    return false;
  }
}

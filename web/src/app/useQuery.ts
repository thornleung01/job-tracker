import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { isSyncing } from "../sync/syncLock";

/** While a sync runs, a query re-runs at most this often. A sync writes once per message and each write would otherwise re-read whole tables. */
export const SYNC_THROTTLE_MS = 1000;
/** How often a held-back run checks whether the sync has ended, so the last run follows the end of the sync closely. */
const SYNC_POLL_MS = 25;

export interface QueryOptions {
  /** Keep re-running on every write, even during a sync. For a query whose screen must not lag. */
  live?: boolean;
  /** Keep showing the previous result while new deps load (a filter change) instead of going back to loading. */
  keepPrevious?: boolean;
}

const sameDeps = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

/**
 * Run a read against the user's database and re-run it whenever the tables it touched change
 * (Dexie liveQuery). `undefined` means still loading, and again when `deps` change (a different record must not show the
 * previous one), unless `keepPrevious` is set. Errors are thrown to the nearest error boundary.
 *
 * During a sync the re-runs are held back to one per second and the last one happens as the sync ends. Dexie starts a
 * new run for every write and ignores the older ones, so waiting before the read, and letting only the newest waiter read,
 * coalesces the burst. The value after the sync is the database's.
 */
export function useQuery<T>(read: () => Promise<T> | T, deps: unknown[], options: QueryOptions = {}): T | undefined {
  const [held, setHeld] = useState<{ deps: unknown[]; value: T | undefined }>({ deps, value: undefined });
  const [error, setError] = useState<unknown>(null);
  const live = options.live ?? false;
  useEffect(() => {
    setError(null);
    let lastStart = 0;
    let latest = 0;
    const querier = async () => {
      const mine = ++latest;
      // The first run after mount never waits, so a page opened mid-sync still shows at once.
      while (!live && lastStart && isSyncing() && Date.now() - lastStart < SYNC_THROTTLE_MS) {
        await new Promise((r) => setTimeout(r, SYNC_POLL_MS));
        // Dexie starts a new run for every write and drops the older one's result, so only the newest waiter goes on to read.
        if (mine !== latest) return undefined as T;
      }
      lastStart = Date.now();
      return read();
    };
    const sub = liveQuery(querier).subscribe({ next: (value) => setHeld({ deps, value }), error: setError });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, live]);
  if (error) throw error;
  return options.keepPrevious || sameDeps(held.deps, deps) ? held.value : undefined;
}

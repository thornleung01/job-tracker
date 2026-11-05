// One mailbox sync at a time. Settings' Sync now and the sync banner both start syncs, and two at once would read the
// same mailbox twice and write the same rows twice. Whoever gets the lock runs, and gives it back when done.

let held = false;

/** Returns the release function, or null when a sync is already running. Calling release twice is harmless. */
export function tryAcquire(): (() => void) | null {
  if (held) return null;
  held = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held = false;
  };
}

/** True while a sync holds the lock. Only looks: it never takes it. */
export const isSyncing = (): boolean => held;

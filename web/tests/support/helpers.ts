// Waiting helpers shared by the DOM test helpers (tests/app/helpers.ts and tests/pages/applications/harness.ts).
//
// Fixed sleeps are tuned for an idle laptop. On a busy 2-core CI runner the same work takes several times longer, so a
// fixed sleep ends before liveQuery, fake-indexeddb or a navigation has finished. The helpers here keep the happy path
// as fast as the old sleep and only wait longer when the machine is demonstrably slow.

/** The machine counts as busy for a while after any of our timers fires late: load comes in waves, and a late timer is the one signal we can see. */
const BUSY_MEMORY_MS = 5_000;
const LATE_MS = 8;
let busyUntil = 0;
const isBusy = () => performance.now() < busyUntil;

export const sleep = (ms: number) =>
  new Promise<void>((r) => {
    const start = performance.now();
    setTimeout(() => {
      if (performance.now() - start - ms > LATE_MS) busyUntil = performance.now() + BUSY_MEMORY_MS;
      r();
    }, ms);
  });

// fake-indexeddb runs every request as a setImmediate task, and liveQuery re-renders from those. Counting the ones still
// queued tells us whether database work is in flight, which the DOM alone does not (a navigation changes no markup).
let queued = 0;
type Immediate = ((fn: (...args: unknown[]) => void, ...args: unknown[]) => unknown) & { counted?: boolean };
const scope = globalThis as unknown as { setImmediate?: Immediate };
const nativeSetImmediate = scope.setImmediate;
if (nativeSetImmediate && !nativeSetImmediate.counted) {
  const counted: Immediate = (fn, ...args) => {
    queued++;
    return nativeSetImmediate(() => {
      queued--;
      fn(...args);
    });
  };
  counted.counted = true;
  scope.setImmediate = counted;
}

/** Once the machine looks busy, wait at least this long for chained async work (IndexedDB, liveQuery, navigation). */
const BUSY_FLOOR_MS = 150;
const POLL_MS = 25;
const BUSY_CAP_MS = 5000;

const snapshot = () => `${window.location.hash}|${document.body.innerHTML}`;

/**
 * Sleeps `ms`. If the timer fired late (a loaded machine), keeps waiting until the page has stopped changing for a few
 * polls and at least BUSY_FLOOR_MS have passed. Call it inside `act` so React flushes while waiting.
 */
export async function quiesce(ms: number): Promise<void> {
  const start = performance.now();
  await sleep(ms);
  // Database work still queued: give it time to finish and for what it triggers to queue more, then recheck.
  for (let idle = 0; idle < 2 && performance.now() - start < BUSY_CAP_MS; ) {
    if (queued === 0) idle++;
    else idle = 0;
    await sleep(queued === 0 ? 1 : 5);
  }
  if (!isBusy()) return;
  const busyStart = performance.now();
  let last = snapshot();
  let stable = 0;
  while (performance.now() - busyStart < BUSY_CAP_MS) {
    await sleep(POLL_MS);
    const now = snapshot();
    stable = now === last ? stable + 1 : 0;
    last = now;
    if (stable >= 3 && performance.now() - busyStart >= BUSY_FLOOR_MS) return;
  }
}

/** Generous on purpose: a wait returns the moment its condition holds, so the limit only matters when something is wrong. */
export const WAIT_TIMEOUT_MS = 15_000;

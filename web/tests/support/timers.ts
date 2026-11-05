// Fake timers for tests about a timeout (a debounce, a note that clears itself) so they don't wait for it in real time.
// Only setTimeout and clearTimeout are faked: fake-indexeddb and React schedule with setImmediate and microtasks, which stay real.
import { act } from "react";
import { vi } from "vitest";

/** Call it after the page is mounted and settled: the DOM helpers wait with real setTimeout, which would hang once it is faked. Undo with `vi.useRealTimers()`. */
export function fakeTimeouts(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

/** Moves the fake clock forward inside `act`, so React has flushed what the timers did when it returns. */
export async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** A click that does not wait on real timers (the harness `click` does), for use after `fakeTimeouts()`. */
export async function clickNow(el: Element | null): Promise<void> {
  if (!el) throw new Error("Nothing to click");
  await act(async () => {
    (el as HTMLElement).click();
  });
}

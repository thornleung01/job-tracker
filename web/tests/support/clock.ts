// Pins the clock to a fixed day, so tests with dates written into them don't depend on when they run (a day later, a year
// later, or a test run that crosses midnight or New Year). Time still moves forward at its normal speed from that
// starting point, so waits with a time limit still work. Call it once at the top of a test file.
import { afterEach, beforeEach, vi } from "vitest";

export const PINNED_NOW = "2026-11-05T12:00:00Z";

/** The moment `n` days before now. */
export const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);

export function pinClock(at: string = PINNED_NOW): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(at));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

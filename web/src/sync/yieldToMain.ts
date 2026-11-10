// Gives the page a turn between chunks of a long job, so clicks and scrolling are not frozen while it runs.

/** How many emails are classified between two yields: a few milliseconds of work each time. */
export const CLASSIFY_CHUNK = 200;

/**
 * Lets the browser handle input and paint, then carries on. A message-channel hop rather than a timer: it is not slowed
 * to 4 ms by nesting, and a test that fakes timers cannot stall it.
 */
export function yieldToMain(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sched?.yield) return sched.yield();
  if (typeof MessageChannel === "undefined") return new Promise((r) => setTimeout(r, 0));
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(null);
  });
}

import { useCallback, useEffect, useRef, useState } from "react";
import { ActionError } from "../sync/actions";
import { ActivityError, MissingRecordError } from "../sync/activity";
import { ContactKeyError } from "../sync/contacts";

/** A sentence that is safe to show for something that went wrong. Validation errors carry their own wording. */
export function messageFor(error: unknown): string {
  if (error instanceof ActionError || error instanceof ActivityError || error instanceof ContactKeyError) return error.message;
  if (error instanceof MissingRecordError) return "That no longer exists. Go back to the list and try again.";
  return "Couldn't save that. Try again.";
}

export interface ActionRunner {
  /** the key of the action in flight, or null */
  busy: string | null;
  error: string | null;
  status: string | null;
  /** Runs one action at a time. Resolves true when it finished, false when it failed (the error is then set). */
  run(key: string, fn: () => Promise<string | void>): Promise<boolean>;
  clear(): void;
  /** props for a button that starts the action `key`: busy marks it, and every button in the group is disabled meanwhile */
  button(key: string): { "aria-busy"?: true; disabled: boolean };
}

/** Busy state, error text and success text for the forms of one component. No page reloads: results flow back through Dexie liveQuery. */
export function useAction(): ActionRunner {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (key: string, fn: () => Promise<string | void>) => {
    if (running.current) return false;
    running.current = true;
    setBusy(key);
    setError(null);
    setStatus(null);
    try {
      const done = await fn();
      if (mounted.current) setStatus(done || null);
      return true;
    } catch (e) {
      if (mounted.current) setError(messageFor(e));
      return false;
    } finally {
      running.current = false;
      if (mounted.current) setBusy(null);
    }
  }, []);

  const clear = useCallback(() => {
    setError(null);
    setStatus(null);
  }, []);
  const button = useCallback((key: string) => ({ ...(busy === key ? { "aria-busy": true as const } : {}), disabled: busy !== null }), [busy]);
  return { busy, error, status, run, clear, button };
}

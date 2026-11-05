// How a running mailbox sync is tracked, written once for the two screens that start syncs (the Settings page and the
// banner under the header). They share one lock (sync/syncLock.ts), one progress line and one stop button, and differ
// only in what they do around the run: Settings just syncs, the banner reconnects first.
import { useCallback, useEffect, useRef, useState } from "react";
import type { SyncProgress } from "../../sync/sync";
import { tryAcquire } from "../../sync/syncLock";

export interface ProgressState {
  label: string;
  /** null while the total is not known yet */
  percent: number | null;
  note: string;
}

/** The progress line for one event from the sync: "Gmail me@x.com: finding emails" or "...: reading 3 of 40". */
export function progressFromEvent(account: string, p: SyncProgress): ProgressState {
  return {
    label: p.phase === "finding" ? `${account}: finding emails` : `${account}: reading ${p.done}${p.total ? ` of ${p.total}` : ""}`,
    percent: p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : null,
    note: p.note,
  };
}

/** One sync in flight. `end` must be called exactly once, whatever happened. */
export interface SyncRun {
  signal: AbortSignal;
  /** Shows a line of your own, like "Connecting Gmail", before the sync starts reporting. */
  show(label: string): void;
  /** The two callbacks `runSync` takes: they remember which account is being read and turn each event into a progress line. */
  onAccount(account: string): void;
  onProgress(p: SyncProgress): void;
  /** Gives the lock back and clears the progress. Call it before setting your own result, in the same turn, so they render together. */
  end(): void;
}

export interface SyncRunner {
  /** The line to show while a sync runs, or null when none is running. */
  progress: ProgressState | null;
  /** True while a sync that this component started is running. Reads a ref, so it is current inside timers. */
  isActive(): boolean;
  /** False once the component has unmounted, so late results are not stored. */
  isMounted(): boolean;
  /** Asks the running sync to stop. */
  stop(): void;
  /** Takes the one sync lock. Null when a sync is already running (here or in the other screen): nothing was started. */
  begin(label: string): SyncRun | null;
}

/** The state machine behind both screens: idle, then running with a progress line, then idle again. A sync keeps going only while its component is mounted. */
export function useSyncRun(): SyncRunner {
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  const show = useCallback((state: ProgressState | null) => {
    if (mounted.current) setProgress(state);
  }, []);

  const begin = useCallback((label: string): SyncRun | null => {
    const release = tryAcquire();
    if (!release) return null;
    const controller = new AbortController();
    abort.current = controller;
    show({ label, percent: null, note: "" });
    let account = "";
    return {
      signal: controller.signal,
      show: (text) => show({ label: text, percent: null, note: "" }),
      onAccount: (name) => {
        account = name;
        show({ label: `${name}: finding emails`, percent: null, note: "" });
      },
      onProgress: (p) => show(progressFromEvent(account, p)),
      end: () => {
        release();
        abort.current = null;
        show(null);
      },
    };
  }, [show]);

  const isActive = useCallback(() => abort.current !== null, []);
  const isMounted = useCallback(() => mounted.current, []);
  const stop = useCallback(() => abort.current?.abort(), []);
  return { progress, isActive, isMounted, stop, begin };
}

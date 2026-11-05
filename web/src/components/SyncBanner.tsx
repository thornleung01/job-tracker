// A one-click way back to a synced mailbox after a reload. Tokens live in memory only, so a signed-in person
// otherwise has to open Settings, press Connect for each mailbox and then Sync. This does all three in one press,
// through the same connectMailbox and runSync that Settings uses, so the two screens cannot drift apart.
// Right after a login that also connected a mailbox (autoStart), it registers that mailbox and runs the first sync by itself.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { isLocalUser, type PageUser } from "../app/localUser";
import { useQuery } from "../app/useQuery";
import * as realAuth from "../auth";
import type { Session } from "../auth/session";
import type { AuthUser } from "../auth/user";
import { isLocalMode } from "../config";
import type { AccountRow, JobTrackerDB } from "../db/schema";
import { PROVIDER_LABEL, accountLabel, connectMailbox, isConnected, registerMailbox, runSync, type MailDeps, type SyncReport } from "../pages/settings/actions";
import { createProvider, getAddress } from "../providers";
import { accountSummaries } from "../sync/queries";
import { isSyncing, tryAcquire } from "../sync/syncLock";
import type { SyncProgress } from "../sync/sync";
import { NotConnected, type ProviderName, type TokenSource } from "../types";
import "./syncbanner.css";

export interface SyncBannerDeps extends Pick<MailDeps, "createProvider" | "getAddress"> {
  auth: {
    getSession(): Session;
    subscribe(listener: () => void): () => void;
    connectMail(provider: ProviderName): Promise<void>;
    tokenSource: TokenSource;
    /** The mailbox the login just connected, once. Null otherwise. */
    takePendingSync(): ProviderName | null;
  };
}

export const defaultDeps: SyncBannerDeps = {
  auth: { getSession: realAuth.getSession, subscribe: realAuth.subscribe, connectMail: realAuth.connectMail, tokenSource: realAuth.tokenSource, takePendingSync: realAuth.takePendingSync },
  createProvider,
  getAddress,
};

interface Progress {
  label: string;
  percent: number | null;
}

interface Result {
  ok: boolean;
  lines: string[];
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Plain sentences for what the one click did. */
export function describeBanner(report: SyncReport | null, problems: string[]): Result {
  const lines = [...problems];
  if (report) {
    const read = report.synced.reduce(
      (n, s) => n + Object.entries(s.counts).reduce((m, [k, v]) => (k === "duplicate" || k === "error" || k === "retry" ? m : m + (v ?? 0)), 0),
      0,
    );
    const review = report.synced.reduce((n, s) => n + (s.counts.review ?? 0), 0);
    if (report.synced.length > 0) {
      lines.push(read === 0 ? "Synced. No new emails." : `Synced ${read} new ${plural(read, "email", "emails")}.${review ? ` ${review} ${plural(review, "needs", "need")} review.` : ""}`);
    }
    for (const a of report.needConnect) lines.push(`Reconnect ${accountLabel(a)}, then try again.`);
    for (const f of report.failed) lines.push(`${accountLabel(f.account)}: ${f.message}`);
    if (report.stopped) lines.push("Sync stopped.");
  }
  if (lines.length === 0) lines.push("There are no accounts to sync.");
  const ok = problems.length === 0 && !!report && report.needConnect.length === 0 && report.failed.length === 0 && !report.stopped;
  return { ok, lines };
}

export interface SyncBannerProps {
  db: JobTrackerDB;
  user: PageUser;
  deps?: Partial<SyncBannerDeps>;
  /** Overrides isLocalMode(); local builds have no mail sync at all, so nothing shows. */
  local?: boolean;
  /**
   * Take the mailbox the login just connected and sync it, with no window. Nothing happens while this is false (the
   * carry-over offer may still be waiting for an answer).
   */
  autoStart?: boolean;
  /**
   * On a page that has its own Connect and Sync buttons (Settings). Shows nothing unless a sync is running or has a
   * result, and never asks to reconnect. It stays mounted, so a sync keeps going when the person moves to that page.
   */
  quiet?: boolean;
}

export function SyncBanner(props: SyncBannerProps) {
  const { user } = props;
  if ((props.local ?? isLocalMode()) || isLocalUser(user)) return null;
  return <Banner {...props} user={user} />;
}

function Banner({ db, user, deps: given, autoStart = false, quiet = false }: SyncBannerProps & { user: AuthUser }) {
  const deps: SyncBannerDeps = { ...defaultDeps, ...given };
  const { auth } = deps;
  const session = useSyncExternalStore(auth.subscribe, auth.getSession);
  const accounts = useQuery(() => accountSummaries(db), [db]);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);
  // Focus moves to the result only when the person pressed Reconnect and sync themselves. An automatic first sync
  // finishes seconds after login, wherever they are by then, and role=status already announces what it found.
  const focusResult = useRef(false);
  useEffect(() => {
    if (result && focusResult.current) {
      focusResult.current = false;
      box.current?.focus();
    }
  }, [result]);

  // Always call the newest closure: it runs from a timer, not from a render.
  const start = useRef(reconnectAndSync);
  useLayoutEffect(() => {
    start.current = reconnectAndSync;
  });
  const taken = useRef(false);
  // Deferred a tick so React's development double-mount (mount, unmount, mount) takes the pending mailbox only once,
  // and a real unmount in between takes nothing.
  useEffect(() => {
    if (!autoStart || taken.current) return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      if (!mounted.current || taken.current || busy.current) return;
      // Settings' own sync is running: wait for it rather than take the mailbox and lose it.
      if (isSyncing()) {
        retry = setTimeout(attempt, 250);
        return;
      }
      taken.current = true;
      const provider = auth.takePendingSync();
      if (provider) void start.current(provider);
    };
    const timer = setTimeout(attempt, 0);
    return () => {
      clearTimeout(timer);
      clearTimeout(retry);
    };
  }, [autoStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const needed: AccountRow[] = (accounts ?? []).filter((a) => a.active && !isConnected(user, a, session.mail));

  /** `auto` is a mailbox that is already connected: register it and sync, with no window. Otherwise reconnect what's needed. */
  async function reconnectAndSync(auto?: ProviderName) {
    if (busy.current) return;
    const release = tryAcquire();
    if (!release) {
      setResult({ ok: true, lines: ["A sync is already running."] });
      return;
    }
    busy.current = true;
    if (auto) focusResult.current = false;
    let switchedOff: ProviderName | null = null;
    const controller = new AbortController();
    abort.current = controller;
    const providers = auto ? [] : [...new Set(needed.map((a) => a.provider))];
    const safe = <T,>(fn: (v: T) => void) => (v: T) => {
      if (mounted.current) fn(v);
    };
    const setProg = safe(setProgress);
    setRunning(true);
    setResult(null);
    setProg({ label: auto ? `Connecting ${PROVIDER_LABEL[auto]}` : "Connecting", percent: null });
    const problems: string[] = [];
    let report: SyncReport | null = null;
    try {
      // The first connect must stay inside the click's own turn so the browser lets the Google window open.
      let connectedAny = false;
      if (auto) {
        try {
          const done = await registerMailbox(db, user, auto, { tokenSource: auth.tokenSource, getAddress: deps.getAddress });
          if ("inactive" in done) switchedOff = auto;
          else connectedAny = true;
        } catch (e) {
          problems.push(`Couldn't connect ${PROVIDER_LABEL[auto]}. ${errorText(e)}`);
        }
      }
      for (const provider of providers) {
        if (controller.signal.aborted) break;
        setProg({ label: `Connecting ${PROVIDER_LABEL[provider]}`, percent: null });
        try {
          await connectMailbox(db, user, provider, {
            connectMail: auth.connectMail, tokenSource: auth.tokenSource, createProvider: deps.createProvider, getAddress: deps.getAddress,
          });
          connectedAny = true;
        } catch (e) {
          problems.push(e instanceof NotConnected ? e.message : `Couldn't connect ${PROVIDER_LABEL[provider]}. ${errorText(e)}`);
        }
      }
      if (connectedAny) {
        let label = "";
        report = await runSync(
          db,
          { tokenSource: auth.tokenSource, createProvider: deps.createProvider, isConnected: (a) => isConnected(user, a, auth.getSession().mail) },
          {
            signal: controller.signal,
            onAccount: (l) => {
              label = l;
              setProg({ label: `${l}: finding emails`, percent: null });
            },
            onProgress: (p: SyncProgress) =>
              setProg({
                label: p.phase === "finding" ? `${label}: finding emails` : `${label}: reading ${p.done}${p.total ? ` of ${p.total}` : ""}`,
                percent: p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : null,
              }),
          },
        );
      }
    } catch (e) {
      problems.push(errorText(e));
    } finally {
      abort.current = null;
      busy.current = false;
      release();
      if (mounted.current) {
        setResult(switchedOff ? { ok: true, lines: [`${PROVIDER_LABEL[switchedOff]} is switched off in Settings.`] } : describeBanner(report, problems));
        setRunning(false);
        setProgress(null);
      }
    }
  }

  if (accounts === undefined) return null;
  if (!running && !result && (quiet || needed.length === 0)) return null;

  const err = !running && result !== null && !result.ok;
  const showButton = (!quiet && needed.length > 0) || running;
  return (
    <div
      key={err ? "err" : "info"}
      ref={box}
      className={`notice sync-banner${err ? " err" : ""}`}
      role={err ? "alert" : "status"}
      aria-busy={running || undefined}
      tabIndex={-1}
    >
      <div>
        {running ? (
          <>
            <p className="line">{progress?.label ?? "Connecting"}</p>
            <div className={`bar${progress?.percent == null ? " indet" : ""}`} role="progressbar" aria-label="Sync progress" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={progress?.percent ?? undefined}>
              <i style={progress?.percent != null ? { width: `${progress.percent}%` } : undefined} />
            </div>
          </>
        ) : result ? (
          result.lines.map((l, i) => <p className="line" key={i}>{l}</p>)
        ) : (
          <p className="line">Reconnect to sync your mailbox.</p>
        )}
        {(showButton || running || result) && (
          <div className="sync-banner-actions">
            {showButton && (
              <button className="primary" disabled={running} aria-busy={running || undefined} onClick={() => {
                focusResult.current = true;
                void reconnectAndSync();
              }}>
                Reconnect and sync
              </button>
            )}
            {running && <button className="quiet" onClick={() => abort.current?.abort()}>Stop</button>}
            {!running && result && <button className="quiet" onClick={() => setResult(null)}>Dismiss</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// A one-click way back to a synced mailbox after a reload. Tokens live in memory only, so a signed-in person
// otherwise has to open Settings, press Connect for each mailbox and then Sync. This does all three in one press.
// It uses the same connectMailbox and runSync as Settings, and the same progress tracking, lock and problem wording
// (components/syncprogress/), so what a sync shows does not depend on which screen started it.
// Right after a login that also connected a mailbox (autoStart), it registers that mailbox and runs the first sync by itself.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { isLocalUser, type PageUser } from "../app/localUser";
import { useQuery } from "../app/useQuery";
import * as realAuth from "../auth";
import type { Session } from "../auth/session";
import type { AuthUser } from "../auth/user";
import type { AccountRow, JobTrackerDB } from "../db/schema";
import { PROVIDER_LABEL } from "../sync/accountLabel";
import { connectMailbox, isConnected, registerMailbox, runSync, type MailDeps, type SyncReport } from "../sync/mailbox";
import { createProvider, getAddress } from "../providers";
import { accountSummaries } from "../sync/queries";
import { isSyncing } from "../sync/syncLock";
import { NotConnected, type ProviderName, type TokenSource } from "../types";
import { useSyncRun } from "./syncprogress/progress";
import { ALREADY_RUNNING, describeBannerRun, errorText, type RunResult } from "./syncprogress/result";
import { SyncBar } from "./syncprogress/SyncBar";
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

export interface SyncBannerProps {
  db: JobTrackerDB;
  user: PageUser;
  deps?: Partial<SyncBannerDeps>;
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
  if (isLocalUser(user)) return null;  // the local edition has no mail sync
  return <Banner {...props} user={user} />;
}

function Banner({ db, user, deps: given, autoStart = false, quiet = false }: SyncBannerProps & { user: AuthUser }) {
  const deps: SyncBannerDeps = { ...defaultDeps, ...given };
  const { auth } = deps;
  const session = useSyncExternalStore(auth.subscribe, auth.getSession);
  const accounts = useQuery(() => accountSummaries(db), [db]);

  const sync = useSyncRun();
  const running = sync.progress !== null;
  const [result, setResult] = useState<RunResult | null>(null);
  const box = useRef<HTMLDivElement>(null);
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
      if (!sync.isMounted() || taken.current || sync.isActive()) return;
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
    if (sync.isActive()) return;
    const run = sync.begin(auto ? `Connecting ${PROVIDER_LABEL[auto]}` : "Connecting");
    if (!run) {
      setResult({ ok: true, lines: [ALREADY_RUNNING] });
      return;
    }
    if (auto) focusResult.current = false;
    let switchedOff: ProviderName | null = null;
    const providers = auto ? [] : [...new Set(needed.map((a) => a.provider))];
    setResult(null);
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
        if (run.signal.aborted) break;
        run.show(`Connecting ${PROVIDER_LABEL[provider]}`);
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
        report = await runSync(
          db,
          { tokenSource: auth.tokenSource, createProvider: deps.createProvider, isConnected: (a) => isConnected(user, a, auth.getSession().mail) },
          { signal: run.signal, onAccount: run.onAccount, onProgress: run.onProgress },
        );
      }
    } catch (e) {
      problems.push(errorText(e));
    } finally {
      run.end();
      if (sync.isMounted()) setResult(switchedOff ? { ok: true, lines: [`${PROVIDER_LABEL[switchedOff]} is switched off in Settings.`] } : describeBannerRun(report, problems));
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
            <p className="line">{sync.progress?.label ?? "Connecting"}</p>
            <SyncBar percent={sync.progress?.percent ?? null} />
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
            {running && <button className="quiet" onClick={sync.stop}>Stop</button>}
            {!running && result && <button className="quiet" onClick={() => setResult(null)}>Dismiss</button>}
          </div>
        )}
      </div>
    </div>
  );
}

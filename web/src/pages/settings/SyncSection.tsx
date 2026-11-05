// "Sync": Sync now with a choice of how far back to scan, the running progress with a Stop button, and how far back
// the very first sync looks. The run itself is tracked by useSyncRun, shared with the banner under the header.
import { useState } from "react";
import { useSyncRun } from "../../components/syncprogress/progress";
import { ALREADY_RUNNING } from "../../components/syncprogress/result";
import { SyncBar } from "../../components/syncprogress/SyncBar";
import type { AuthUser } from "../../auth/user";
import type { JobTrackerDB } from "../../db/schema";
import { DEFAULTS, LOOKBACKS, SCAN_CHOICES, saveSettings, type SyncSettings } from "../../sync/settings";
import { describeSync, isConnected, runSync } from "./actions";
import type { SettingsAuth, SettingsDeps } from "./deps";
import type { Reporter } from "./notice";

interface Props {
  db: JobTrackerDB;
  account: AuthUser;
  /** how many accounts are switched on: with none there is nothing to sync */
  activeAccounts: number;
  /** undefined while loading */
  settings: SyncSettings | undefined;
  auth: SettingsAuth;
  deps: Pick<SettingsDeps, "createProvider">;
  report: Reporter;
}

export function SyncSection({ db, account, activeAccounts, settings, auth, deps, report }: Props) {
  const sync = useSyncRun();
  const [scanDays, setScanDays] = useState(0);
  const { progress } = sync;

  async function syncNow() {
    const run = sync.begin("Starting");
    if (!run) {
      report.say("ok", ALREADY_RUNNING);
      return;
    }
    report.clear();
    try {
      const result = describeSync(
        await runSync(
          db,
          { tokenSource: auth.tokenSource, createProvider: deps.createProvider, isConnected: (a) => isConnected(account, a, auth.getSession().mail) },
          { days: scanDays, signal: run.signal, onAccount: run.onAccount, onProgress: run.onProgress },
        ),
      );
      report.say(result.ok ? "ok" : "err", ...result.lines);
    } catch (e) {
      console.error(e);
      report.say("err", "Sync stopped because something went wrong. Try again.");
    } finally {
      run.end();
    }
  }

  async function saveLookback(lookbackDays: number) {
    try {
      await saveSettings(db, "sync", { lookbackDays });
      report.announce("Sync settings saved");
    } catch (e) {
      console.error(e);
      report.say("err", "Couldn't save your sync settings. Try again.");
    }
  }

  return (
    <section className="card" id="sync" aria-labelledby="h-sync">
      <h2 className="sec" id="h-sync" tabIndex={-1}>Sync</h2>
      {progress ? (
        <div className="progress-card">
          <div className="top">
            <span role="status">{progress.label}</span>
            <span aria-hidden="true">{progress.percent !== null ? `${progress.percent}%` : ""}</span>
          </div>
          <SyncBar percent={progress.percent} />
          {progress.note && <div className="small" style={{ marginTop: 4 }}>{progress.note}</div>}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="quiet" onClick={sync.stop}>Stop</button>
          </div>
        </div>
      ) : activeAccounts > 0 ? (
        <div className="row field-block">
          <label className="sr" htmlFor="scan">What to scan</label>
          <select id="scan" value={scanDays} onChange={(e) => setScanDays(Number(e.target.value))}>
            {SCAN_CHOICES.map((c) => <option key={c.days} value={c.days}>{c.label}</option>)}
          </select>
          <button className="primary" onClick={() => void syncNow()}>Sync now</button>
        </div>
      ) : (
        <p className="muted field-block">Connect an email account above to sync.</p>
      )}

      <div className="field-block">
        <label className="field" htmlFor="lookback">Look back on first sync</label>
        <select id="lookback" value={settings?.lookbackDays ?? DEFAULTS.sync.lookbackDays} disabled={!settings}
          onChange={(e) => void saveLookback(Number(e.target.value))}>
          {LOOKBACKS.map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </div>
    </section>
  );
}

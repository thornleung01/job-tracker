// "Sync": Sync now with a choice of how far back to scan, the running progress with a Stop button, and how far back
// the very first sync looks. The run itself is tracked by useSyncRun, shared with the banner under the header.
import { useState } from "react";
import { SyncBar } from "../../components/syncprogress/SyncBar";
import type { AuthUser } from "../../auth/user";
import type { JobTrackerDB } from "../../db/schema";
import { DEFAULTS, LOOKBACKS, SCAN_CHOICES, saveSettings, type SyncSettings } from "../../sync/settings";
import type { SettingsAuth, SettingsDeps } from "./deps";
import type { Reporter } from "./notice";
import { useSyncNow } from "./useMailActions";

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
  const { sync, syncNow } = useSyncNow(db, account, auth, deps, report);
  const [scanDays, setScanDays] = useState(0);
  const { progress } = sync;

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
      <div className="field-block">
        <label className="field" htmlFor="lookback">Look back on first sync</label>
        <select id="lookback" value={settings?.lookbackDays ?? DEFAULTS.sync.lookbackDays} disabled={!settings}
          onChange={(e) => void saveLookback(Number(e.target.value))}>
          {LOOKBACKS.map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </div>
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
          <button className="primary" onClick={() => void syncNow(scanDays)}>Sync now</button>
        </div>
      ) : (
        <p className="muted field-block">Connect an email account above to sync.</p>
      )}

    </section>
  );
}

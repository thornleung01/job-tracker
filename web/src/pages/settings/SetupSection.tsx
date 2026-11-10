// "Set up Job Tracker": the first tab of Settings. Four things in the order they depend on each other (mailbox, resume, AI key,
// backup), each with a tick or an empty circle, one line on what it unlocks and its own buttons right there. The state comes
// from sync/setupStatus.ts, the same read the reminder card on Applications uses.
import { useMemo, useState } from "react";
import type { AuthUser } from "../../auth/user";
import { realSetupDeps, useSetupStatus } from "../../components/setup/useSetupStatus";
import type { JobTrackerDB } from "../../db/schema";
import { skipStep, unskipAll, type StepKey } from "../../sync/setupStatus";
import type { ProviderName } from "../../types";
import type { AccountSummary } from "./AccountsSection";
import { AiRow, BackupRow, MailRow, ResumeRow, focusHeading } from "./SetupRows";
import { availableProviders, type SettingsAuth, type SettingsDeps } from "./deps";
import type { Reporter } from "./notice";
import "../../components/setup/setuprow.css";

interface Props {
  db: JobTrackerDB;
  /** The logged-in person, or null in a local build (the demo). */
  account: AuthUser | null;
  accounts: AccountSummary[] | undefined;
  mail: Record<ProviderName, boolean>;
  auth: SettingsAuth;
  deps: SettingsDeps;
  report: Reporter;
}

const HEADING: Record<"mailbox" | "aiKey", string> = { mailbox: "setup-mailbox", aiKey: "setup-ai" };

export function SetupSection({ db, account, accounts, mail, auth, deps, report }: Props) {
  // The AI key lives outside the database, so the AI row says when it changed.
  const [keyVersion, setKeyVersion] = useState(0);
  const signedIn = account !== null;
  const setupDeps = useMemo(() => realSetupDeps({ ai: deps.ai, backup: deps.backup, mailAvailable: () => signedIn }), [deps.ai, deps.backup, signedIn]);
  const { status } = useSetupStatus(db, setupDeps, keyVersion);

  async function skip(key: "mailbox" | "aiKey") {
    try {
      await skipStep(db, key);
      focusHeading(HEADING[key]);
      report.announce("Skipped. You can bring it back with Show skipped steps again.");
    } catch (e) {
      console.error(e);
      report.say("err", "Couldn't skip this step. Try again.");
    }
  }

  async function showSkipped() {
    try {
      await unskipAll(db);
      report.announce("Skipped steps are back.");
    } catch (e) {
      console.error(e);
      report.say("err", "Couldn't bring the skipped steps back. Try again.");
    }
  }

  const anySkipped = status !== null && (Object.keys(status.steps) as StepKey[]).some((k) => status.steps[k].state === "skipped");

  return (
    <section className="card" id="setup" aria-labelledby="h-setup">
      <div className="setup-title-row">
        <h2 className="sec" id="h-setup" tabIndex={-1}>Set up Job Tracker</h2>
        <p className="help" role="status">{status ? `${status.done} of ${status.total} done` : ""}</p>
      </div>
      {status && (
        <ol className="setup-list">
          <MailRow db={db} account={account} accounts={accounts} mail={mail} providers={availableProviders()} auth={auth} deps={deps} step={status.steps.mailbox} report={report} onSkip={() => void skip("mailbox")} />
          <ResumeRow step={status.steps.resume} />
          <AiRow db={db} deps={deps.ai} step={status.steps.aiKey} report={report} onChange={() => setKeyVersion((n) => n + 1)} onSkip={() => void skip("aiKey")} />
          <BackupRow db={db} deps={deps} step={status.steps.backup} report={report} />
        </ol>
      )}
      <div className="setup-foot">
        <p className="help">Everything else is in Mail, AI, Data and Appearance.</p>
        {anySkipped && <button className="quiet" onClick={() => void showSkipped()}>Show skipped steps again</button>}
      </div>
    </section>
  );
}

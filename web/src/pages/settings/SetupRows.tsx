// The four rows of the Setup tab. Each one reuses what the other tabs already do: Connect and Sync now (useMailActions), the
// key forms (AiSection), and the backup buttons (useBackup), so a button here behaves exactly like its twin there.
import { relativeTime } from "../../components/TimeText";
import { SetupRow } from "../../components/setup/SetupRow";
import { useAction } from "../../components/useAction";
import type { AuthUser } from "../../auth/user";
import type { JobTrackerDB } from "../../db/schema";
import type { StepState } from "../../sync/setupStatus";
import type { ProviderName } from "../../types";
import { PROVIDER_LABEL, isConnected } from "./actions";
import { GetKeyLink } from "./AiSection/GetKeyLink";
import { KeyEnding } from "./AiSection/KeyEnding";
import { KeyForm } from "./AiSection/KeyForm";
import { UnlockForm } from "./AiSection/UnlockForm";
import { useAiCard } from "./AiSection/useAiCard";
import type { AccountSummary } from "./AccountsSection";
import type { SettingsAuth, SettingsDeps } from "./deps";
import type { Reporter } from "./notice";
import { useBackup } from "./useBackup";
import { useConnect, useSyncNow } from "./useMailActions";
import { realBackupDeps } from "../../backup/deps";

const stateWord = (s: StepState["state"], done: string): string => (s === "done" ? done : s === "skipped" ? "Skipped" : "Not yet");

/** The row's heading takes focus when its own button goes away (Skip), so focus isn't lost. */
export const focusHeading = (id: string) => document.getElementById(id)?.focus();

interface MailProps {
  db: JobTrackerDB;
  /** null in a local build (the demo), which has no mailbox connection */
  account: AuthUser | null;
  accounts: AccountSummary[] | undefined;
  mail: Record<ProviderName, boolean>;
  providers: ProviderName[];
  auth: SettingsAuth;
  deps: Pick<SettingsDeps, "createProvider" | "getAddress">;
  step: StepState;
  report: Reporter;
  onSkip(): void;
}

export function MailRow(props: MailProps) {
  const { account, step, onSkip } = props;
  const body = account ? <SignedInMail {...props} account={account} /> : (
    <>
      {step.state === "done" && <p className="setup-detail">{step.detail}</p>}
      <p className="setup-detail">This demo can't connect mail. Your data stays in this browser.</p>
      {step.state === "missing" && <div className="row"><button className="quiet" onClick={onSkip}>Skip, I'll add applications by hand</button></div>}
    </>
  );
  return <SetupRow id="setup-mailbox" title="Mailbox" state={step.state} word={stateWord(step.state, "Connected")} unlocks="Finds your applications in your email.">{body}</SetupRow>;
}

function SignedInMail({ db, account, accounts, mail, providers, auth, deps, step, report, onSkip }: MailProps & { account: AuthUser }) {
  const { connecting, connect } = useConnect(db, account, auth, deps, report.say, report.clear);
  const { sync, syncNow } = useSyncNow(db, account, auth, deps, report);
  const active = (accounts ?? []).filter((a) => a.active);
  if (step.state === "done") {
    const ready = active.some((a) => isConnected(account, a, mail));
    return (
      <>
        <div className="setup-accounts">
          {active.map((a) => {
            const here = isConnected(account, a, mail);
            return (
              <div className="account" key={a.id}>
                <div>{PROVIDER_LABEL[a.provider]} · {a.address}</div>
                <div className="small muted">
                  {!here ? "Not connected in this tab. Reconnect to sync."
                    : a.lastError ? a.lastError
                    : a.lastSync ? `Synced ${relativeTime(new Date(a.lastSync))}` : "Not synced yet"}
                </div>
                {!here && <button className="primary" style={{ marginTop: 8 }} disabled={connecting !== null} aria-label={`Reconnect account ${PROVIDER_LABEL[a.provider]} ${a.address}`} onClick={() => void connect(a.provider)}>Reconnect account</button>}
              </div>
            );
          })}
        </div>
        <div className="row">
          {ready && <button className="primary" disabled={sync.progress !== null} aria-busy={sync.progress !== null} onClick={() => void syncNow(0)}>Sync now</button>}
          {sync.progress && <span className="small muted" role="status">{sync.progress.label}</span>}
        </div>
      </>
    );
  }
  return (
    <div className="row">
      {providers.map((p, i) => (
        <button key={p} className={i === 0 ? "primary" : undefined} aria-busy={connecting === p} disabled={connecting !== null} onClick={() => void connect(p)}>Connect {PROVIDER_LABEL[p]}</button>
      ))}
      {step.state === "missing" && <button className="quiet" onClick={onSkip}>Skip, I'll add applications by hand</button>}
    </div>
  );
}

export function ResumeRow({ step }: { step: StepState }) {
  return (
    <SetupRow id="setup-resume" title="Resume" state={step.state} word={stateWord(step.state, "Added")} unlocks="Starts every tailored resume and letter.">
      {step.state === "done" && <p className="setup-detail">{step.detail}</p>}
      <div className="row">
        <a className={`btn${step.state === "done" ? "" : " primary"}`} href="#/resume">{step.state === "done" ? "Open" : "Add your resume"}</a>
      </div>
    </SetupRow>
  );
}

interface AiProps {
  db: JobTrackerDB;
  deps: SettingsDeps["ai"];
  step: StepState;
  report: Reporter;
  /** the key changed: the status is read again (it lives outside the database) */
  onChange(): void;
  onSkip(): void;
}

export function AiRow({ db, deps, step, report, onChange, onSkip }: AiProps) {
  const { status, part, justLocked, setup, setSetup, forget } = useAiCard(db, deps, report, onChange);
  const word = status.state === "unlocked" ? "Unlocked" : status.state === "locked" ? "Locked" : stateWord(step.state, "Set up");
  return (
    <SetupRow id="setup-ai" title="AI key (optional)" state={step.state} word={word}
      unlocks="Writes tailored resumes and letters, and reads the company and role from a pasted job.">
      {status.state === "none" && !setup && (
        <div className="row">
          <button onClick={() => setSetup(true)}>Set up key</button>
          <GetKeyLink />
          {step.state === "missing" && <button className="quiet" onClick={() => { onSkip(); }}>Not now</button>}
        </div>
      )}
      {status.state === "none" && setup && (
        <div className="setup-form">
          <p className="help"><GetKeyLink /></p>
          <KeyForm {...part} focusOnMount />
        </div>
      )}
      {status.state === "locked" && (
        <div className="setup-form">
          <p className="help">Locked until you unlock it.</p>
          <UnlockForm {...part} last4={status.last4} model={status.model} onForget={forget} focusOnMount={justLocked} />
        </div>
      )}
      {status.state === "unlocked" && (
        <>
          <KeyEnding last4={status.last4} />
          <p className="help">Unlocked until you reload or log out.</p>
        </>
      )}
    </SetupRow>
  );
}

interface BackupProps {
  db: JobTrackerDB;
  deps: Pick<SettingsDeps, "download" | "backup">;
  step: StepState;
  report: Reporter;
}

const realBackup = realBackupDeps();

export function BackupRow({ db, deps, step, report }: BackupProps) {
  const act = useAction();
  const { fileBackup, fileName, backUpButton, chooseButton, exportData, backUpNow, chooseTarget, smallerConfirm } = useBackup(db, deps.backup ?? realBackup, deps, report, act);
  return (
    <SetupRow id="setup-backup" title="Backup" state={step.state} word={stateWord(step.state, "Backed up")} unlocks="Keeps a copy if this browser's data is cleared.">
      {step.state === "done" && <p className="setup-detail">{step.detail}</p>}
      <div className="row">
        {fileBackup && fileName && <button ref={backUpButton} {...act.button("backup")} onClick={() => void backUpNow()}>Back up now</button>}
        {fileBackup && !fileName && <button ref={chooseButton} {...act.button("choose")} onClick={() => void chooseTarget()}>Choose a backup file</button>}
        <button onClick={() => void exportData()}>Export data</button>
      </div>
      {smallerConfirm}
    </SetupRow>
  );
}

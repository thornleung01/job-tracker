// The step between reading a resume and checking it: shows exactly what would be sent to Anthropic and offers the AI conversion (with the person's
// own key) or the simple rule-based one. Nothing is sent until Convert with AI is pressed, and nothing is saved here: a result goes to onConverted,
// the review on the Resume page. A locked key is opened here with its passphrase (useUnlock), and the conversion itself is useConvertRun.
import { useId, useState } from "react";
import { AI_MESSAGES, type AiDeps, type VaultStatus } from "../../ai";
import { Notice } from "../../components/Notice";
import { MAX_AI_INPUT_CHARS } from "../../db/limits";
import type { JobTrackerDB } from "../../db/schema";
import type { ConvertResult, convertResume } from "../../sync/convert";
import { plural } from "../../sync/text";
import { useUnlock } from "../../components/documents/useUnlock";
import { useConvertRun } from "./convertHooks";
import type { Incoming } from "./Importer";
import "./convert.css";

export type ConvertFn = typeof convertResume;

interface Props {
  db: JobTrackerDB;
  incoming: Incoming;
  ai: AiDeps;
  convert: ConvertFn;
  /** the AI result, to be checked before it is saved */
  onConverted(result: ConvertResult): void;
  /** the rule-based sections, straight to the review */
  onSimple(): void;
  onCancel(): void;
}

export function ConvertPanel({ db, incoming, ai, convert, onConverted, onSimple, onCancel }: Props) {
  const [status, setStatus] = useState<VaultStatus>(() => ai.vault.status(db.name));
  const refreshStatus = () => setStatus(ai.vault.status(db.name));
  const boxId = useId();
  const tooLong = incoming.text.length > MAX_AI_INPUT_CHARS;
  const unlock = useUnlock(ai.vault, db.name, refreshStatus);
  const run = useConvertRun(convert, ai, db.name, incoming.text, tooLong, onConverted, refreshStatus);

  const isUnlocked = status.state === "unlocked";
  const hasNoKey = status.state === "none";
  return (
    <div className="card doc-card convert-panel">
      <h2 className="section">Convert to your template</h2>
      <label className="muted small convert-lead" htmlFor={boxId}>This is the text that will be sent to Anthropic with your key:</label>
      <textarea id={boxId} className="convert-text" readOnly rows={10} value={incoming.text} />
      <p className="muted small convert-count">{plural(incoming.text.length, "character")}</p>
      {tooLong ? <Notice tone="err">{AI_MESSAGES.tooLong}</Notice> : null}
      {hasNoKey ? <p className="convert-key">Add your Anthropic key in <a href="#/settings/ai">Settings</a> to convert with AI.</p> : null}
      {status.state === "locked" ? (
        <form className="row convert-unlock" onSubmit={(e) => void unlock.submit(e)}>
          <div className="fgroup">
            <label htmlFor={`${boxId}-pass`}>Passphrase</label>
            <input id={`${boxId}-pass`} ref={unlock.field} type="password" autoComplete="off" value={unlock.passphrase} onChange={(e) => unlock.setPassphrase(e.target.value)} disabled={unlock.unlocking} />
          </div>
          <button type="submit" disabled={unlock.unlocking || !unlock.passphrase} aria-busy={unlock.unlocking || undefined}>Unlock</button>
        </form>
      ) : null}
      {unlock.error ? <Notice tone="err">{unlock.error}</Notice> : null}
      {run.error ? <Notice tone="err">{run.error}</Notice> : null}
      <div className="row doc-save">
        {isUnlocked ? (
          <button type="button" className="primary" ref={run.convertButton} onClick={run.start} disabled={run.converting || tooLong} aria-busy={run.converting || undefined}>Convert with AI</button>
        ) : null}
        <button type="button" className={hasNoKey ? "primary" : undefined} onClick={onSimple} disabled={run.converting}>Use the simple converter</button>
        <button type="button" onClick={onCancel} disabled={run.converting}>Cancel</button>
        {run.converting ? <button type="button" ref={run.stopButton} onClick={run.stop}>Stop</button> : null}
        <span className="muted small doc-status" role="status">{run.converting ? "Converting" : ""}</span>
      </div>
    </div>
  );
}

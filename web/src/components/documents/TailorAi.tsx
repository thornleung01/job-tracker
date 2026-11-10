// The AI strip of the Tailor workspace: Tone, Note and Write (Stop while it runs), with the key unlocked in place. It owns the run (so Stop works),
// the caller owns what a draft does. With no key it says so in one line and links to Settings: tailoring by hand never needs any of this.
import { useEffect, useId, useRef, useState } from "react";
import { TAILOR_TONES, type AiDeps, type TailorTone, type VaultStatus } from "../../ai";
import { MAX_TAILOR_NOTE_CHARS } from "../../db/limits";
import { Notice } from "../Notice";
import { messageFor } from "../useAction";
import { useUnlock } from "./useUnlock";
import "./tailorai.css";

const TONE_LABELS: Record<TailorTone, string> = { plain: "Plain", warm: "Warm", formal: "Formal" };

export interface WriteOptions {
  tone: TailorTone;
  note: string | undefined;
  signal: AbortSignal;
}

interface Props {
  /** the database name, the key vault's address */
  dbName: string;
  ai: AiDeps;
  /** one write: resolves when the caller has used the draft, rejects with the failure */
  run(opts: WriteOptions): Promise<void>;
  /** the copy has edits of the person's own, so a write asks before it replaces them */
  edited: boolean;
  /** the strip is put away: after a draft, or Close */
  onClose(): void;
  /** another action is in flight (a save), so Write waits */
  disabled?: boolean;
}

/** The strip. It is mounted only while it is open. */
export function TailorAi({ dbName, ai, run, edited, onClose, disabled = false }: Props) {
  const base = useId();
  const [status, setStatus] = useState<VaultStatus>(() => ai.vault.status(dbName));
  const [tone, setTone] = useState<TailorTone>("plain");
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const running = useRef<AbortController | null>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const writeButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  // The passphrase field goes away when the key opens, which would drop focus to the page: Write takes it (once it is on the page).
  const [justUnlocked, setJustUnlocked] = useState(false);
  const unlock = useUnlock(ai.vault, dbName, () => {
    setStatus(ai.vault.status(dbName));
    setJustUnlocked(true);
  });
  useEffect(() => () => running.current?.abort(), []);
  useEffect(() => {
    if (!justUnlocked || status.state !== "unlocked") return;
    writeButton.current?.focus();
    setJustUnlocked(false);
  }, [justUnlocked, status.state]);

  const start = () => {
    // The ref, not the state: two clicks in the same moment both see `working` as false.
    if (running.current) return;
    const ask = new AbortController();
    running.current = ask;
    setAsking(false);
    setError(null);
    setWorking(true);
    run({ tone, note: note.trim() || undefined, signal: ask.signal }).then(
      () => {
        if (ask.signal.aborted) return;
        running.current = null;
        setWorking(false);
        onClose();
      },
      (e) => {
        if (ask.signal.aborted) return;   // Stop is not a failure
        running.current = null;
        setWorking(false);
        setError(messageFor(e));
        setStatus(ai.vault.status(dbName));   // the key may have been locked from elsewhere since the strip opened
      },
    );
  };
  const write = () => {
    if (edited && !asking) setAsking(true);
    else start();
  };
  const stop = () => {
    running.current?.abort();
    running.current = null;
    setWorking(false);
  };

  // Write is disabled while it runs, which drops focus: Stop takes it, and when the run ends or is stopped it goes back to Write.
  const wasWorking = useRef(false);
  useEffect(() => {
    if (working && !wasWorking.current) stopButton.current?.focus();
    else if (!working && wasWorking.current) writeButton.current?.focus();
    wasWorking.current = working;
  }, [working]);
  // Write is disabled while the question shows, so "Keep my edits" hands focus back from here, once Write is enabled again in the DOM.
  const wasAsking = useRef(false);
  useEffect(() => {
    if (asking) confirmButton.current?.focus();
    else if (wasAsking.current && !working) writeButton.current?.focus();
    wasAsking.current = asking;
  }, [asking, working]);

  const ready = status.state === "unlocked";
  return (
    <section className="tailor-ai" aria-label="Write with AI">
      {status.state === "none" ? (
        <p className="tailor-ai-line">Add your Anthropic key in <a href="#/settings/ai">Settings</a> to write with AI.</p>
      ) : null}
      {status.state === "locked" ? (
        <form className="row tailor-ai-unlock" onSubmit={(e) => void unlock.submit(e)}>
          <div className="fgroup">
            <label htmlFor={`${base}-pass`}>Passphrase</label>
            <input id={`${base}-pass`} ref={unlock.field} type="password" autoComplete="off" value={unlock.passphrase} onChange={(e) => unlock.setPassphrase(e.target.value)} disabled={unlock.unlocking} />
          </div>
          <button type="submit" disabled={unlock.unlocking || !unlock.passphrase} aria-busy={unlock.unlocking || undefined}>Unlock</button>
        </form>
      ) : null}
      {unlock.error ? <Notice tone="err">{unlock.error}</Notice> : null}
      {ready ? (
        <div className="row tailor-ai-options">
          <div className="fgroup">
            <label htmlFor={`${base}-tone`}>Tone</label>
            <select id={`${base}-tone`} value={tone} onChange={(e) => setTone(e.target.value as TailorTone)} disabled={working}>
              {TAILOR_TONES.map((t) => <option key={t} value={t}>{TONE_LABELS[t]}</option>)}
            </select>
          </div>
          <div className="fgroup tailor-ai-note">
            <label htmlFor={`${base}-note`}>Note for the writer (optional)</label>
            <input id={`${base}-note`} type="text" value={note} maxLength={MAX_TAILOR_NOTE_CHARS} onChange={(e) => setNote(e.target.value)} disabled={working} />
          </div>
        </div>
      ) : null}
      {error ? <Notice tone="err">{error}</Notice> : null}
      {asking && ready ? (
        <div role="group" aria-label="Replace your edits" className="inline-confirm">
          <p className="inline-confirm-q">Replace your edits with a new draft?</p>
          <div className="row">
            <button type="button" ref={confirmButton} onClick={start} disabled={disabled}>Replace my edits</button>
            <button type="button" onClick={() => setAsking(false)}>Keep my edits</button>
          </div>
        </div>
      ) : null}
      <div className="row tailor-ai-actions">
        {ready ? (
          <button type="button" className="primary" ref={writeButton} onClick={write} disabled={working || disabled || asking} aria-busy={working || undefined}>Write</button>
        ) : null}
        {working ? <button type="button" ref={stopButton} onClick={stop}>Stop</button> : null}
        <button type="button" onClick={onClose} disabled={working}>Close</button>
        <span className="muted small" role="status">{working ? "Writing" : ""}</span>
      </div>
    </section>
  );
}

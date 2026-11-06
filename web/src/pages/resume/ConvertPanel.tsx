import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { AI_MESSAGES, type AiDeps, type VaultStatus } from "../../ai";
import { Notice } from "../../components/Notice";
import { messageFor } from "../../components/useAction";
import { MAX_AI_INPUT_CHARS } from "../../db/limits";
import type { DocSection, JobTrackerDB } from "../../db/schema";
import type { ConvertFlag, ConvertResult, convertResume } from "../../sync/convert";
import { plural } from "../../sync/text";
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

/** After a file or pasted text is read: shows exactly what would be sent to Anthropic, and offers the AI conversion (with the person's own key) or the simple one. Nothing is sent until Convert with AI is pressed. */
export function ConvertPanel({ db, incoming, ai, convert, onConverted, onSimple, onCancel }: Props) {
  const [status, setStatus] = useState<VaultStatus>(() => ai.vault.status(db.name));
  const [passphrase, setPassphrase] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const convertButton = useRef<HTMLButtonElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const passphraseField = useRef<HTMLInputElement>(null);
  const boxId = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  // Convert is disabled while it works, which drops focus to the page: Stop takes it, and when the run ends it goes back to Convert.
  // Only when nothing else has focus, so someone who moved on isn't pulled back.
  const wasConverting = useRef(false);
  useEffect(() => {
    const idle = document.activeElement === null || document.activeElement === document.body;
    if (converting && !wasConverting.current && (idle || document.activeElement === convertButton.current)) stopButton.current?.focus();
    else if (!converting && wasConverting.current && idle) convertButton.current?.focus();
    wasConverting.current = converting;
  }, [converting]);

  const tooLong = incoming.text.length > MAX_AI_INPUT_CHARS;

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    if (unlocking || !passphrase) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      await ai.vault.unlock(db.name, passphrase);
      if (mounted.current) setStatus(ai.vault.status(db.name));
    } catch (err) {
      if (mounted.current) setUnlockError(messageFor(err));
    } finally {
      if (mounted.current) {
        setPassphrase("");   // never keep it around after it has been used
        setUnlocking(false);
      }
    }
  };
  // After a wrong one the field is where to try again.
  useEffect(() => {
    if (unlockError) passphraseField.current?.focus();
  }, [unlockError]);

  const start = () => {
    if (converting || tooLong) return;
    const ask = new AbortController();
    controller.current = ask;
    setError(null);
    setConverting(true);
    convert(incoming.text, ai, { db: db.name, signal: ask.signal }).then(
      (result) => {
        if (!mounted.current) return;
        controller.current = null;
        if (ask.signal.aborted) setConverting(false);   // stopped, so what came back is dropped
        else onConverted(result);
      },
      (e) => {
        if (!mounted.current) return;
        controller.current = null;
        setConverting(false);
        // Stop is not a failure: back to the panel with nothing said.
        if (!ask.signal.aborted) setError(messageFor(e));
      },
    );
  };
  const stop = () => controller.current?.abort();

  const ready = status.state === "unlocked";
  const simplePrimary = status.state === "none";
  return (
    <div className="card doc-card convert-panel">
      <h2 className="section">Convert to your template</h2>
      <p className="muted small convert-lead"><label htmlFor={boxId}>This is the text that will be sent to Anthropic with your key:</label></p>
      <textarea id={boxId} className="convert-text" readOnly rows={10} value={incoming.text} />
      <p className="muted small convert-count">{plural(incoming.text.length, "character")}</p>
      {tooLong ? <Notice tone="err">{AI_MESSAGES.tooLong}</Notice> : null}
      {status.state === "none" ? (
        <p className="convert-key">Add your Anthropic key in <a href="#/settings">Settings</a> to convert with AI.</p>
      ) : null}
      {status.state === "locked" ? (
        <form className="row convert-unlock" onSubmit={(e) => void unlock(e)}>
          <div className="fgroup">
            <label htmlFor={`${boxId}-pass`}>Passphrase</label>
            <input id={`${boxId}-pass`} ref={passphraseField} type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} disabled={unlocking} />
          </div>
          <button type="submit" disabled={unlocking || !passphrase} aria-busy={unlocking || undefined}>Unlock</button>
        </form>
      ) : null}
      {unlockError ? <Notice tone="err">{unlockError}</Notice> : null}
      {error ? <Notice tone="err">{error}</Notice> : null}
      <div className="row doc-save">
        {ready ? (
          <button type="button" className="primary" ref={convertButton} onClick={start} disabled={converting || tooLong} aria-busy={converting || undefined}>Convert with AI</button>
        ) : null}
        <button type="button" className={simplePrimary ? "primary" : undefined} onClick={onSimple} disabled={converting}>Use the simple converter</button>
        <button type="button" onClick={onCancel} disabled={converting}>Cancel</button>
        {converting ? <button type="button" ref={stopButton} onClick={stop}>Stop</button> : null}
        <span className="muted small doc-status" role="status">{converting ? "Converting..." : ""}</span>
      </div>
    </div>
  );
}

const flagKey = (f: ConvertFlag) => `${f.itemId}:${f.kind}`;

/** "Check these lines": the lines the conversion wasn't sure about, above the editor. Each one can be jumped to in the editor, or dismissed once it has been checked. A line that was deleted in the editor drops out of the list. */
export function FlagList({ flags, sections, root, heading }: { flags: ConvertFlag[]; sections: DocSection[]; root: RefObject<HTMLElement | null>; heading: RefObject<HTMLElement | null> }) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const idBase = useId();
  const list = useRef<HTMLUListElement>(null);
  const next = useRef<number | null>(null);
  const lines = new Map(sections.flatMap((s) => s.items).map((i) => [i.id, i.text]));
  const shown = flags.filter((f) => lines.has(f.itemId) && !dismissed.has(flagKey(f)));

  // The Dismiss that was pressed is gone: focus goes to the next one, or to the card heading when none are left.
  useEffect(() => {
    if (next.current === null) return;
    const buttons = list.current?.querySelectorAll<HTMLElement>("button[data-dismiss]");
    const target = buttons?.length ? buttons[Math.min(next.current, buttons.length - 1)] : heading.current;
    next.current = null;
    target?.focus();
  }, [dismissed, heading]);

  if (!shown.length) return null;
  const go = (id: string) => root.current?.querySelector<HTMLElement>(`[data-field="${id}"]`)?.focus();
  return (
    <div className="convert-flags">
      <h3 className="convert-flags-title">Check these lines</h3>
      <ul ref={list}>
        {shown.map((f, i) => (
          <li key={flagKey(f)}>
            <div className="convert-flag-text">
              <p className="convert-flag-note">{f.note}</p>
              <p className="muted small convert-flag-line" id={`${idBase}-${i}`}>{lines.get(f.itemId)}</p>
            </div>
            <div className="row convert-flag-actions">
              <button type="button" aria-describedby={`${idBase}-${i}`} onClick={() => go(f.itemId)}>Go to line</button>
              <button type="button" data-dismiss aria-describedby={`${idBase}-${i}`} onClick={() => { next.current = i; setDismissed(new Set(dismissed).add(flagKey(f))); }}>Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

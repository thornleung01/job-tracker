// The review panel for tailoring: writes a resume and a cover letter for one application with the person's own key, then shows each new line
// beside the master's. Nothing is saved until Save both. It has its own runner (so Stop works) and its own action runner for the save.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { TAILOR_TONES, type TailorTone, type VaultStatus } from "../../ai";
import { MAX_TAILOR_NOTE_CHARS } from "../../db/limits";
import type { ApplicationRow, DocSection, DocumentRow, JobTrackerDB } from "../../db/schema";
import { letterSections, letterText } from "../../sync/letter";
import type { TailorDraft } from "../../sync/tailor";
import { plural } from "../../sync/text";
import { Notice } from "../Notice";
import { messageFor, useAction } from "../useAction";
import type { DocumentsDeps } from "./deps";
import { pageVerdictText, measureSheetHeight } from "./onepage";
import { ResumeSheet } from "./ResumeSheet";
import { composeResume, diffWords, initialTicks, lineText, sourcesOf, type WordPart } from "./tailorReview";
import { useOnePage } from "./useOnePage";
import "./tailor.css";

/** How much of a line is in its checkbox's accessible name. */
const NAME_CHARS = 60;
const TONE_LABELS: Record<TailorTone, string> = { plain: "Plain", warm: "Warm", formal: "Formal" };

interface Props {
  db: JobTrackerDB;
  app: ApplicationRow;
  /** the master resume the draft is made from, and what an unticked line goes back to */
  master: DocumentRow;
  deps: Pick<DocumentsDeps, "ai" | "tailor" | "save">;
  /** saved: the tailored resume and the letter are stored. The sentence says so. */
  onSaved(message: string): void;
  onCancel(): void;
  /** the page-height probe, a seam for tests (jsdom has no layout) */
  measure?: (sheet: HTMLElement) => number;
}

function Words({ parts }: { parts: WordPart[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>{p.changed ? <mark className="tailor-changed">{p.text}</mark> : p.text}{" "}</span>
      ))}
    </>
  );
}

function LineRow({ master, text, flags, ticked, onTick }: {
  master: string; text: string; flags: string[]; ticked: boolean; onTick(on: boolean): void;
}) {
  const id = useId();
  const diff = diffWords(master, text);
  return (
    <li className="tailor-line">
      <div className="tailor-cols">
        <div>
          <p className="small muted tailor-col-h">Your master</p>
          <p className="tailor-text">{master ? <Words parts={diff.before} /> : <span className="muted">Not in your master</span>}</p>
        </div>
        <div>
          <p className="small muted tailor-col-h">New</p>
          <p className="tailor-text"><Words parts={diff.after} /></p>
        </div>
      </div>
      {flags.map((f, i) => <p key={f} id={`${id}-flag-${i}`} className="small tailor-flag">{f}</p>)}
      <div className="tailor-use">
        <input
          id={id} type="checkbox" checked={ticked} onChange={(e) => onTick(e.target.checked)}
          aria-label={`Use: ${text.length > NAME_CHARS ? `${text.slice(0, NAME_CHARS).trimEnd()}...` : text}`}
          aria-describedby={flags.length ? flags.map((_, i) => `${id}-flag-${i}`).join(" ") : undefined}
        />
        <label htmlFor={id} aria-hidden="true">Use</label>
      </div>
    </li>
  );
}

export function Tailor({ db, app, master, deps, onSaved, onCancel, measure }: Props) {
  const idBase = useId();
  const own = useAction();
  const [status, setStatus] = useState<VaultStatus>(() => deps.ai.vault.status(db.name));
  const [tone, setTone] = useState<TailorTone>("plain");
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TailorDraft | null>(null);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [cover, setCover] = useState("");
  const running = useRef<AbortController | null>(null);
  const reviewHead = useRef<HTMLHeadingElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  /** where focus goes when a run ends or the question closes: the review heading after a draft, the action button otherwise */
  const focusAfter = useRef<"review" | "action" | null>(null);
  const [asking, setAsking] = useState(false);
  const sheet = useRef<HTMLElement>(null);
  useEffect(() => () => running.current?.abort(), []);

  const edited = draft !== null && cover !== letterText(draft.cover);
  const tryAgain = () => {
    if (edited && !asking) setAsking(true);
    else {
      setAsking(false);
      start();
    }
  };
  const start = () => {
    // The ref, not the state: two clicks in the same moment both see `working` as false.
    if (running.current) return;
    const ask = new AbortController();
    running.current = ask;
    setError(null);
    setWorking(true);
    deps.tailor(db, app.id, { ai: deps.ai }, { tone, note: note.trim() || undefined, signal: ask.signal }).then(
      (next) => {
        if (ask.signal.aborted) return;
        running.current = null;
        focusAfter.current = "review";
        setWorking(false);
        setDraft(next);
        setTicks(initialTicks(next.lines));
        setCover(letterText(next.cover));
      },
      (e) => {
        if (ask.signal.aborted) return;   // Stop is not a failure
        running.current = null;
        focusAfter.current = "action";
        setWorking(false);
        setError(messageFor(e));
        setStatus(deps.ai.vault.status(db.name));   // the key may have been locked from elsewhere since the panel opened
      },
    );
  };
  const stop = () => {
    running.current?.abort();
    running.current = null;
    focusAfter.current = "action";
    setWorking(false);
  };

  // Write and Try again are disabled while it runs, so focus moves to Stop, then to where the person continues.
  useEffect(() => {
    if (working) stopButton.current?.focus();
    else if (focusAfter.current) {
      (focusAfter.current === "review" ? reviewHead : actionButton).current?.focus();
      focusAfter.current = null;
    }
  }, [working, draft, asking]);
  useEffect(() => {
    if (asking) confirmButton.current?.focus();
  }, [asking]);

  const composed = useMemo(() => (draft ? composeResume(draft, master.sections, ticks) : []), [draft, master.sections, ticks]);
  const verdict = useOnePage(sheet, [composed], measure ?? measureSheetHeight);

  const lines = useMemo(() => new Map((draft?.lines ?? []).map((l) => [l.id, l])), [draft]);
  const original = useMemo(() => new Map(master.sections.flatMap((s) => s.items).map((i) => [i.id, i])), [master.sections]);

  const save = () => {
    if (!draft) return;
    void own.run("tailor-save", async () => {
      await deps.save(db, app.id, { resume: composed, cover: letterSections(cover, draft.cover) });
      onSaved("Saved the tailored resume and cover letter.");
    });
  };

  const busy = working || own.busy !== null;
  const ready = status.state === "unlocked";
  const sections: DocSection[] = draft ? draft.resume.filter((s) => s.items.some((i) => lines.has(i.id))) : [];
  const flagged = draft ? draft.lines.filter((l) => l.flags.length > 0).length : 0;

  return (
    <section className="card doc-card tailor-panel" aria-label="Tailor for this job">
      <h3 className="doc-h">Tailor for {app.company}{app.role ? `, ${app.role}` : ""}</h3>
      {!ready ? (
        <p className="tailor-key">
          {status.state === "none" ? "Add your Anthropic key in " : "Unlock your Anthropic key in "}
          <a href="#/settings/ai">Settings</a> to tailor with AI.
        </p>
      ) : (
        <div className="row tailor-options">
          <div className="fgroup">
            <label htmlFor={`${idBase}-tone`}>Tone</label>
            <select id={`${idBase}-tone`} value={tone} onChange={(e) => setTone(e.target.value as TailorTone)} disabled={busy}>
              {TAILOR_TONES.map((t) => <option key={t} value={t}>{TONE_LABELS[t]}</option>)}
            </select>
          </div>
          <div className="fgroup tailor-note">
            <label htmlFor={`${idBase}-note`}>Note for the writer (optional)</label>
            <input id={`${idBase}-note`} type="text" value={note} maxLength={MAX_TAILOR_NOTE_CHARS} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
        </div>
      )}
      {error ? <Notice tone="err">{error}</Notice> : null}
      {own.error ? <Notice tone="err">{own.error}</Notice> : null}

      {draft ? (
        <div className="tailor-review">
          <h4 className="tailor-h" tabIndex={-1} ref={reviewHead}>Resume</h4>
          <p className="small muted tailor-count">
            {flagged ? `${plural(flagged, "line")} to check. ${flagged === 1 ? "It starts" : "They start"} unticked, so your own words are used unless you tick ${flagged === 1 ? "it" : "them"}.` : "Untick a line to keep your own words for it."}
          </p>
          {sections.map((s) => (
            <section key={s.id} className="tailor-section" aria-label={s.heading || "Summary"}>
              <h5 className="tailor-sh">{s.heading || "Summary"}</h5>
              <ul className="tailor-lines">
                {s.items.filter((i) => lines.has(i.id)).map((i) => {
                  const line = lines.get(i.id)!;
                  return (
                    <LineRow
                      key={i.id} master={sourcesOf(line).flatMap((id) => original.get(id) ?? []).map(lineText).join("\n")} text={lineText(i)} flags={line.flags}
                      ticked={ticks[line.id] !== false} onTick={(on) => setTicks((t) => ({ ...t, [line.id]: on }))}
                    />
                  );
                })}
              </ul>
            </section>
          ))}
          {draft.unused.length ? (
            <div className="tailor-unused">
              <h5 className="tailor-sh">Lines from your master that were left out</h5>
              <ul>{draft.unused.map((u, i) => <li key={i} className="small">{u}</li>)}</ul>
            </div>
          ) : null}
          <p className="small muted tailor-length" role="status">{verdict ? `${pageVerdictText(verdict)} (estimate)` : ""}</p>

          <h4 className="tailor-h">Cover letter</h4>
          {draft.coverFlags.map((f) => <p key={f} className="small tailor-flag">{f}</p>)}
          <label className="sr" htmlFor={`${idBase}-cover`}>Cover letter</label>
          <textarea id={`${idBase}-cover`} className="doc-letter-text tailor-cover" rows={14} value={cover} onChange={(e) => setCover(e.target.value)} />
          <div className="tailor-measure" aria-hidden="true"><ResumeSheet sections={composed} title={master.title} sheetRef={sheet} /></div>
        </div>
      ) : null}

      <div className="row doc-actions">
        {draft ? (
          <button type="button" className="primary" onClick={save} {...own.button("tailor-save")} disabled={busy}>Save both</button>
        ) : ready ? (
          <button type="button" className="primary" ref={actionButton} onClick={start} disabled={busy} aria-busy={working || undefined}>Write them</button>
        ) : null}
        {draft && ready && asking ? (
          <span role="group" aria-label="Write again" className="row">
            <span className="small">Discard your edits and write again?</span>
            <button type="button" ref={confirmButton} onClick={tryAgain} disabled={busy}>Discard and write again</button>
            <button type="button" onClick={() => { focusAfter.current = "action"; setAsking(false); }}>Keep my edits</button>
          </span>
        ) : draft && ready ? <button type="button" ref={actionButton} onClick={tryAgain} disabled={busy} aria-busy={working || undefined}>Try again</button> : null}
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        {working ? <button type="button" ref={stopButton} onClick={stop}>Stop</button> : null}
        <span className="muted small doc-status" role="status">{working ? "Writing" : ""}</span>
      </div>
    </section>
  );
}

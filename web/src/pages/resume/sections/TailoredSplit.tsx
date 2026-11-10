// Tailored resume | Tailored cover letter, side by side once there is a draft: the copy on the page (scaled into its column) with its change marks
// and one-page check, the letter beside it, a quiet strip for Rewrite with AI and Start over, one disclosure for what changed, and the action bar.
// Under 1100px they stack; on a phone one shows at a time behind a two-tab switch. Nothing here is saved until Save.
import { useEffect, useMemo, useRef, useState } from "react";
import { BaselineMarks } from "../../../components/documents/BaselineMarks";
import { Changes, LeftOut, Ticks } from "../../../components/documents/Review";
import { ResumeEditing } from "../../../components/documents/ResumeEditing";
import { TailorAi, type WriteOptions } from "../../../components/documents/TailorAi";
import { InlineConfirm } from "../../../components/InlineConfirm";
import { useAction } from "../../../components/useAction";
import { usePhone } from "../../../app/usePhone";
import type { DocumentRow, JobTrackerDB } from "../../../db/schema";
import { addBackLine, compareToBaseline, resetLine } from "../../../documents/compare";
import type { FlowAction, FlowState } from "../flowState";
import { ActionBar } from "./ActionBar";
import type { SectionDeps } from "./deps";

interface Props {
  db: JobTrackerDB;
  flow: FlowState & { draft: NonNullable<FlowState["draft"]>; resume: NonNullable<FlowState["resume"]> };
  dispatch(a: FlowAction): void;
  deps: SectionDeps;
  /** the resume the draft was made from */
  baseline: DocumentRow;
  write(opts: WriteOptions): Promise<void>;
  /** Start over was confirmed (or nothing needed asking) */
  onStartOver(): void;
}

export function TailoredSplit({ db, flow, dispatch, deps, baseline, write, onStartOver }: Props) {
  const act = useAction();
  const phone = usePhone();
  const [active, setActive] = useState<string | null>(null);
  const [rewriting, setRewriting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [copied, setCopied] = useState("");
  const rewriteButton = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const focusLine = useRef<string | null>(null);
  const { draft, resume, letter } = flow;
  const diff = useMemo(() => compareToBaseline(resume, baseline.sections), [resume, baseline]);
  const busy = act.busy !== null;
  const changes = Object.values(diff.lines).filter((l) => l.status !== "same").length;
  const flagged = draft.lines.some((l) => l.flags.length > 0);

  // The changes disclosure is open when the AI left lines to check; a new draft decides again.
  const [open, setOpen] = useState(flagged);
  useEffect(() => setOpen(flagged), [draft, flagged]);

  // Add back and Reset to baseline are gone with their line: focus goes to the line they changed.
  useEffect(() => {
    const id = focusLine.current;
    if (!id) return;
    focusLine.current = null;
    [...(editor.current?.querySelectorAll<HTMLElement>("[data-field]") ?? [])].find((el) => el.dataset.field === id)?.focus();
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(letter?.text ?? "");
      setCopied("Copied");
    } catch {
      setCopied("Couldn't copy. Select the text and copy it.");
    }
  };
  const startOver = () => {
    setRestarting(false);
    onStartOver();
  };

  const showResume = !phone || flow.view === "resume";
  const showLetter = !phone || flow.view === "cover";

  return (
    <section className="rs-split" id="rs-split" aria-label="Tailored resume and cover letter">
      <div className="rs-strip">
        <button type="button" className="quiet" ref={rewriteButton} onClick={() => setRewriting((v) => !v)} aria-expanded={rewriting} disabled={busy}>Rewrite with AI</button>
        <button type="button" className="quiet" onClick={() => setRestarting(true)} disabled={busy || restarting}>Start over</button>
      </div>
      {rewriting ? (
        <TailorAi dbName={db.name} ai={deps.ai} run={write} edited={flow.edited} disabled={busy} writeLabel="Rewrite"
                  onClose={() => { setRewriting(false); setTimeout(() => rewriteButton.current?.focus(), 0); }} />
      ) : null}
      {restarting ? (
        <InlineConfirm title="Start over?" help={flow.saved ? "The job and the draft will be cleared. What you saved stays in your applications." : "The job and the draft will be cleared. Nothing has been saved."}
                       confirmLabel="Start over" act={act} actionKey="over" onConfirm={startOver} onCancel={() => setRestarting(false)} />
      ) : null}

      {phone ? (
        <div className="doc-switch" role="group" aria-label="Which document">
          <button type="button" aria-pressed={flow.view === "resume"} onClick={() => dispatch({ type: "view", view: "resume" })}>Resume</button>
          <button type="button" aria-pressed={flow.view === "cover"} onClick={() => dispatch({ type: "view", view: "cover" })}>Cover letter</button>
        </div>
      ) : null}

      <div className="rs-cols">
        {showResume ? (
          <div className="rs-col rs-col-resume">
            <h2 className="rs-h rs-h-doc">Tailored resume</h2>
            <div className="documents rs-sheet" ref={editor}>
              <BaselineMarks compare={diff} on onActive={setActive}>
                <ResumeEditing sections={resume} onChange={(next) => dispatch({ type: "edit", resume: next })} label="Tailored resume" title={baseline.title} fit />
              </BaselineMarks>
            </div>
            <details className="rs-changes" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
              <summary className="disclosure">
                <span className="chev" aria-hidden="true"></span>
                Changes from your baseline ({changes})
              </summary>
              <div className="documents rs-changes-body">
                {draft.lines.length ? <Ticks draft={draft} ticks={flow.ticks} onTick={(id, on) => dispatch({ type: "tick", id, on, baseline: baseline.sections })} /> : null}
                <LeftOut compare={diff} disabled={busy} onAddBack={(id) => { focusLine.current = id; dispatch({ type: "edit", resume: addBackLine(resume, baseline.sections, id) }); }} />
                <Changes compare={diff} sections={resume} activeId={active} disabled={busy}
                         onReset={(id) => { focusLine.current = id; dispatch({ type: "edit", resume: resetLine(resume, baseline.sections, id) }); }} />
              </div>
            </details>
          </div>
        ) : null}
        {showLetter ? (
          <div className="rs-col rs-col-letter">
            <h2 className="rs-h rs-h-doc">Tailored cover letter</h2>
            <div className="documents rs-letter">
              {letter?.flags.map((f) => <p key={f} className="small tailor-flag">{f}</p>)}
              <label className="sr" htmlFor="rs-letter">Cover letter</label>
              <textarea id="rs-letter" className="doc-letter-text" rows={18} value={letter?.text ?? ""} onChange={(e) => dispatch({ type: "letter", text: e.target.value })} />
              <div className="row">
                <button type="button" onClick={() => void copy()}>Copy text</button>
                <span className="small muted" role="status">{copied}</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <ActionBar db={db} flow={flow} baselineId={baseline.id} dispatch={dispatch} deps={deps} />
    </section>
  );
}

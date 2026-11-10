// Step 3, Review: the tailored copy on the page with its marks against the baseline, the AI's lines to tick, what was left out and what changed;
// the letter on its own view. Try again writes a new draft (asking first when it would replace edits). Nothing is saved yet.
import { useEffect, useMemo, useRef, useState } from "react";
import { BaselineMarks } from "../../../components/documents/BaselineMarks";
import { Changes, LeftOut, Ticks } from "../../../components/documents/Review";
import { ResumeEditing } from "../../../components/documents/ResumeEditing";
import { TailorAi, type WriteOptions } from "../../../components/documents/TailorAi";
import { InlineConfirm } from "../../../components/InlineConfirm";
import { Notice } from "../../../components/Notice";
import { useAction } from "../../../components/useAction";
import type { DocumentRow, JobTrackerDB } from "../../../db/schema";
import { addBackLine, compareToBaseline, resetLine } from "../../../documents/compare";
import type { FlowAction, FlowState } from "../flowState";
import type { StepsDeps } from "./deps";

interface Props {
  db: JobTrackerDB;
  flow: FlowState & { draft: NonNullable<FlowState["draft"]>; resume: NonNullable<FlowState["resume"]> };
  dispatch(a: FlowAction): void;
  deps: StepsDeps;
  /** the resume the draft was made from */
  baseline: DocumentRow;
  write(opts: WriteOptions): Promise<void>;
  byHand(): Promise<void>;
  onNext(): void;
  onBack(): void;
}

export function StepReview({ db, flow, dispatch, deps, baseline, write, byHand, onNext, onBack }: Props) {
  const act = useAction();
  const [active, setActive] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState("");
  const againButton = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const focusLine = useRef<string | null>(null);
  const { draft, resume, letter } = flow;
  const diff = useMemo(() => compareToBaseline(resume, baseline.sections), [resume, baseline]);
  const busy = act.busy !== null;

  // Add back and Reset to baseline are gone with their line: focus goes to the line they changed.
  useEffect(() => {
    const id = focusLine.current;
    if (!id) return;
    focusLine.current = null;
    [...(editor.current?.querySelectorAll<HTMLElement>("[data-field]") ?? [])].find((el) => el.dataset.field === id)?.focus();
  });

  const tryAgain = () => {
    if (!flow.byHand) setAgain(true);
    else if (flow.edited) setAsking(true);
    else void act.run("again", byHand);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(letter?.text ?? "");
      setCopied("Copied");
    } catch {
      setCopied("Couldn't copy. Select the text and copy it.");
    }
  };

  return (
    <>
      <div className="doc-switch" role="group" aria-label="Which document">
        <button type="button" aria-pressed={flow.view === "resume"} onClick={() => dispatch({ type: "view", view: "resume" })}>Resume</button>
        <button type="button" aria-pressed={flow.view === "cover"} onClick={() => dispatch({ type: "view", view: "cover" })}>Cover letter</button>
      </div>

      {again ? (
        <TailorAi dbName={db.name} ai={deps.ai} run={write} edited={flow.edited} disabled={busy}
                  onClose={() => { setAgain(false); setTimeout(() => againButton.current?.focus(), 0); }} />
      ) : null}
      {asking ? (
        <InlineConfirm title="Replace your edits?" help="Your draft will be replaced by a new copy of your resume." confirmLabel="Replace my edits" act={act} actionKey="again"
                       onConfirm={() => { setAsking(false); void act.run("again", byHand); }} onCancel={() => setAsking(false)} />
      ) : null}
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}

      {flow.view === "resume" ? (
        <div className="steps-review">
          <div className="documents steps-review-doc" ref={editor}>
            <BaselineMarks compare={diff} on onActive={setActive}>
              <ResumeEditing sections={resume} onChange={(next) => dispatch({ type: "edit", resume: next })} label="Tailored resume" title={baseline.title} />
            </BaselineMarks>
          </div>
          <div className="steps-review-side">
            {draft.lines.length ? <Ticks draft={draft} ticks={flow.ticks} onTick={(id, on) => dispatch({ type: "tick", id, on, baseline: baseline.sections })} /> : null}
            <LeftOut compare={diff} disabled={busy} onAddBack={(id) => { focusLine.current = id; dispatch({ type: "edit", resume: addBackLine(resume, baseline.sections, id) }); }} />
            <Changes compare={diff} sections={resume} activeId={active} disabled={busy}
                     onReset={(id) => { focusLine.current = id; dispatch({ type: "edit", resume: resetLine(resume, baseline.sections, id) }); }} />
          </div>
        </div>
      ) : (
        <section className="documents steps-letter" aria-label="Cover letter">
          {letter?.flags.map((f) => <p key={f} className="small tailor-flag">{f}</p>)}
          <label className="sr" htmlFor="steps-letter">Cover letter</label>
          <textarea id="steps-letter" className="doc-letter-text" rows={14} value={letter?.text ?? ""} onChange={(e) => dispatch({ type: "letter", text: e.target.value })} />
          <div className="row">
            <button type="button" onClick={() => void copy()}>Copy text</button>
            <span className="small muted" role="status">{copied}</span>
          </div>
        </section>
      )}

      <div className="row steps-actions">
        <button type="button" className="primary" onClick={onNext} disabled={busy}>Next</button>
        <button type="button" ref={againButton} onClick={tryAgain} disabled={busy || again || asking} aria-busy={act.busy === "again" || undefined}>Try again</button>
        <button type="button" onClick={onBack} disabled={busy}>Back</button>
      </div>
    </>
  );
}

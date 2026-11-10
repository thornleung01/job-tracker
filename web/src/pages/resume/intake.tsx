// Bringing a master resume in: a file or pasted text goes to the convert panel, then to the review, and only "Save as master resume" stores it;
// or a blank copy of the template to type into. The Resume section of the page uses all of it before there is a master, and the master card
// under Your documents uses the same review for "Replace with a file" and the re-read offer.
import { useRef, useState } from "react";
import type { AiDeps } from "../../ai";
import { ResumeEditing } from "../../components/documents/ResumeEditing";
import { InlineConfirm } from "../../components/InlineConfirm";
import { Notice } from "../../components/Notice";
import { useAction } from "../../components/useAction";
import type { DocSection, DocumentRow, JobTrackerDB } from "../../db/schema";
import { blankResume, cleanForSave, isBlankTemplate } from "../../documents/blankResume";
import type { ConvertResult } from "../../sync/convert";
import { saveMaster } from "../../sync/documents";
import { ConvertPanel, type ConvertFn } from "./ConvertPanel";
import { FlagList } from "./FlagList";
import { Importer, type Incoming } from "./Importer";
import { useReportUnsaved, type ReportUnsaved } from "./unsaved";

/** What the review shows: the sections to check, where they came from, and for an AI conversion what it wasn't sure about. */
export interface ReviewDraft {
  sections: DocSection[];
  source: NonNullable<DocumentRow["source"]>;
  ai?: ConvertResult;
}

/** A new master resume to check: the split text is editable, and Save as master resume is the only thing that stores it. */
function MasterReview({ db, draft, existing, heading, onDone, onSaved, onAgain, onSimple, report }: {
  db: JobTrackerDB; draft: ReviewDraft; existing: boolean; heading?: string; onDone(): void; onSaved?(): void; onAgain(): void; onSimple(): void; report: ReportUnsaved;
}) {
  const [sections, setSections] = useState(draft.sections);
  const act = useAction();
  // Cancel, Convert again and the simple converter all throw away what was edited here, so they ask first when something was.
  const edited = JSON.stringify(sections) !== JSON.stringify(draft.sections);
  useReportUnsaved(report, "review", edited);
  const [dropping, setDropping] = useState<(() => void) | null>(null);
  const dropOrAsk = (go: () => void) => (edited ? setDropping(() => go) : go());
  const card = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const save = () =>
    void act.run("save", async () => {
      await saveMaster(db, cleanForSave(sections), draft.source);
      onDone();
      onSaved?.();
    });
  return (
    <div className="card doc-card convert-review" ref={card}>
      <h2 className="section" ref={title} tabIndex={-1}>{heading ?? (existing ? "Replace your master resume" : "Check your resume")}</h2>
      {draft.ai ? (
        <>
          <p className="muted small convert-summary">Converted with AI. Check each line before you save.</p>
          <FlagList flags={draft.ai.flags} converted={draft.sections} sections={sections} root={card} heading={title} />
        </>
      ) : null}
      <ResumeEditing sections={sections} onChange={setSections} label="Resume text to check" title="Master resume" />
      {draft.ai?.unused.length ? (
        <details className="convert-unused">
          <summary className="disclosure"><span className="chev" aria-hidden="true"></span>Not used from your file</summary>
          <p className="muted small">{draft.ai.unused.join(", ")}</p>
        </details>
      ) : null}
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      <div className="row doc-save">
        <button type="button" className="primary" onClick={save} {...act.button("save")}>Save as master resume</button>
        {draft.ai ? <button type="button" onClick={() => dropOrAsk(onAgain)} disabled={act.busy !== null || dropping !== null}>Convert again</button> : null}
        {draft.ai ? <button type="button" onClick={() => dropOrAsk(onSimple)} disabled={act.busy !== null || dropping !== null}>Use the simple converter</button> : null}
        <button type="button" onClick={() => dropOrAsk(onDone)} disabled={act.busy !== null || dropping !== null}>Cancel</button>
      </div>
      {dropping ? (
        <InlineConfirm title="Discard your edits?" help="You changed this text. Nothing has been saved." confirmLabel="Discard edits" act={act} actionKey="discard"
                       onConfirm={dropping} onCancel={() => setDropping(null)} />
      ) : null}
    </div>
  );
}

/** A blank copy of the template to type into. Nothing is stored until Save, and Save stays off until there is some text. */
function TemplateStart({ db, onDone, onSaved, report }: { db: JobTrackerDB; onDone(): void; onSaved(): void; report: ReportUnsaved }) {
  const [sections, setSections] = useState(blankResume);
  const [confirming, setConfirming] = useState(false);
  const act = useAction();
  useReportUnsaved(report, "template", !isBlankTemplate(sections));
  const save = () =>
    void act.run("save", async () => {
      await saveMaster(db, cleanForSave(sections), "template");
      onDone();
      onSaved();
    });
  return (
    <div className="card doc-card">
      <h2 className="section">Master resume</h2>
      <ResumeEditing sections={sections} onChange={setSections} label="Master resume" title="Master resume" scaffold />
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      <div className="row doc-save">
        <button type="button" className="primary" onClick={save} disabled={act.busy !== null || isBlankTemplate(sections)} aria-busy={act.busy === "save" || undefined}>Save</button>
        <button type="button" onClick={() => (isBlankTemplate(sections) ? onDone() : setConfirming(true))} disabled={act.busy !== null || confirming}>Cancel</button>
      </div>
      {confirming ? (
        <InlineConfirm title="Discard what you typed?" help="Nothing has been saved." confirmLabel="Discard" act={act} actionKey="discard" onConfirm={onDone} onCancel={() => setConfirming(false)} />
      ) : null}
    </div>
  );
}

/** A file or pasted text on its way in. `draft` exists only once there is something to review, and `incoming` is kept so Convert again and the simple converter can start from the same text. */
interface Pending {
  incoming: Incoming;
  draft: ReviewDraft | null;
  /** an old resume read again: the review is titled "Check your resume" even though a master exists */
  reread?: boolean;
}

/** The way in: what is pending (null when nothing is) and how to start, swap and end it. `reviewKey` gives the review a fresh start each time its sections are swapped. */
export function useIntake(master: DocumentRow | undefined) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [reviewKey, setReviewKey] = useState(0);
  const review = (next: ReviewDraft) => {
    setPending((p) => p && { ...p, draft: next });
    setReviewKey((n) => n + 1);
  };
  return {
    pending,
    reviewKey,
    review,
    start: (incoming: Incoming) => setPending({ incoming, draft: null }),
    /** an old resume read again goes straight to the review, so nothing is stored until Save */
    reread: (sections: DocSection[]) => {
      // saving keeps how the master first came in, so re-reading does not turn an upload or a template into a paste
      const source = master?.source ?? "paste";
      setPending({ incoming: { sections, text: "", source: source === "upload" ? "upload" : "paste" }, draft: { sections, source }, reread: true });
      setReviewKey((n) => n + 1);
    },
    again: () => setPending((p) => p && { ...p, draft: null }),
    done: () => setPending(null),
  };
}

export type IntakeState = ReturnType<typeof useIntake>;

/** The convert panel, then the review, for whatever is pending. */
export function Intake({ db, intake, existing, ai, convert, report, onSaved }: {
  db: JobTrackerDB; intake: IntakeState; existing: boolean; ai: AiDeps; convert: ConvertFn; report: ReportUnsaved; onSaved?(): void;
}) {
  const { pending } = intake;
  if (!pending) return null;
  const useSimple = () => intake.review({ sections: pending.incoming.sections, source: pending.incoming.source });
  if (!pending.draft) {
    return (
      <ConvertPanel db={db} incoming={pending.incoming} ai={ai} convert={convert} onCancel={intake.done} onSimple={useSimple}
                    onConverted={(result) => intake.review({ sections: result.sections, source: "ai", ai: result })} />
    );
  }
  return (
    <MasterReview key={`review-${intake.reviewKey}`} db={db} draft={pending.draft} existing={existing} heading={pending.reread ? "Check your resume" : undefined}
                  onDone={intake.done} onSaved={onSaved} onAgain={intake.again} onSimple={useSimple} report={report} />
  );
}

/** Before there is a master: Start from the template, Upload a file or Paste text, then the check. `onSaved` runs once the master is stored. */
export function MasterStart({ db, ai, convert, report, onSaved }: { db: JobTrackerDB; ai: AiDeps; convert: ConvertFn; report: ReportUnsaved; onSaved(): void }) {
  const intake = useIntake(undefined);
  const [templating, setTemplating] = useState(false);
  if (intake.pending) return <Intake db={db} intake={intake} existing={false} ai={ai} convert={convert} report={report} onSaved={onSaved} />;
  if (templating) return <TemplateStart db={db} onDone={() => setTemplating(false)} onSaved={onSaved} report={report} />;
  return (
    <div className="card doc-card doc-empty">
      <div className="doc-choices">
        <button type="button" className="primary" onClick={() => setTemplating(true)}>Start from the template</button>
        <Importer fileLabel="Upload a file" onRead={intake.start} primary={false} />
      </div>
    </div>
  );
}

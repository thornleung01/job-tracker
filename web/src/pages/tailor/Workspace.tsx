// The Tailor workspace for one application: the baseline on the left, the tailored copy on the right, the letter on its own view. The copy is made
// by hand (Start from baseline, then edit on the page) or with AI as an optional helper, and both mix in the same editor. Nothing is saved until Save.
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { usePhone } from "../../app/usePhone";
import { useQuery } from "../../app/useQuery";
import { BaselineMarks } from "../../components/documents/BaselineMarks";
import { CoverLetter } from "../../components/documents/CoverLetter";
import { realDocumentsDeps, type DocumentsDeps } from "../../components/documents/deps";
import { PostingCard } from "../../components/documents/PostingCard";
import { PostingTerms } from "../../components/documents/PostingTerms";
import { ResumeEditing } from "../../components/documents/ResumeEditing";
import { ResumeSheet } from "../../components/documents/ResumeSheet";
import { TailorAi, type WriteOptions } from "../../components/documents/TailorAi";
import { composeResume, initialTicks } from "../../components/documents/tailorReview";
import { applyTick } from "../../components/documents/tailorTicks";
import { InlineConfirm } from "../../components/InlineConfirm";
import { Notice } from "../../components/Notice";
import { useAction } from "../../components/useAction";
import { normalizeSections } from "../../db/documentShape";
import type { DocSection, DocumentRow, JobTrackerDB } from "../../db/schema";
import { addBackLine, compareToBaseline, resetLine } from "../../documents/compare";
import { registerLeaveGuard } from "../../app/leaveGuard";
import { derive } from "../../sync/contacts";
import {
  baselineChoices, getCoverLetter, getTailored, liveResumes, saveCoverLetter, saveTailored, startTailoredFromBaseline,
} from "../../sync/documents";
import { letterSections, letterText } from "../../sync/letter";
import type { TailorDraft } from "../../sync/tailor";
import { Changes, LeftOut, Ticks } from "../../components/documents/Review";
import "../../components/documents/documents.css";

interface Props {
  db: JobTrackerDB;
  appId: number;
  /** a version chosen on the Resume page: the baseline that starts selected */
  baseline: number | null;
  navigate(to: string): void;
  deps?: Partial<DocumentsDeps>;
}

interface CoverDraft {
  text: string;
  /** the draft's own sections, so the saved letter keeps their ids */
  base: DocSection[];
  flags: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function Workspace({ db, appId, baseline: baselineParam, navigate, deps }: Props) {
  const all: DocumentsDeps = { ...realDocumentsDeps, ...deps };
  const data = useQuery(async () => {
    const app = Number.isSafeInteger(appId) ? await db.applications.get(appId) : undefined;
    if (!app || app.deletedAt) return null;
    return {
      app,
      resumes: baselineChoices(await liveResumes(db)),
      tailored: (await getTailored(db, appId)) ?? null,
      cover: (await getCoverLetter(db, appId)) ?? null,
      people: await derive(db, appId),
    };
  }, [db, appId]);

  const act = useAction();
  const phone = usePhone();
  const [view, setView] = useState<"resume" | "cover">("resume");
  const [chosen, setChosen] = useState<number | null>(null);
  /** the copy as it is being edited; null while there are no edits (the saved copy is shown) */
  const [edits, setEdits] = useState<DocSection[] | null>(null);
  const [compare, setCompare] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const [draft, setDraft] = useState<TailorDraft | null>(null);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [coverDraft, setCoverDraft] = useState<CoverDraft | null>(null);
  const [active, setActive] = useState<string | null>(null);
  /** where the person was headed when the unsaved-changes question stopped them (a route such as "/people"), null when not asking */
  const [leaving, setLeaving] = useState<string | null>(null);
  const [told, setTold] = useState("");
  const copyHead = useRef<HTMLHeadingElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const aiButton = useRef<HTMLButtonElement>(null);
  const focusLine = useRef<string | null>(null);

  const resumes = data?.resumes ?? [];
  const tailored = data?.tailored ?? null;
  const master = resumes.find((r) => r.master);
  const pick = (id: number | null | undefined) => resumes.find((r) => r.id === id);
  // An existing copy keeps the baseline it was made from; ?baseline= only decides where a copy that doesn't exist yet starts.
  const base: DocumentRow | undefined = pick(chosen) ?? (tailored ? pick(tailored.basedOn) : pick(baselineParam)) ?? master;
  const baselineGone = tailored !== null && chosen === null && tailored.basedOn !== undefined && !pick(tailored.basedOn);
  const sections: DocSection[] | null = edits ?? tailored?.sections ?? null;
  const unsaved = edits !== null && (!tailored || !same(edits, tailored.sections));
  // Another baseline picked for an existing copy is a change too: it is saved with the copy (Save stays enabled for it).
  const baselineChanged = tailored !== null && chosen !== null && chosen !== tailored.basedOn;
  const dirty = unsaved || coverDraft !== null || baselineChanged;
  // The leave guard (app/leaveGuard.ts) reads these at the moment of a move, so it is registered once.
  const dirtyNow = useRef(false);
  dirtyNow.current = dirty;
  const discarding = useRef(false);
  const diff = useMemo(() => (base && sections ? compareToBaseline(sections, base.sections) : null), [base, sections]);
  const differs = diff !== null && (diff.leftOut.length > 0 || Object.values(diff.lines).some((l) => l.status !== "same"));

  // Leaving the page by closing or reloading it asks too.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  // Leaving for another page in the app (a nav link, Back, Forward, an edited address) asks too, in place.
  useEffect(
    () => registerLeaveGuard({ isDirty: () => dirtyNow.current && !discarding.current, onBlocked: (to) => setLeaving(to.replace(/^#/, "")) }),
    [],
  );
  // After a control that is gone (Add back, Reset to baseline), focus goes to the line it changed; after Start, to the copy's heading.
  useEffect(() => {
    const id = focusLine.current;
    if (!id) return;
    focusLine.current = null;
    const field = [...(right.current?.querySelectorAll<HTMLElement>("[data-field]") ?? [])].find((el) => el.dataset.field === id);
    (field ?? copyHead.current)?.focus();
  });

  if (data === undefined) return null;
  if (data === null) {
    return (
      <>
        <h1 className="page">Tailor</h1>
        <p className="tailor-empty">That application isn't here any more. <a href="#/tailor">Choose another</a>.</p>
      </>
    );
  }
  const { app, cover, people } = data;
  const name = [app.company, app.role].filter(Boolean).join(", ");
  const posting = app.postingText?.trim() ? app.postingText : "";
  const busy = act.busy !== null;

  if (!base) {
    return (
      <>
        <h1 className="page">Tailor for {name}</h1>
        <p className="tailor-empty">Add your resume first. <a href="#/resume">Go to Resume</a>.</p>
      </>
    );
  }

  const back = (e: MouseEvent) => {
    // A new-tab or new-window click opens nothing here, so it is not stopped.
    if (!dirty || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setLeaving(`/app/${app.id}`);
  };

  const start = () =>
    void act.run("start", async () => {
      await startTailoredFromBaseline(db, appId, base.id);
      setEdits(null);
      focusLine.current = "heading";
      return "Started from your baseline. Edit it on the page.";
    });

  const hasCopy = sections !== null;
  /** Edits of the person's own the AI would replace: the copy differs from its baseline, or there are unsaved edits. */
  const edited = view === "cover" ? coverDraft !== null && coverDraft.text !== letterText(coverDraft.base) : hasCopy && (unsaved || differs);

  const write = async ({ tone, note, signal }: WriteOptions) => {
    const next = await all.tailor(db, appId, { ai: all.ai }, { tone, note, signal, baselineId: base.id });
    if (signal.aborted) return;
    const staged: CoverDraft = { text: letterText(next.cover), base: next.cover, flags: next.coverFlags };
    if (view === "cover") {
      setCoverDraft(staged);
      setTold("Wrote a letter. Check it, then save it.");
      return;
    }
    const first = initialTicks(next.lines);
    setDraft(next);
    setTicks(first);
    setEdits(composeResume(next, base.sections, first));
    // A letter that is already saved is never staged over from here: the combined Save would replace it without the person having looked.
    if (cover) {
      setTold("Wrote a resume draft. Your saved letter was left as it is. To write a new one, use Cover letter.");
      return;
    }
    setCoverDraft((was) => was ?? staged);
    setTold("Wrote a resume draft and a letter. The letter is under Cover letter.");
  };

  const tick = (id: string, on: boolean) => {
    if (!draft) return;
    setTicks((t) => ({ ...t, [id]: on }));
    setEdits(applyTick(sections ?? [], draft, base.sections, id, on));
  };

  const save = () =>
    void act.run("save", async () => {
      const clean = normalizeSections(sections ?? []);
      const letter = coverDraft && coverDraft.text.trim() ? letterSections(coverDraft.text, coverDraft.base) : null;
      // The copy's recorded baseline changes only when it is made, or the person chose another one, or an AI draft was written from another one.
      const basedOn = !tailored || chosen !== null || (draft !== null && tailored.basedOn !== base.id) ? base.id : undefined;
      if (letter) await all.save(db, appId, { resume: clean, cover: letter, ...(basedOn !== undefined ? { baselineId: basedOn } : {}) });
      else await saveTailored(db, appId, clean, draft ? "ai" : tailored?.source ?? "copy", undefined, basedOn);
      setEdits(clean);
      setDraft(null);
      setCoverDraft(null);
      setTold("");
      return letter ? "Saved the tailored resume and cover letter." : "Saved.";
    });

  const saveLetter = () =>
    void act.run("letter", async () => {
      if (!coverDraft) return;
      await saveCoverLetter(db, appId, letterSections(coverDraft.text, coverDraft.base), "ai");
      setCoverDraft(null);
      setTold("");
      return "Saved the letter.";
    });

  const aiLabel = view === "cover" ? (coverDraft || cover ? "Rewrite with AI" : "Write with AI") : hasCopy && differs ? "Rewrite with AI" : "Write with AI";
  const strip = aiOpen ? (
    <TailorAi
      dbName={db.name} ai={all.ai} run={write} edited={edited} disabled={busy}
      onClose={() => { setAiOpen(false); setTimeout(() => aiButton.current?.focus(), 0); }}
    />
  ) : null;
  const aiButtonEl = !aiOpen ? (
    <button type="button" ref={aiButton} onClick={() => { setTold(""); setAiOpen(true); }} disabled={busy}>{aiLabel}</button>
  ) : null;

  const baselineSheet = <ResumeSheet sections={base.sections} title={base.title} />;

  return (
    <div className="tailor">
      <header className="tailor-head">
        <a className="back" href={`#/app/${app.id}`} onClick={back}>Back to {name || "the application"}</a>
        <h1 className="page">Tailor for {name}</h1>
        <div className="doc-switch" role="group" aria-label="What to tailor">
          <button type="button" aria-pressed={view === "resume"} onClick={() => setView("resume")}>Resume</button>
          <button type="button" aria-pressed={view === "cover"} onClick={() => setView("cover")}>Cover letter</button>
        </div>
      </header>
      {leaving ? (
        <InlineConfirm
          title="Leave without saving?" help="Your changes to the tailored copy and the letter haven't been saved."
          confirmLabel="Discard changes" onConfirm={() => { discarding.current = true; navigate(leaving); }} onCancel={() => setLeaving(null)} act={act} actionKey="leave"
        />
      ) : null}
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      <p className="small muted tailor-status" role="status">{act.status ?? ""}</p>

      {view === "resume" ? (
        <div className="tailor-cols">
          <div className="tailor-left documents">
            <div className="fgroup tailor-baseline-select">
              <label htmlFor="tailor-baseline">Baseline</label>
              <select
                id="tailor-baseline" value={base.id} onChange={(e) => setChosen(Number(e.target.value))}
                disabled={draft !== null} aria-describedby={draft ? "tailor-baseline-why" : undefined}
              >
                {resumes.map((r) => <option key={r.id} value={r.id}>{r.master ? `Master: ${r.title}` : r.title}</option>)}
              </select>
              {draft ? <p id="tailor-baseline-why" className="small muted">The draft was written from this baseline. Save it to choose another.</p> : null}
              {baselineGone ? <p className="small muted">The baseline this copy was made from is gone, so it is compared with your master.</p> : null}
            </div>
            {phone ? (
              <details className="more tailor-baseline-sheet">
                <summary>Show baseline</summary>
                {baselineSheet}
              </details>
            ) : (
              <div className="tailor-baseline-sheet" role="group" aria-label={`Baseline: ${base.title}`}>{baselineSheet}</div>
            )}
            <section className="tailor-posting" aria-labelledby="tailor-posting-h">
              <h2 id="tailor-posting-h" className="doc-h">Job posting</h2>
              <PostingCard db={db} app={app} act={act} enrich={all.enrichJobDraft} />
            </section>
            {posting ? <PostingTerms posting={posting} sections={sections ?? base.sections} company={app.company} /> : null}
          </div>

          <div className="tailor-right" ref={right}>
            <h2 className="doc-h tailor-copy-h" tabIndex={-1} ref={copyHead}>Tailored copy</h2>
            {strip}
            {sections ? (
              <>
                <div className="row tailor-tools">
                  {aiButtonEl}
                  <button type="button" aria-pressed={compare} onClick={() => setCompare((c) => !c)}>Compare with baseline</button>
                </div>
                <BaselineMarks compare={diff!} on={compare} onActive={setActive}>
                  <ResumeEditing sections={sections} onChange={setEdits} label="Tailored resume" title={tailored?.title ?? base.title} />
                </BaselineMarks>
                <div className="row tailor-actions">
                  <button type="button" className="primary" onClick={save} disabled={busy || !dirty} {...(act.busy === "save" ? { "aria-busy": true as const } : {})}>Save</button>
                  {tailored && !dirty ? <a className="btn" href={`#/resume/print/${tailored.id}`}>Print</a> : (
                    <>
                      <button type="button" disabled aria-describedby="tailor-print-why">Print</button>
                      <span id="tailor-print-why" className="small muted">Save first to print.</span>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="row tailor-start">
                <button type="button" className="primary" onClick={start} {...act.button("start")}>Start from baseline</button>
                {aiButtonEl}
              </div>
            )}
            {diff && sections ? (
              <>
                {compare ? <Changes compare={diff} sections={sections} activeId={active} disabled={busy} onReset={(id) => { focusLine.current = id; setEdits(resetLine(sections, base.sections, id)); }} /> : null}
                <LeftOut compare={diff} disabled={busy} onAddBack={(id) => { focusLine.current = id; setEdits(addBackLine(sections, base.sections, id)); }} />
              </>
            ) : null}
            {draft && sections ? <Ticks draft={draft} ticks={ticks} onTick={tick} /> : null}
          </div>
        </div>
      ) : (
        <div className="documents tailor-letter">
          {strip}
          {coverDraft ? (
            <section className="doc-block" aria-label="Letter draft">
              <h3 className="doc-h">Cover letter draft</h3>
              {coverDraft.flags.map((f) => <p key={f} className="small tailor-flag">{f}</p>)}
              <label className="sr" htmlFor="tailor-letter-draft">Cover letter draft</label>
              <textarea id="tailor-letter-draft" className="doc-letter-text" rows={14} value={coverDraft.text} onChange={(e) => setCoverDraft({ ...coverDraft, text: e.target.value })} />
              <div className="row">
                <button type="button" className="primary" onClick={saveLetter} disabled={busy || !coverDraft.text.trim()} {...(act.busy === "letter" ? { "aria-busy": true as const } : {})}>Save letter</button>
                <button type="button" onClick={() => setCoverDraft(null)} disabled={busy}>Discard draft</button>
                {aiButtonEl}
              </div>
            </section>
          ) : (
            <>
              <CoverLetter db={db} app={app} cover={cover ?? undefined} people={people} act={act} startLabel="Start a letter" />
              <div className="row tailor-tools">{aiButtonEl}</div>
            </>
          )}
          {told ? <p className="small muted" role="status">{told}</p> : null}
        </div>
      )}
      {view === "resume" && told ? <p className="small muted" role="status">{told}</p> : null}
    </div>
  );
}

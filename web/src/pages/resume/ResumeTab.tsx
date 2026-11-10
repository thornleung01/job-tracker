import { TRASH_DAYS } from "../../db/limits";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { realAiDeps, type AiDeps } from "../../ai";
import { InlineConfirm } from "../../components/InlineConfirm";
import { Notice } from "../../components/Notice";
import { useAction } from "../../components/useAction";
import { MAX_DOC_TITLE_CHARS } from "../../db/limits";
import type { DocSection, DocumentRow, JobTrackerDB } from "../../db/schema";
import { convertResume, type ConvertResult } from "../../sync/convert";
import { createVersion, deleteDocument, saveMaster, updateDocument } from "../../sync/documents";
import { plural } from "../../sync/text";
import { ConvertPanel, type ConvertFn } from "./ConvertPanel";
import { FlagList } from "./FlagList";
import { Importer, type Incoming } from "./Importer";
import { ResumeEditing } from "../../components/documents/ResumeEditing";
import { normalizeSections } from "../../db/documentShape";
import { blankResume, isBlankTemplate, withoutEmptySections } from "../../documents/blankResume";
import { rereadAsTemplate } from "../../documents/reread";

interface CardProps {
  db: JobTrackerDB;
  doc: DocumentRow;
  /** how many live applications were sent this resume */
  used: number;
  /** say something on the page, and move focus to it when the control that had focus is gone */
  say(message: string, removed?: boolean): void;
}

/** What you have typed and not saved. null means nothing is pending, and the saved text shows. */
function useDraft(doc: DocumentRow) {
  const [draft, setDraft] = useState<DocSection[] | null>(null);
  return { sections: draft ?? doc.sections, dirty: draft !== null, set: setDraft };
}

function Status({ text }: { text: string | null }) {
  return <span className="muted small doc-status" role="status">{text ?? ""}</span>;
}

function Used({ id, used }: { id: number; used: number }) {
  const label = `Used for ${plural(used, "application")}`;
  return <p className="muted small doc-used">{used ? <a href={`#/?resume=${id}`}>{label}</a> : label}</p>;
}

/** The text of a resume with a Save button: nothing is written until it is pressed. */
function EditorBlock({ db, doc, label, draft, act, onSaved, onCancel, saveLabel = "Save" }: {
  db: JobTrackerDB; doc: DocumentRow; label: string; draft: ReturnType<typeof useDraft>; act: ReturnType<typeof useAction>;
  onSaved?(): void; onCancel?(): void; saveLabel?: string;
}) {
  const save = () =>
    void act.run("save", async () => {
      await updateDocument(db, doc.id, { sections: withoutEmptySections(normalizeSections(draft.sections)) });
      draft.set(null);
      onSaved?.();
      return "Saved";
    });
  return (
    <>
      <ResumeEditing sections={draft.sections} onChange={draft.set} label={label} title={doc.title} />
      <div className="row doc-save">
        <button type="button" className="primary" onClick={save} disabled={act.busy !== null || (!draft.dirty && !onCancel)} aria-busy={act.busy === "save" || undefined}>{saveLabel}</button>
        {onCancel ? <button type="button" onClick={() => { draft.set(null); onCancel(); }} disabled={act.busy !== null}>Cancel</button> : null}
        {!onCancel && draft.dirty ? <button type="button" onClick={() => draft.set(null)} disabled={act.busy !== null}>Discard changes</button> : null}
        <Status text={act.busy === null ? act.status : null} />
      </div>
    </>
  );
}

/** What the review shows: the sections to check, where they came from, and for an AI conversion what it wasn't sure about. */
interface Draft {
  sections: DocSection[];
  source: NonNullable<DocumentRow["source"]>;
  ai?: ConvertResult;
}

/** A new master resume to check: the split text is editable, and Save as master resume is the only thing that stores it. */
function Review({ db, draft, existing, title: heading, onDone, onAgain, onSimple }: {
  db: JobTrackerDB; draft: Draft; existing: boolean; title?: string; onDone(): void; onAgain(): void; onSimple(): void;
}) {
  const [sections, setSections] = useState(draft.sections);
  const act = useAction();
  const card = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const save = () =>
    void act.run("save", async () => {
      await saveMaster(db, withoutEmptySections(normalizeSections(sections)), draft.source);
      onDone();
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
        {draft.ai ? <button type="button" onClick={onAgain} disabled={act.busy !== null}>Convert again</button> : null}
        {draft.ai ? <button type="button" onClick={onSimple} disabled={act.busy !== null}>Use the simple converter</button> : null}
        <button type="button" onClick={onDone} disabled={act.busy !== null}>Cancel</button>
      </div>
    </div>
  );
}

/** A blank copy of the template to type into. Nothing is stored until Save, and Save stays off until there is some text. */
function TemplateStart({ db, onDone }: { db: JobTrackerDB; onDone(): void }) {
  const [sections, setSections] = useState(blankResume);
  const [confirming, setConfirming] = useState(false);
  const act = useAction();
  const save = () =>
    void act.run("save", async () => {
      await saveMaster(db, withoutEmptySections(normalizeSections(sections)), "template");
      onDone();
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

const dismissKey = (id: number) => `jobtracker:reread-dismissed:${id}`;
/** Dismissed for this master until the tab is closed (sessionStorage); false when storage is unavailable. */
function readDismissed(id: number): boolean {
  try {
    return sessionStorage.getItem(dismissKey(id)) === "1";
  } catch {
    return false;
  }
}
function rememberDismissed(id: number): void {
  try {
    sessionStorage.setItem(dismissKey(id), "1");
  } catch {
    // no storage: it stays dismissed until the card is remounted
  }
}

/** For a resume saved before the template: a quiet offer to read it again, which opens the review. It stores nothing itself. */
function RereadOffer({ id, sections, onReread }: { id: number; sections: DocSection[]; onReread(next: DocSection[]): void }) {
  const [dismissed, setDismissed] = useState(() => readDismissed(id));
  const better = useMemo(() => rereadAsTemplate(sections), [sections]);
  if (!better || dismissed) return null;
  return (
    <div className="row doc-reread">
      <p className="muted small">This resume was saved before the template. Re-read it as the template?</p>
      <button type="button" onClick={() => onReread(better)}>Re-read</button>
      <button type="button" onClick={() => { rememberDismissed(id); setDismissed(true); }}>Dismiss</button>
    </div>
  );
}

function MasterCard({ db, doc, used, onIncoming, onReread }: Omit<CardProps, "say"> & { onIncoming(i: Incoming): void; onReread(next: DocSection[]): void }) {
  const draft = useDraft(doc);
  const act = useAction();
  const [making, setMaking] = useState(false);
  const [title, setTitle] = useState("");
  const make = (e: FormEvent) => {
    e.preventDefault();
    void act.run("make", async () => {
      await createVersion(db, { title, sections: draft.sections, basedOn: doc.id, source: "copy" });
      setMaking(false);
      return `Made ${title.trim() || "Resume"}`;
    });
  };
  return (
    <div className="card doc-card">
      <h2 className="section">{doc.title}</h2>
      <Used id={doc.id} used={used} />
      <div className="row doc-actions">
        <Importer fileLabel="Replace with a file" onRead={onIncoming} primary={false} />
      </div>
      <RereadOffer id={doc.id} sections={doc.sections} onReread={onReread} />
      <EditorBlock db={db} doc={doc} label={doc.title} draft={draft} act={act} />
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      <div className="row doc-actions">
        <button type="button" aria-expanded={making} onClick={() => { setMaking((m) => !m); setTitle(""); act.clear(); }}>Make a version</button>
        <a className="btn" href="#/tailor">Tailor for a job</a>
        <a className="btn" href={`#/resume/print/${doc.id}`}>Print</a>
      </div>
      {making ? (
        <form className="row doc-name-form" onSubmit={make}>
          <div className="fgroup">
            <label htmlFor="version-name">Version name</label>
            <input id="version-name" type="text" value={title} maxLength={MAX_DOC_TITLE_CHARS} placeholder="Resume for data roles" onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <button type="submit" className="primary" {...act.button("make")}>Make version</button>
          <button type="button" onClick={() => setMaking(false)} disabled={act.busy !== null}>Cancel</button>
        </form>
      ) : null}
    </div>
  );
}

function VersionCard({ db, doc, used, say }: CardProps) {
  const draft = useDraft(doc);
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(doc.title);
  const [confirming, setConfirming] = useState(false);

  const rename = (e: FormEvent) => {
    e.preventDefault();
    void act.run("rename", async () => {
      await updateDocument(db, doc.id, { title: name });
      setRenaming(false);
      return "Saved";
    });
  };
  const duplicate = () =>
    void act.run("duplicate", async () => {
      await createVersion(db, { title: `${doc.title} copy`, sections: doc.sections, basedOn: doc.id, source: "copy" });
      return "Duplicated";
    });
  const remove = () =>
    void act.run("delete", async () => {
      await deleteDocument(db, doc.id);
      say(`Deleted ${doc.title}. It's in Recently deleted for ${TRASH_DAYS} days.`, true);
    });

  return (
    <div className="card doc-card">
      <h2 className="section">{doc.title}</h2>
      <Used id={doc.id} used={used} />
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      {renaming ? (
        <form className="row doc-name-form" onSubmit={rename}>
          <div className="fgroup">
            <label htmlFor={`rename-${doc.id}`}>Name</label>
            <input id={`rename-${doc.id}`} type="text" value={name} maxLength={MAX_DOC_TITLE_CHARS} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <button type="submit" className="primary" {...act.button("rename")}>Save</button>
          <button type="button" onClick={() => { setRenaming(false); setName(doc.title); }} disabled={act.busy !== null}>Cancel</button>
        </form>
      ) : null}
      <div className="row doc-actions">
        {editing ? null : <button type="button" onClick={() => setEditing(true)} disabled={act.busy !== null}>Edit</button>}
        <button type="button" onClick={() => { setRenaming(true); setName(doc.title); }} disabled={act.busy !== null || renaming}>Rename</button>
        <button type="button" onClick={duplicate} {...act.button("duplicate")}>Duplicate</button>
        <a className="btn" href={`#/tailor?baseline=${doc.id}`} aria-label={`Tailor with this resume: ${doc.title}`}>Tailor with this</a>
        <a className="btn" href={`#/resume/print/${doc.id}`}>Print</a>
        <button type="button" className="danger" onClick={() => setConfirming(true)} disabled={act.busy !== null || confirming}>Delete</button>
        {!editing ? <Status text={act.busy === null ? act.status : null} /> : null}
      </div>
      {confirming ? (
        <InlineConfirm title="Delete this resume version?" help={`It stays in Recently deleted for ${TRASH_DAYS} days.`} confirmLabel="Delete" act={act} actionKey="delete"
                       onConfirm={remove} onCancel={() => setConfirming(false)} />
      ) : null}
      {editing ? <EditorBlock db={db} doc={doc} label={doc.title} draft={draft} act={act} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} /> : null}
    </div>
  );
}

/** A file or pasted text on its way in. `draft` exists only once there is something to review, and `incoming` is kept so Convert again and the simple converter can start from the same text. */
interface Pending {
  incoming: Incoming;
  draft: Draft | null;
  /** an old resume read again: the review is titled "Check your resume" even though a master exists */
  reread?: boolean;
}

interface TabProps {
  db: JobTrackerDB;
  resumes: DocumentRow[];
  usage: ReadonlyMap<number, number>;
  say(message: string, removed?: boolean): void;
  /** the AI key and the conversion, replaced in tests */
  deps?: Partial<{ ai: AiDeps; convert: ConvertFn }>;
}

export function ResumeTab({ db, resumes, usage, say, deps }: TabProps) {
  const master = resumes.find((d) => d.master);
  const versions = resumes.filter((d) => !d.master);
  const ai = deps?.ai ?? realAiDeps;
  const convert = deps?.convert ?? convertResume;
  // A file or pasted text goes to the convert panel first, then to the review. `reviewKey` gives the review a fresh start each time its sections are swapped.
  const [pending, setPending] = useState<Pending | null>(null);
  const [reviewKey, setReviewKey] = useState(0);
  const review = (next: Draft) => {
    setPending((p) => p && { ...p, draft: next });
    setReviewKey((n) => n + 1);
  };
  const [templating, setTemplating] = useState(false);
  const startReading = (incoming: Incoming) => setPending({ incoming, draft: null });
  // An old resume read again goes straight to the review, so nothing is stored until Save.
  const startReread = (sections: DocSection[]) => {
    // saving keeps how the master first came in, so re-reading does not turn an upload or a template into a paste
    const source = master?.source ?? "paste";
    setPending({ incoming: { sections, text: "", source: source === "upload" ? "upload" : "paste" }, draft: { sections, source }, reread: true });
    setReviewKey((n) => n + 1);
  };
  const done = () => setPending(null);
  const useSimple = () => pending && review({ sections: pending.incoming.sections, source: pending.incoming.source });
  return (
    <>
      {pending && !pending.draft ? (
        <ConvertPanel db={db} incoming={pending.incoming} ai={ai} convert={convert} onCancel={done} onSimple={useSimple}
                      onConverted={(result) => review({ sections: result.sections, source: "ai", ai: result })} />
      ) : null}
      {pending?.draft ? (
        <Review key={`review-${reviewKey}`} db={db} draft={pending.draft} existing={Boolean(master)} title={pending.reread ? "Check your resume" : undefined} onDone={done}
                onAgain={() => setPending({ ...pending, draft: null })} onSimple={useSimple} />
      ) : null}
      {!master && !pending && templating ? <TemplateStart db={db} onDone={() => setTemplating(false)} /> : null}
      {!master && !pending && !templating ? (
        <div className="card doc-card doc-empty">
          <div className="doc-choices">
            <button type="button" className="primary" onClick={() => setTemplating(true)}>Start from the template</button>
            <Importer fileLabel="Upload a file" onRead={startReading} primary={false} />
          </div>
        </div>
      ) : null}
      {master ? <MasterCard key={master.id} db={db} doc={master} used={usage.get(master.id) ?? 0} onIncoming={startReading} onReread={startReread} /> : null}
      {versions.map((v) => <VersionCard key={v.id} db={db} doc={v} used={usage.get(v.id) ?? 0} say={say} />)}
    </>
  );
}

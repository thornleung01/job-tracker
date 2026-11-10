import { useMemo, useState, type FormEvent } from "react";
import { realAiDeps, type AiDeps } from "../../ai";
import { InlineConfirm } from "../../components/InlineConfirm";
import { Notice } from "../../components/Notice";
import { useAction } from "../../components/useAction";
import { MAX_DOC_TITLE_CHARS, TRASH_DAYS } from "../../db/limits";
import type { DocSection, DocumentRow, JobTrackerDB } from "../../db/schema";
import { convertResume } from "../../sync/convert";
import { createVersion, deleteDocument, updateDocument } from "../../sync/documents";
import { plural } from "../../sync/text";
import type { ConvertFn } from "./ConvertPanel";
import { Importer, type Incoming } from "./Importer";
import { ResumeEditing } from "../../components/documents/ResumeEditing";
import { cleanForSave } from "../../documents/blankResume";
import { rereadAsTemplate } from "../../documents/reread";
import { Intake, useIntake } from "./intake";
import { useReportUnsaved, type ReportUnsaved } from "./unsaved";

interface CardProps {
  db: JobTrackerDB;
  doc: DocumentRow;
  /** how many live applications were sent this resume */
  used: number;
  /** say something on the page, and move focus to it when the control that had focus is gone */
  say(message: string, removed?: boolean): void;
  /** tells the page whether this card holds text that is typed and not saved (see unsaved.ts) */
  report: ReportUnsaved;
}

/** What you have typed and not saved. null means nothing is pending, and the saved text shows. */
function useUnsavedSections(doc: DocumentRow) {
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
  db: JobTrackerDB; doc: DocumentRow; label: string; draft: ReturnType<typeof useUnsavedSections>; act: ReturnType<typeof useAction>;
  onSaved?(): void; onCancel?(): void; saveLabel?: string;
}) {
  const save = () =>
    void act.run("save", async () => {
      await updateDocument(db, doc.id, { sections: cleanForSave(draft.sections) });
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

function MasterCard({ db, doc, used, report, onIncoming, onReread }: Omit<CardProps, "say"> & { onIncoming(i: Incoming): void; onReread(next: DocSection[]): void }) {
  const draft = useUnsavedSections(doc);
  useReportUnsaved(report, `master-${doc.id}`, draft.dirty);
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
      <h2 className="section" id="resume-master-h" tabIndex={-1}>{doc.title}</h2>
      <Used id={doc.id} used={used} />
      <div className="row doc-actions">
        <Importer fileLabel="Replace with a file" onRead={onIncoming} primary={false} />
      </div>
      <RereadOffer id={doc.id} sections={doc.sections} onReread={onReread} />
      <EditorBlock db={db} doc={doc} label={doc.title} draft={draft} act={act} />
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      <div className="row doc-actions">
        <button type="button" aria-expanded={making} onClick={() => { setMaking((m) => !m); setTitle(""); act.clear(); }}>Make a version</button>
        <a className="btn" href="#/resume?step=job">Tailor for a job</a>
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

function VersionCard({ db, doc, used, say, report }: CardProps) {
  const draft = useUnsavedSections(doc);
  useReportUnsaved(report, `version-${doc.id}`, draft.dirty);
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
        <a className="btn" href={`#/resume?step=job&baseline=${doc.id}`} aria-label={`Tailor with this resume: ${doc.title}`}>Tailor with this</a>
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

interface TabProps {
  db: JobTrackerDB;
  resumes: DocumentRow[];
  usage: ReadonlyMap<number, number>;
  say(message: string, removed?: boolean): void;
  /** the page's record of unsaved text, which asks before leaving */
  report: ReportUnsaved;
  /** the AI key and the conversion, replaced in tests */
  deps?: Partial<{ ai: AiDeps; convert: ConvertFn }>;
}

/** The master and version editors. Before there is a master the Resume section at the top of the page brings one in, so this tab has only a line. */
export function ResumeTab({ db, resumes, usage, say, report, deps }: TabProps) {
  const master = resumes.find((d) => d.master);
  const versions = resumes.filter((d) => !d.master);
  const ai = deps?.ai ?? realAiDeps;
  const convert = deps?.convert ?? convertResume;
  // "Replace with a file" and the re-read offer go to the convert panel, then to the review; nothing is stored until Save.
  const intake = useIntake(master);
  return (
    <>
      <Intake db={db} intake={intake} existing={Boolean(master)} ai={ai} convert={convert} report={report} />
      {master ? <MasterCard key={master.id} db={db} doc={master} used={usage.get(master.id) ?? 0} onIncoming={intake.start} onReread={intake.reread} report={report} />
        : <p className="muted doc-none">No master resume yet.</p>}
      {versions.map((v) => <VersionCard key={v.id} db={db} doc={v} used={usage.get(v.id) ?? 0} say={say} report={report} />)}
    </>
  );
}

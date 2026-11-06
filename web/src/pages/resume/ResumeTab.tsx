import { TRASH_DAYS } from "../../db/limits";
import { useState, type FormEvent } from "react";
import { InlineConfirm } from "../../components/InlineConfirm";
import { Notice } from "../../components/Notice";
import { useAction } from "../../components/useAction";
import { MAX_DOC_TITLE_CHARS } from "../../db/limits";
import type { DocSection, DocumentRow, JobTrackerDB } from "../../db/schema";
import { createVersion, deleteDocument, saveMaster, updateDocument } from "../../sync/documents";
import { plural } from "../../sync/text";
import { Importer, type Incoming } from "./Importer";
import { SectionsEditor } from "../../components/documents/SectionsEditor";

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
      await updateDocument(db, doc.id, { sections: draft.sections });
      draft.set(null);
      onSaved?.();
      return "Saved";
    });
  return (
    <>
      <SectionsEditor sections={draft.sections} onChange={draft.set} label={label} />
      <div className="row doc-save">
        <button type="button" className="primary" onClick={save} disabled={act.busy !== null || (!draft.dirty && !onCancel)} aria-busy={act.busy === "save" || undefined}>{saveLabel}</button>
        {onCancel ? <button type="button" onClick={() => { draft.set(null); onCancel(); }} disabled={act.busy !== null}>Cancel</button> : null}
        {!onCancel && draft.dirty ? <button type="button" onClick={() => draft.set(null)} disabled={act.busy !== null}>Discard changes</button> : null}
        <Status text={act.busy === null ? act.status : null} />
      </div>
    </>
  );
}

/** A new master resume to check: the split text is editable, and Save as master resume is the only thing that stores it. */
function Review({ db, incoming, existing, onDone }: { db: JobTrackerDB; incoming: Incoming; existing: boolean; onDone(): void }) {
  const [sections, setSections] = useState(incoming.sections);
  const act = useAction();
  const save = () =>
    void act.run("save", async () => {
      await saveMaster(db, sections, incoming.source);
      onDone();
    });
  return (
    <div className="card doc-card">
      <h2 className="section">{existing ? "Replace your master resume" : "Check your resume"}</h2>
      <SectionsEditor sections={sections} onChange={setSections} label="Resume text to check" />
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      <div className="row doc-save">
        <button type="button" className="primary" onClick={save} {...act.button("save")}>Save as master resume</button>
        <button type="button" onClick={onDone} disabled={act.busy !== null}>Cancel</button>
      </div>
    </div>
  );
}

function MasterCard({ db, doc, used, onIncoming }: Omit<CardProps, "say"> & { onIncoming(i: Incoming): void }) {
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
      <EditorBlock db={db} doc={doc} label={doc.title} draft={draft} act={act} />
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      <div className="row doc-actions">
        <button type="button" aria-expanded={making} onClick={() => { setMaking((m) => !m); setTitle(""); act.clear(); }}>Make a version</button>
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
}

export function ResumeTab({ db, resumes, usage, say }: TabProps) {
  const master = resumes.find((d) => d.master);
  const versions = resumes.filter((d) => !d.master);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  return (
    <>
      {incoming ? <Review db={db} incoming={incoming} existing={Boolean(master)} onDone={() => setIncoming(null)} /> : null}
      {!master && !incoming ? (
        <div className="card doc-card doc-empty">
          <Importer fileLabel="Upload a file" onRead={setIncoming} />
        </div>
      ) : null}
      {master ? <MasterCard key={master.id} db={db} doc={master} used={usage.get(master.id) ?? 0} onIncoming={setIncoming} /> : null}
      {versions.map((v) => <VersionCard key={v.id} db={db} doc={v} used={usage.get(v.id) ?? 0} say={say} />)}
    </>
  );
}

import { useId, useState } from "react";
import { normalizeSections } from "../../db/documentShape";
import type { ApplicationRow, DocSection, DocumentRow, JobTrackerDB } from "../../db/schema";
import { withoutEmptySections } from "../../documents/blankResume";
import { copyResumeForApplication, setApplicationResume, updateDocument } from "../../sync/documents";
import type { ActionRunner } from "../useAction";
import { ResumeEditing } from "./ResumeEditing";

interface Props {
  db: JobTrackerDB;
  app: ApplicationRow;
  /** the resumes you haven't deleted, master first */
  resumes: readonly DocumentRow[];
  act: ActionRunner;
}

/** The chosen resume's text as fields. Nothing is saved until Save. It is keyed by the resume, so choosing another starts from that one. */
function EditResume({ sections, title, act, onSave, onCancel }: { sections: readonly DocSection[]; title: string; act: ActionRunner; onSave(sections: DocSection[]): void; onCancel(): void }) {
  const [draft, setDraft] = useState<DocSection[]>(() => sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i })) })));
  return (
    <div className="doc-resume-edit">
      <ResumeEditing sections={draft} onChange={setDraft} label="Edit resume" title={title} />
      <div className="row doc-actions">
        <button type="button" className="primary" onClick={() => onSave(draft)} {...act.button("resume-edit")}>Save</button>
        <button type="button" onClick={onCancel} disabled={act.busy !== null}>Cancel</button>
      </div>
    </div>
  );
}

/** Which resume version went with this application: choose one, make a copy for this job, edit it, print it. */
export function ResumeSent({ db, app, resumes, act }: Props) {
  const labelId = useId();
  const [editing, setEditing] = useState(false);
  const chosen = resumes.find((r) => r.id === app.resumeId);
  const hasMaster = resumes.some((r) => r.master);
  // The resume it points at was deleted: it is in Recently deleted, and comes back here when restored.
  const deleted = app.resumeId !== undefined && !chosen;

  const choose = (value: string) => {
    void act.run("resume-choose", async () => {
      await setApplicationResume(db, app.id, value ? Number(value) : null);
      setEditing(false);
      return "Saved.";
    });
  };
  const copy = () => {
    void act.run("resume-copy", async () => {
      await copyResumeForApplication(db, app.id);
      setEditing(true);
      return "Made a copy for this job.";
    });
  };
  const save = (sections: DocSection[]) => {
    if (!chosen) return;
    void act.run("resume-edit", async () => {
      await updateDocument(db, chosen.id, { sections: withoutEmptySections(normalizeSections(sections)) });
      setEditing(false);
      return "Saved.";
    });
  };

  return (
    <div className="doc-block">
      <h3 className="doc-h" id={labelId}>Resume sent</h3>
      <div className="row">
        <select name="resume" aria-labelledby={labelId} value={chosen ? String(chosen.id) : ""} disabled={act.busy !== null} onChange={(e) => choose(e.target.value)}>
          <option value="">None</option>
          {resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
        {hasMaster ? (
          <button type="button" onClick={copy} {...act.button("resume-copy")}>Make a copy for this job</button>
        ) : (
          <a className="btn" href="#/resume">Add your resume</a>
        )}
        {chosen ? (
          <>
            <button type="button" aria-expanded={editing} onClick={() => setEditing((on) => !on)} disabled={act.busy !== null}>Edit</button>
            <a className="btn" href={`#/resume/print/${chosen.id}`}>Print</a>
          </>
        ) : null}
      </div>
      {deleted ? <p className="small muted doc-note">Resume sent: (deleted)</p> : null}
      {chosen && editing ? <EditResume key={chosen.id} sections={chosen.sections} title={chosen.title} act={act} onSave={save} onCancel={() => setEditing(false)} /> : null}
    </div>
  );
}

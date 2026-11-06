import { useId, useState } from "react";
import type { ApplicationRow, DocSection, DocumentRow, JobTrackerDB } from "../../db/schema";
import { copyResumeForApplication, setApplicationResume, updateDocument } from "../../sync/documents";
import type { ActionRunner } from "../useAction";
import { ResumeEditor } from "./ResumeEditor";

interface Props {
  db: JobTrackerDB;
  app: ApplicationRow;
  /** the resumes you haven't deleted, master first */
  resumes: readonly DocumentRow[];
  act: ActionRunner;
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
      await updateDocument(db, chosen.id, { sections });
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
      {chosen && editing ? <ResumeEditor key={chosen.id} sections={chosen.sections} act={act} onSave={save} onCancel={() => setEditing(false)} /> : null}
    </div>
  );
}

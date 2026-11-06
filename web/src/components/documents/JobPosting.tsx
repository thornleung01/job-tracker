import { useState, type FormEvent } from "react";
import { MAX_POSTING_CHARS } from "../../db/limits";
import type { ApplicationRow, JobTrackerDB } from "../../db/schema";
import { setPostingText } from "../../sync/documents";
import type { ActionRunner } from "../useAction";
import { guarded } from "./guard";

/** The counter shows from this share of the limit on. */
const NEAR_LIMIT = 0.9;

interface Props {
  db: JobTrackerDB;
  app: ApplicationRow;
  act: ActionRunner;
}

/** The text of the job posting, kept in case the page comes down. Closed by default. */
export function JobPosting({ db, app, act }: Props) {
  const saved = app.postingText ?? "";
  const [text, setText] = useState<string | null>(null);   // the text box, while it is open
  const editing = text !== null || !saved;
  const value = text ?? "";
  const id = `posting-${app.id}`;

  const save = (e: FormEvent) => {
    e.preventDefault();
    void act.run("posting", async () => {
      await guarded(() => setPostingText(db, app.id, value));
      setText(null);
      return value.trim() ? "Saved." : "Job posting removed.";
    });
  };

  return (
    <details className="more doc-posting">
      <summary>Job posting</summary>
      {editing ? (
        <form className="doc-posting-form" onSubmit={save}>
          <label className="field small" htmlFor={id}>{saved ? "Job posting" : "Paste the job posting"}</label>
          <textarea id={id} rows={10} maxLength={MAX_POSTING_CHARS} value={text ?? saved} onChange={(e) => setText(e.target.value)} />
          {(text ?? saved).length >= MAX_POSTING_CHARS * NEAR_LIMIT ? (
            <p className="small muted doc-note">{(text ?? saved).length.toLocaleString("en-CA")} of {MAX_POSTING_CHARS.toLocaleString("en-CA")} characters</p>
          ) : null}
          <div className="row">
            <button type="submit" className="primary" disabled={act.busy !== null || (text ?? saved) === saved} {...(act.busy === "posting" ? { "aria-busy": true as const } : {})}>Save</button>
            {saved ? <button type="button" onClick={() => setText(null)} disabled={act.busy !== null}>Cancel</button> : null}
          </div>
        </form>
      ) : (
        <>
          <p className="doc-posting-text">{saved}</p>
          <div className="row"><button type="button" onClick={() => setText(saved)}>Edit</button></div>
        </>
      )}
    </details>
  );
}

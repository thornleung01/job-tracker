import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_POSTING_CHARS } from "../../db/limits";
import { EMPTY_DRAFT } from "../../jobs/types";
import type { ApplicationRow, JobTrackerDB } from "../../db/schema";
import { setPostingText } from "../../sync/documents";
import type { ActionRunner } from "../useAction";
import type { DocumentsDeps } from "./deps";

/** The counter shows from this share of the limit on. */
const NEAR_LIMIT = 0.9;

interface Props {
  db: JobTrackerDB;
  app: ApplicationRow;
  act: ActionRunner;
  /** reads the posting from its link (the job boards' public pages), when the application has one */
  enrich: DocumentsDeps["enrichJobDraft"];
  /** counts up each time something asks for the box to be opened and the text field to take focus */
  openRequest?: number;
  /** a sentence under the summary, saying why the box was opened */
  hint?: string;
}

/** The text of the job posting, kept in case the page comes down. Closed by default. */
export function JobPosting({ db, app, act, enrich, openRequest = 0, hint }: Props) {
  const saved = app.postingText ?? "";
  const [text, setText] = useState<string | null>(null);   // the text box, while it is open
  const editing = text !== null || !saved;
  const value = text ?? "";
  const id = `posting-${app.id}`;
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!openRequest || !box.current) return;
    box.current.open = true;
    box.current.querySelector("textarea")?.focus();
  }, [openRequest]);

  const fill = () => {
    const url = app.postingUrl;
    if (!url) return;
    void act.run("posting-fill", async () => {
      const found = await enrich({ ...EMPTY_DRAFT, company: app.company, role: app.role, url });
      if (!found.description) return "Couldn't read a posting from that link. Paste it instead.";
      setText(found.description);
      return "Filled from the link. Check it, then Save.";
    });
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    void act.run("posting", async () => {
      await setPostingText(db, app.id, value);
      setText(null);
      return value.trim() ? "Saved." : "Job posting removed.";
    });
  };

  return (
    <details className="more doc-posting" ref={box}>
      <summary>Job posting</summary>
      {hint ? <p className="small muted doc-note">{hint}</p> : null}
      {editing ? (
        <form className="doc-posting-form" onSubmit={save}>
          <label className="field small" htmlFor={id}>{saved ? "Job posting" : "Paste the job posting"}</label>
          <textarea id={id} rows={10} maxLength={MAX_POSTING_CHARS} value={text ?? saved} onChange={(e) => setText(e.target.value)} />
          {(text ?? saved).length >= MAX_POSTING_CHARS * NEAR_LIMIT ? (
            <p className="small muted doc-note">{(text ?? saved).length.toLocaleString("en-CA")} of {MAX_POSTING_CHARS.toLocaleString("en-CA")} characters</p>
          ) : null}
          <div className="row">
            <button type="submit" className="primary" disabled={act.busy !== null || (text ?? saved) === saved} {...(act.busy === "posting" ? { "aria-busy": true as const } : {})}>Save</button>
            {app.postingUrl ? <button type="button" onClick={fill} {...act.button("posting-fill")}>Fill from link</button> : null}
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

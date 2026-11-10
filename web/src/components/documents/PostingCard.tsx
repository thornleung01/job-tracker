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
}

/**
 * The job posting's text for one application: paste it (or fill it from the application's link) and save. Shared by the detail page's closed
 * "Job posting" box and the Tailor workspace, so both read and write the same field (`postingText`).
 */
export function PostingCard({ db, app, act, enrich }: Props) {
  const saved = app.postingText ?? "";
  const [text, setText] = useState<string | null>(null);   // the text box, while it is open
  const editing = text !== null || !saved;
  const value = text ?? "";
  const id = `posting-${app.id}`;
  // Save and Cancel take the form away: focus goes to the Edit button that replaces it, once it is on the page.
  const editButton = useRef<HTMLButtonElement>(null);
  const focusEdit = useRef(false);
  useEffect(() => {
    if (!editing && focusEdit.current) {
      focusEdit.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

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
      focusEdit.current = true;
      setText(null);
      return value.trim() ? "Saved." : "Job posting removed.";
    });
  };

  return editing ? (
    <form className="doc-posting-form" onSubmit={save}>
      <label className="field small" htmlFor={id}>{saved ? "Job posting" : "Paste the job posting"}</label>
      <textarea id={id} rows={10} autoFocus={saved !== ""} maxLength={MAX_POSTING_CHARS} value={text ?? saved} onChange={(e) => setText(e.target.value)} />
      {(text ?? saved).length >= MAX_POSTING_CHARS * NEAR_LIMIT ? (
        <p className="small muted doc-note">{(text ?? saved).length.toLocaleString("en-CA")} of {MAX_POSTING_CHARS.toLocaleString("en-CA")} characters</p>
      ) : null}
      <div className="row">
        <button type="submit" className="primary" disabled={act.busy !== null || (text ?? saved) === saved} {...(act.busy === "posting" ? { "aria-busy": true as const } : {})}>Save</button>
        {app.postingUrl ? <button type="button" onClick={fill} {...act.button("posting-fill")}>Fill from link</button> : null}
        {saved ? <button type="button" onClick={() => { focusEdit.current = true; setText(null); }} disabled={act.busy !== null}>Cancel</button> : null}
      </div>
    </form>
  ) : (
    <>
      <p className="doc-posting-text">{saved}</p>
      <div className="row"><button type="button" ref={editButton} onClick={() => setText(saved)}>Edit</button></div>
    </>
  );
}

import { useEffect, useRef } from "react";
import type { ApplicationRow, JobTrackerDB } from "../../db/schema";
import type { ActionRunner } from "../useAction";
import type { DocumentsDeps } from "./deps";
import { PostingCard } from "./PostingCard";

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

/** The text of the job posting, kept in case the page comes down. Closed by default. The card inside is the same one the Tailor workspace shows. */
export function JobPosting({ db, app, act, enrich, openRequest = 0, hint }: Props) {
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!openRequest || !box.current) return;
    box.current.open = true;
    box.current.querySelector("textarea")?.focus();
  }, [openRequest]);

  return (
    <details className="more doc-posting" ref={box}>
      <summary>Job posting</summary>
      {hint ? <p className="small muted doc-note">{hint}</p> : null}
      <PostingCard db={db} app={app} act={act} enrich={enrich} />
    </details>
  );
}

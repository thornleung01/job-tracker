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
}

/** The text of the job posting, kept in case the page comes down. Closed by default. The card inside is the same one the Tailor workspace shows. */
export function JobPosting({ db, app, act, enrich }: Props) {
  return (
    <details className="more doc-posting">
      <summary>Job posting</summary>
      <PostingCard db={db} app={app} act={act} enrich={enrich} />
    </details>
  );
}

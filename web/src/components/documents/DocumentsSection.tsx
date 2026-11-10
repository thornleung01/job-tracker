import { useState } from "react";
import { useQuery } from "../../app/useQuery";
import type { ApplicationRow, JobTrackerDB } from "../../db/schema";
import type { Contact } from "../../sync/contacts";
import { getCoverLetter, resumesForApplication } from "../../sync/documents";
import type { ActionRunner } from "../useAction";
import { CoverLetter } from "./CoverLetter";
import { realDocumentsDeps, type DocumentsDeps } from "./deps";
import { JobPosting } from "./JobPosting";
import { ResumeSent } from "./ResumeSent";
import { Tailor } from "./Tailor";
import "./documents.css";

interface Props {
  db: JobTrackerDB;
  app: ApplicationRow;
  /** this application's people, for the cover letter's greeting */
  people: readonly Contact[];
  /** the page's action runner, so a failure shows in the page's notice and every button waits for the one in flight */
  act: ActionRunner;
  /** what reaches outside the database (the AI, the job boards); tests pass fakes */
  deps?: Partial<DocumentsDeps>;
}

const NEEDS_POSTING = "Tailoring reads the job posting. Paste it here first, then choose Tailor again.";

/** The detail page's Documents: the resume sent, the cover letter and the job posting, and tailoring both to this job. */
export function DocumentsSection({ db, app, people, act, deps }: Props) {
  const all: DocumentsDeps = { ...realDocumentsDeps, ...deps };
  const docs = useQuery(async () => ({ resumes: await resumesForApplication(db, app.id), cover: await getCoverLetter(db, app.id) }), [db, app.id]);
  const [tailoring, setTailoring] = useState(false);
  const [openPosting, setOpenPosting] = useState(0);
  const [hint, setHint] = useState("");
  const [saved, setSaved] = useState("");
  const master = docs?.resumes.find((r) => r.master);

  const tailor = () => {
    setSaved("");
    if (!app.postingText?.trim()) {
      setHint(NEEDS_POSTING);
      setOpenPosting((n) => n + 1);
      return;
    }
    setHint("");
    setTailoring(true);
  };

  return (
    <section className="detail-section documents" aria-labelledby="h-documents">
      <h2 id="h-documents" className="section">Documents</h2>
      {docs ? (
        <>
          <ResumeSent db={db} app={app} resumes={docs.resumes} act={act} />
          {master && !tailoring ? (
            <div className="row doc-tailor">
              <button type="button" onClick={tailor} disabled={act.busy !== null}>Tailor resume and write cover letter</button>
            </div>
          ) : null}
          {saved ? <p className="small muted doc-note" role="status">{saved}</p> : null}
          {master && tailoring ? (
            <Tailor
              db={db} app={app} master={master} deps={all}
              onSaved={(message) => { setTailoring(false); setSaved(message); }}
              onCancel={() => setTailoring(false)}
            />
          ) : null}
          <CoverLetter db={db} app={app} cover={docs.cover} people={people} act={act} />
          <JobPosting db={db} app={app} act={act} enrich={all.enrichJobDraft} openRequest={openPosting} hint={app.postingText ? "" : hint} />
        </>
      ) : null}
    </section>
  );
}

import { useQuery } from "../../app/useQuery";
import type { ApplicationRow, JobTrackerDB } from "../../db/schema";
import type { Contact } from "../../sync/contacts";
import { getCoverLetter, resumesForApplication } from "../../sync/documents";
import type { ActionRunner } from "../useAction";
import { CoverLetter } from "./CoverLetter";
import { realDocumentsDeps, type DocumentsDeps } from "./deps";
import { JobPosting } from "./JobPosting";
import { ResumeSent } from "./ResumeSent";
import "./documents.css";

interface Props {
  db: JobTrackerDB;
  app: ApplicationRow;
  /** this application's people, for the cover letter's greeting */
  people: readonly Contact[];
  /** the page's action runner, so a failure shows in the page's notice and every button waits for the one in flight */
  act: ActionRunner;
  /** what reaches outside the database (the job boards); tests pass fakes */
  deps?: Partial<DocumentsDeps>;
}

/** The detail page's Documents: the resume sent, the cover letter and the job posting. Tailoring both to this job happens in the Tailor workspace. */
export function DocumentsSection({ db, app, people, act, deps }: Props) {
  const all: DocumentsDeps = { ...realDocumentsDeps, ...deps };
  const docs = useQuery(async () => ({ resumes: await resumesForApplication(db, app.id), cover: await getCoverLetter(db, app.id) }), [db, app.id]);
  const master = docs?.resumes.find((r) => r.master);

  return (
    <section className="detail-section documents" aria-labelledby="h-documents">
      <h2 id="h-documents" className="section">Documents</h2>
      {docs ? (
        <>
          <ResumeSent db={db} app={app} resumes={docs.resumes} act={act} />
          {master ? (
            <div className="row doc-tailor">
              <a className="btn" href={`#/tailor/${app.id}`}>Tailor resume and cover letter</a>
            </div>
          ) : null}
          <CoverLetter db={db} app={app} cover={docs.cover} people={people} act={act} />
          <JobPosting db={db} app={app} act={act} enrich={all.enrichJobDraft} />
        </>
      ) : null}
    </section>
  );
}

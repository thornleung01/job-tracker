import { useQuery } from "../../app/useQuery";
import type { ApplicationRow, JobTrackerDB } from "../../db/schema";
import type { Contact } from "../../sync/contacts";
import { getCoverLetter, liveResumes } from "../../sync/documents";
import type { ActionRunner } from "../useAction";
import { CoverLetter } from "./CoverLetter";
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
}

/** The detail page's Documents: the resume sent, the cover letter and the job posting. */
export function DocumentsSection({ db, app, people, act }: Props) {
  const docs = useQuery(async () => ({ resumes: await liveResumes(db), cover: await getCoverLetter(db, app.id) }), [db, app.id]);
  return (
    <section className="detail-section documents" aria-labelledby="h-documents">
      <h2 id="h-documents" className="section">Documents</h2>
      {docs ? (
        <>
          <ResumeSent db={db} app={app} resumes={docs.resumes} act={act} />
          <CoverLetter db={db} app={app} cover={docs.cover} people={people} act={act} />
          <JobPosting db={db} app={app} act={act} />
        </>
      ) : null}
    </section>
  );
}

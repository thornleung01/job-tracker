import { useMemo, useState } from "react";
import type { AiDeps } from "../../ai";
import type { PageProps } from "../../app/pageProps";
import { useQuery } from "../../app/useQuery";
import { Notice } from "../../components/Notice";
import { useNoticeFocus } from "../../components/useNoticeFocus";
import { liveDocuments, liveResumes } from "../../sync/documents";
import { liveApplications } from "../../sync/live";
import { tailoredPage } from "../../sync/queries";
import { CoverLetters } from "./CoverLetters";
import { PrintView } from "./PrintView";
import type { ConvertFn } from "./ConvertPanel";
import { ResumeTab } from "./ResumeTab";
import { TailoredList } from "./TailoredList";
import "./resume.css";

export type ResumeView = "resumes" | "cover" | "tailored";

/** The AI key and the conversion, which tests replace with fakes (the real ones are the default). */
export type ResumeDeps = Partial<{ ai: AiDeps; convert: ConvertFn }>;

/** #/resume shows the page, and #/resume/print/<id> shows one document ready to print. */
export default function ResumePage(props: PageProps & { deps?: ResumeDeps }) {
  return props.params.id !== undefined ? <PrintView db={props.db} id={props.params.id} /> : <ResumeHome {...props} />;
}

function ResumeHome({ db, query, deps }: PageProps & { deps?: ResumeDeps }) {
  const tab = query.get("tab");
  const view: ResumeView = tab === "cover" ? "cover" : tab === "tailored" ? "tailored" : "resumes";
  const data = useQuery(async () => ({
    docs: await liveDocuments(db), resumes: await liveResumes(db), tailored: await tailoredPage(db), apps: await liveApplications(db),
  }), [db]);
  const [notice, setNotice] = useState<string | null>(null);
  const result = useNoticeFocus();
  const say = (message: string, removed?: boolean) => {
    setNotice(message);
    if (removed) result.focus();   // the Delete button is gone with the card
  };
  const usage = useMemo(() => {
    const counts = new Map<number, number>();
    for (const a of data?.apps ?? []) if (a.resumeId !== undefined) counts.set(a.resumeId, (counts.get(a.resumeId) ?? 0) + 1);
    return counts;
  }, [data]);
  const apps = useMemo(() => new Map((data?.apps ?? []).map((a) => [a.id, a])), [data]);

  return (
    <>
      <h1 className="page">Resume</h1>
      <nav className="tabs" aria-label="Show">
        <a href="#/resume" className="tab" aria-current={view === "resumes" ? "true" : undefined}>Resumes</a>
        <a href="#/resume?tab=cover" className="tab" aria-current={view === "cover" ? "true" : undefined}>Cover letters</a>
        <a href="#/resume?tab=tailored" className="tab" aria-current={view === "tailored" ? "true" : undefined}>Tailored</a>
      </nav>
      <div ref={result.box}>{notice ? <Notice>{notice}</Notice> : null}</div>
      {data ? (
        <>
          {/* All three lists stay in the page, so what you typed and haven't saved is still there when you come back to it. */}
          <div className="resume-view" hidden={view !== "resumes"}>
            <ResumeTab db={db} resumes={data.resumes} usage={usage} say={say} deps={deps} />
          </div>
          <div className="resume-view" hidden={view !== "cover"}>
            <CoverLetters letters={data.docs.filter((d) => d.kind === "cover")} apps={apps} />
          </div>
          <div className="resume-view" hidden={view !== "tailored"}>
            <TailoredList db={db} items={data.tailored} say={say} />
          </div>
        </>
      ) : null}
    </>
  );
}

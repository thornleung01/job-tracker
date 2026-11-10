import { useEffect, useMemo, useRef, useState } from "react";
import type { AiDeps } from "../../ai";
import type { PageProps } from "../../app/pageProps";
import { useQuery } from "../../app/useQuery";
import { InlineConfirm } from "../../components/InlineConfirm";
import { Notice } from "../../components/Notice";
import { useAction } from "../../components/useAction";
import { useNoticeFocus } from "../../components/useNoticeFocus";
import { convertResume } from "../../sync/convert";
import { liveDocuments, liveResumes } from "../../sync/documents";
import { liveApplications } from "../../sync/live";
import { tailoredPage } from "../../sync/queries";
import { CoverLetters } from "./CoverLetters";
import { clearFlow, useFlow } from "./flowState";
import { PrintView } from "./PrintView";
import type { ConvertFn } from "./ConvertPanel";
import { ResumeTab } from "./ResumeTab";
import { realStepsDeps, type StepsDeps } from "./steps/deps";
import { Steps } from "./steps/Steps";
import { TailoredList } from "./TailoredList";
import { useLeaveWhenUnsaved } from "./unsaved";
import "./resume.css";

export type ResumeView = "resumes" | "cover" | "tailored";

/** The AI key, the conversion and what the steps reach out for, which tests replace with fakes (the real ones are the default). */
export type ResumeDeps = Partial<{ ai: AiDeps; convert: ConvertFn } & StepsDeps>;

/** #/resume shows the page, and #/resume/print/<id> shows one document ready to print. */
export default function ResumePage(props: PageProps & { deps?: ResumeDeps }) {
  return props.params.id !== undefined ? <PrintView db={props.db} id={props.params.id} /> : <ResumeHome {...props} />;
}

/** The four steps, then Your documents: the master and versions, the cover letters and the tailored resumes. */
function ResumeHome({ db, query, navigate, deps }: PageProps & { deps?: ResumeDeps }) {
  const tab = query.get("tab");
  const view: ResumeView = tab === "cover" ? "cover" : tab === "tailored" ? "tailored" : "resumes";
  const data = useQuery(async () => ({
    docs: await liveDocuments(db), resumes: await liveResumes(db), tailored: await tailoredPage(db), apps: await liveApplications(db),
  }), [db]);
  const all = useMemo(() => ({ ...realStepsDeps, convert: convertResume, ...deps }), [deps]);
  const [flow, dispatch] = useFlow(db.name);
  const guard = useLeaveWhenUnsaved(navigate, () => {
    if (!flow.draft) return;
    clearFlow(db.name);
    dispatch({ type: "reset" });
  });
  const leaveAct = useAction();
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

  // Change on Your resume: the Resumes tab, then the master's heading, once it is shown.
  const toMaster = useRef(false);
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!toMaster.current || view !== "resumes") return;
    const heading = document.getElementById("resume-master-h");
    if (!heading) return;
    toMaster.current = false;
    heading.scrollIntoView?.({ block: "start" });
    heading.focus({ preventScroll: true });
  });
  const showMaster = () => {
    toMaster.current = true;
    if (view !== "resumes") navigate("/resume");
    else rerender((n) => n + 1);   // render once more so the effect runs
  };

  return (
    <>
      <h1 className="page">Resume</h1>
      {guard.leaving ? (
        <InlineConfirm title="Leave without saving?" help="Text you typed on this page hasn't been saved." confirmLabel="Discard changes" act={leaveAct} actionKey="leave"
                       onConfirm={guard.discard} onCancel={guard.stay} />
      ) : null}
      {data ? (
        <Steps db={db} resumes={data.resumes} flow={flow} dispatch={dispatch} deps={all} report={guard.report} onShowMaster={showMaster} query={query} navigate={navigate} />
      ) : null}
      <h2 className="docs-h">Your documents</h2>
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
            <ResumeTab db={db} resumes={data.resumes} usage={usage} say={say} report={guard.report} deps={all} />
          </div>
          <div className="resume-view" hidden={view !== "cover"}>
            <CoverLetters letters={data.docs.filter((d) => d.kind === "cover")} apps={apps} />
          </div>
          <div className="resume-view" hidden={view !== "tailored"}>
            <TailoredList db={db} items={data.tailored} baselines={data.resumes} say={say} />
          </div>
        </>
      ) : null}
    </>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { plural } from "../../sync/text";
import { CoverLetters } from "./CoverLetters";
import { readDocsOpen, rememberDocsOpen } from "./docsOpen";
import { clearFlow, useFlow } from "./flowState";
import { PrintView } from "./PrintView";
import type { ConvertFn } from "./ConvertPanel";
import { ResumeTab } from "./ResumeTab";
import { realSectionDeps, type SectionDeps } from "./sections/deps";
import { Sections } from "./sections/Sections";
import { TailoredList } from "./TailoredList";
import { useLeaveWhenUnsaved, type ReportUnsaved } from "./unsaved";
import "./resume.css";

export type ResumeView = "resumes" | "cover" | "tailored";

/** The AI key, the conversion and what the sections reach out for, which tests replace with fakes (the real ones are the default). */
export type ResumeDeps = Partial<{ ai: AiDeps; convert: ConvertFn } & SectionDeps>;

/** #/resume shows the page, and #/resume/print/<id> shows one document ready to print. */
export default function ResumePage(props: PageProps & { deps?: ResumeDeps }) {
  // Coming back from the Print view, Your documents is open: that is where Print is.
  const printing = props.params.id !== undefined;
  useEffect(() => {
    if (printing) rememberDocsOpen(props.db.name, true);
  }, [printing, props.db.name]);
  return props.params.id !== undefined ? <PrintView db={props.db} id={props.params.id} /> : <ResumeHome {...props} />;
}

/** Job (with the master as one line in its card), the tailored split, then Your documents, closed: the master and versions, the cover letters and the tailored resumes. */
function ResumeHome({ db, query, navigate, deps }: PageProps & { deps?: ResumeDeps }) {
  const tab = query.get("tab");
  const view: ResumeView = tab === "cover" ? "cover" : tab === "tailored" ? "tailored" : "resumes";
  const data = useQuery(async () => ({
    docs: await liveDocuments(db), resumes: await liveResumes(db), tailored: await tailoredPage(db), apps: await liveApplications(db),
  }), [db]);
  const all = useMemo(() => ({ ...realSectionDeps, convert: convertResume, ...deps }), [deps]);
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

  // Your documents starts closed and opens for anything that points into it: the Cover letters and Tailored tab links (each time one is followed,
  // so a closed one opens again), Edit on the master line, the Print view's Back link and the leave question while text typed in it isn't saved.
  // A tab link also scrolls to it and moves focus to its summary. A ?baseline= link is about Job, so it leaves Your documents alone.
  const [docsOpen, setDocsOpen] = useState(() => view !== "resumes" || readDocsOpen(db.name));
  const openDocs = (open: boolean) => {
    setDocsOpen(open);
    rememberDocsOpen(db.name, open);
  };
  const toDocs = useRef(false);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => {
    if (view === "resumes") return;
    toDocs.current = true;
    openDocs(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `query` is a new object for every move to an address, so the same link followed again opens it again
  }, [view, query]);
  useEffect(() => {
    if (!toDocs.current || !docsOpen || !data) return;
    toDocs.current = false;
    summary.current?.scrollIntoView?.({ block: "start" });
    summary.current?.focus({ preventScroll: true });
  });

  // Typed text in Your documents that isn't saved: the summary says so while it is closed, and the leave question opens it to show where.
  const docsUnsaved = useRef(new Set<string>());
  const [docsDirty, setDocsDirty] = useState(false);
  const docsReport = useCallback<ReportUnsaved>((key, on) => {
    if (on) docsUnsaved.current.add(key);
    else docsUnsaved.current.delete(key);
    setDocsDirty(docsUnsaved.current.size > 0);
    guard.report(`docs:${key}`, on);
  }, [guard.report]);   // eslint-disable-line react-hooks/exhaustive-deps -- guard.report is stable
  useEffect(() => {
    if (guard.leaving && docsDirty && !docsOpen) openDocs(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the question appearing opens it
  }, [guard.leaving]);

  // Edit on the master line: the Resumes tab, then the master's heading, once it is shown.
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
    openDocs(true);
    if (view !== "resumes") navigate("/resume");
    else rerender((n) => n + 1);   // render once more so the effect runs
  };

  const master = data?.resumes.find((d) => d.master);
  const versions = (data?.resumes.length ?? 0) - (master ? 1 : 0);
  const kept = [master ? "master" : "", versions ? plural(versions, "version") : ""].filter(Boolean).join(", ");

  return (
    <div className="rs-page">
      <h1 className="page">Resume</h1>
      {guard.leaving ? (
        <InlineConfirm title="Leave without saving?" help="Text you typed on this page hasn't been saved." confirmLabel="Discard changes" act={leaveAct} actionKey="leave"
                       onConfirm={guard.discard} onCancel={guard.stay} />
      ) : null}
      {data ? (
        <Sections db={db} resumes={data.resumes} flow={flow} dispatch={dispatch} deps={all} report={guard.report} onShowMaster={showMaster} query={query} navigate={navigate} />
      ) : null}
      <details className="rs-docs" open={docsOpen} onToggle={(e) => { if (e.currentTarget.open !== docsOpen) openDocs(e.currentTarget.open); }}>
        <summary className="disclosure" ref={summary}>
          <span className="chev" aria-hidden="true"></span>
          <h2 className="rs-docs-h">Your documents{kept ? ` · ${kept}` : ""}</h2>
          {docsDirty ? <span className="rs-docs-unsaved small">Unsaved changes</span> : null}
        </summary>
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
              <ResumeTab db={db} resumes={data.resumes} usage={usage} say={say} report={docsReport} deps={all} />
            </div>
            <div className="resume-view" hidden={view !== "cover"}>
              <CoverLetters letters={data.docs.filter((d) => d.kind === "cover")} apps={apps} />
            </div>
            <div className="resume-view" hidden={view !== "tailored"}>
              <TailoredList db={db} items={data.tailored} baselines={data.resumes} say={say} />
            </div>
          </>
        ) : null}
      </details>
    </div>
  );
}

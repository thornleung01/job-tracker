// The Resume page's three sections, top to bottom: Resume, Job, and (once there is a draft) Tailored resume | Tailored cover letter. There are no
// steps to move through: what shows is derived from what exists (flowState.deriveStep). The work in progress is the flow, which the page holds so a
// reload and the leave guard both see it.
import { useEffect, useRef, type Dispatch } from "react";
import type { WriteOptions } from "../../../components/documents/TailorAi";
import { composeResume, initialTicks } from "../../../components/documents/tailorReview";
import type { DocumentRow, JobTrackerDB } from "../../../db/schema";
import { derive } from "../../../sync/contacts";
import { baselineChoices } from "../../../sync/documents";
import type { ConvertFn } from "../ConvertPanel";
import { deriveStep, type FlowAction, type FlowState } from "../flowState";
import { FLOW_KEY, useReportUnsaved, type ReportUnsaved } from "../unsaved";
import type { SectionDeps } from "./deps";
import { JobSection } from "./JobSection";
import { ResumeSection } from "./ResumeSection";
import { TailoredSplit } from "./TailoredSplit";
import "../split.css";

interface Props {
  db: JobTrackerDB;
  /** the live master and versions */
  resumes: readonly DocumentRow[];
  flow: FlowState;
  dispatch: Dispatch<FlowAction>;
  deps: SectionDeps & { convert: ConvertFn };
  report: ReportUnsaved;
  /** Edit on Resume: the master's editor under Your documents */
  onShowMaster(): void;
  /** the page's address: `?step=job` scrolls to Job, `?app=<id>` fills it from that application, `?baseline=<id>` picks the resume to tailor from */
  query: URLSearchParams;
  navigate(to: string, opts?: { replace?: boolean }): void;
}

const scrollTo = (id: string) => {
  const el = document.getElementById(id);
  el?.scrollIntoView?.({ block: "start" });
  el?.focus({ preventScroll: true });
};

export function Sections({ db, resumes, flow, dispatch, deps, report, onShowMaster, query, navigate }: Props) {
  const baselines = baselineChoices(resumes);
  const master = baselines.find((r) => r.master);
  const step = deriveStep(flow, master !== undefined);
  const pick = (id: number | null | undefined) => (id == null ? undefined : baselines.find((r) => r.id === id));
  // The draft keeps the baseline it was written from; before a draft it is the one chosen (the master unless a version was). When that
  // resume has been deleted since, the master stands in for the split and for Save alike, and the page says so.
  const baselineGone = flow.draft !== null && pick(flow.draft.baselineId) === undefined;
  const baseline = baselineGone ? master : pick(flow.draft?.baselineId) ?? pick(flow.baselineId) ?? master;
  useReportUnsaved(report, FLOW_KEY, flow.draft !== null && (flow.saved === null || flow.dirty));

  // After the first master is saved, focus goes to Job (the master's row arrives a moment after its save).
  const focusJob = useRef(false);
  useEffect(() => {
    if (!focusJob.current || step === "resume") return;
    focusJob.current = false;
    scrollTo("rs-job-h");
  });

  // A link here (the Add notice's "Tailor your resume for this job", a "Tailor for a job" button) is handled once, then taken off the address
  // so a reload isn't sent back to it.
  const stepParam = query.get("step");
  const appParam = query.get("app");
  const tabParam = query.get("tab");
  const baselineParam = query.get("baseline");
  useEffect(() => {
    if (stepParam === null && appParam === null && baselineParam === null) return;
    let live = true;
    void (async () => {
      const id = Number(appParam);
      const app = appParam !== null && Number.isSafeInteger(id) && id > 0 ? await db.applications.get(id) : undefined;
      if (!live) return;
      // `baseline=<id>` (Tailor with this) picks that resume as the one to tailor from; anything that isn't a live resume is ignored.
      const chosen = baselineParam !== null && /^\d+$/.test(baselineParam) ? baselines.find((r) => r.id === Number(baselineParam)) : undefined;
      if (chosen && !flow.draft) dispatch({ type: "baseline", id: chosen.master ? null : chosen.id });
      if (app && !app.deletedAt) {
        dispatch({ type: "prefill", appId: app.id, company: app.company, role: app.role, posting: app.postingText ?? "", url: app.postingUrl ?? "" });
        focusJob.current = true;
      } else if (stepParam === "job" || chosen) focusJob.current = true;
      navigate(tabParam ? `/resume?tab=${encodeURIComponent(tabParam)}` : "/resume", { replace: true });
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new link starts this
  }, [db, stepParam, appParam, baselineParam]);

  // The two ways to a draft, shared by Job and Rewrite with AI.
  const write = async ({ tone, note, signal }: WriteOptions) => {
    if (!baseline) return;
    const people = flow.fromApp !== null ? await derive(db, flow.fromApp) : undefined;
    const draft = await deps.tailorForJob(
      db, { company: flow.company.trim(), role: flow.role.trim(), posting: flow.posting, baselineId: baseline.id, ...(people?.length ? { people } : {}) },
      { ai: deps.ai }, { tone, note, signal, baselineId: baseline.id },
    );
    if (signal.aborted) return;
    const ticks = initialTicks(draft.lines);
    dispatch({ type: "drafted", draft, resume: composeResume(draft, baseline.sections, ticks), ticks, byHand: false });
  };
  const byHand = async () => {
    if (!baseline) return;
    const draft = await deps.draftFromBaseline(db, baseline.id, flow.company.trim());
    dispatch({ type: "drafted", draft, resume: draft.resume, ticks: {}, byHand: true });
  };

  const startOver = () => {
    dispatch({ type: "reset" });
    focusJob.current = true;
  };

  return (
    <div className="rs">
      <ResumeSection
        db={db} ai={deps.ai} convert={deps.convert} report={report} master={master} baselines={baselines} baseline={baseline} locked={flow.draft !== null}
        onBaseline={(id) => dispatch({ type: "baseline", id })} onEdit={onShowMaster} onSaved={() => { focusJob.current = true; }}
      />
      <JobSection db={db} flow={flow} dispatch={dispatch} deps={deps} baseline={baseline} write={write} byHand={byHand} />
      {baselineGone && master && flow.draft ? (
        <p className="muted small rs-gone" role="status">The resume this draft was based on was deleted, so your master resume is used instead.</p>
      ) : null}
      {(step === "split" || step === "saved") && baseline && flow.draft && flow.resume ? (
        <div className="rs-wide">
          <TailoredSplit db={db} flow={{ ...flow, draft: flow.draft, resume: flow.resume }} dispatch={dispatch} deps={deps} baseline={baseline} write={write} onStartOver={startOver} />
        </div>
      ) : null}
    </div>
  );
}

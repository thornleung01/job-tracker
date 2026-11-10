// The Resume page's four steps: 1 Your resume, 2 The job, 3 Review, 4 Add to applications. Only the open step shows its body; a finished one is
// one line with Change. The work in progress is the flow (flowState.ts), which the page holds so a reload and the leave guard both see it.
import { Check } from "lucide-react";
import { useEffect, useRef, useState, type Dispatch, type ReactNode } from "react";
import type { WriteOptions } from "../../../components/documents/TailorAi";
import { composeResume, initialTicks } from "../../../components/documents/tailorReview";
import { InlineConfirm } from "../../../components/InlineConfirm";
import { useAction } from "../../../components/useAction";
import type { DocumentRow, JobTrackerDB } from "../../../db/schema";
import { derive } from "../../../sync/contacts";
import { baselineChoices } from "../../../sync/documents";
import type { ConvertFn } from "../ConvertPanel";
import { hasWork, type FlowAction, type FlowState } from "../flowState";
import { useReportUnsaved, type ReportUnsaved } from "../unsaved";
import type { StepsDeps } from "./deps";
import { StepAdd, StepDone } from "./StepAdd";
import { StepJob } from "./StepJob";
import { StepResumeDone, StepResumeOpen } from "./StepResume";
import { StepReview } from "./StepReview";
import { STEP_NAMES, STEP_ORDER, StepStrip, type StepId, type StepState } from "./StepStrip";
import "../steps.css";

interface Props {
  db: JobTrackerDB;
  /** the live master and versions */
  resumes: readonly DocumentRow[];
  flow: FlowState;
  dispatch: Dispatch<FlowAction>;
  deps: StepsDeps & { convert: ConvertFn };
  report: ReportUnsaved;
  /** Change on Your resume: the master's editor under Your documents */
  onShowMaster(): void;
  /** the page's address: `?step=job` opens The job, `?app=<id>` opens it filled in from that application */
  query: URLSearchParams;
  navigate(to: string, opts?: { replace?: boolean }): void;
}

type Open = StepId | "done";

export function Steps({ db, resumes, flow, dispatch, deps, report, onShowMaster, query, navigate }: Props) {
  const baselines = baselineChoices(resumes);
  const master = baselines.find((r) => r.master);
  const open: Open = !master ? "resume" : flow.step;
  const pick = (id: number | null | undefined) => (id == null ? undefined : baselines.find((r) => r.id === id));
  // The draft keeps the baseline it was written from; before a draft it is the one chosen (the master unless a version was).
  const baseline = pick(flow.draft?.baselineId) ?? pick(flow.baselineId) ?? master;
  useReportUnsaved(report, "flow", flow.draft !== null && flow.step !== "done");

  // On a move between steps the new step's heading takes focus, once it is on the page (a new master arrives a moment after its save).
  const focusStep = useRef<Open | null>(null);
  useEffect(() => {
    if (!focusStep.current || focusStep.current !== open) return;
    focusStep.current = null;
    document.getElementById(`steps-h-${open}`)?.focus();
  });
  const go = (a: FlowAction, to: Open) => {
    focusStep.current = to;
    dispatch(a);
  };

  // A link here (the Add notice's "Tailor your resume for this job", a "Tailor for a job" button) is handled once, then taken off the address
  // so a reload or a later step isn't sent back to it.
  const stepParam = query.get("step");
  const appParam = query.get("app");
  const tabParam = query.get("tab");
  useEffect(() => {
    if (stepParam === null && appParam === null) return;
    let live = true;
    void (async () => {
      const id = Number(appParam);
      const app = appParam !== null && Number.isSafeInteger(id) && id > 0 ? await db.applications.get(id) : undefined;
      if (!live) return;
      if (app && !app.deletedAt) {
        go({ type: "prefill", appId: app.id, company: app.company, role: app.role, posting: app.postingText ?? "", url: app.postingUrl ?? "" }, "job");
      } else if (stepParam === "job") go({ type: "go", step: "job" }, "job");
      navigate(tabParam ? `/resume?tab=${encodeURIComponent(tabParam)}` : "/resume", { replace: true });
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new link starts this
  }, [db, stepParam, appParam]);

  const startAct = useAction();
  const [restarting, setRestarting] = useState(false);
  const startOver = () => {
    setRestarting(false);
    go({ type: "reset" }, "job");
  };

  // The two ways to a draft, shared by The job and Try again on Review.
  const write = async ({ tone, note, signal }: WriteOptions) => {
    if (!baseline) return;
    const people = flow.fromApp !== null ? await derive(db, flow.fromApp) : undefined;
    const draft = await deps.tailorForJob(
      db, { company: flow.company.trim(), role: flow.role.trim(), posting: flow.posting, baselineId: baseline.id, ...(people?.length ? { people } : {}) },
      { ai: deps.ai }, { tone, note, signal, baselineId: baseline.id },
    );
    if (signal.aborted) return;
    const ticks = initialTicks(draft.lines);
    go({ type: "drafted", draft, resume: composeResume(draft, baseline.sections, ticks), ticks, byHand: false }, "review");
  };
  const byHand = async () => {
    if (!baseline) return;
    const draft = await deps.draftFromBaseline(db, baseline.id, flow.company.trim());
    go({ type: "drafted", draft, resume: draft.resume, ticks: {}, byHand: true }, "review");
  };

  const states = Object.fromEntries(STEP_ORDER.map((id, i) => {
    const at = open === "done" ? STEP_ORDER.length : STEP_ORDER.indexOf(open);
    const state: StepState = i < at ? "done" : i === at ? "current" : "waiting";
    return [id, state];
  })) as Record<StepId, StepState>;
  const jobName = [flow.company.trim(), flow.role.trim()].filter(Boolean).join(", ");
  const letterKept = Boolean(flow.letter?.text.trim());

  const doneRows: { id: StepId; body: ReactNode; change(): void }[] = [];
  if (master && baseline && open !== "done") {
    doneRows.push({
      id: "resume", change: onShowMaster,
      body: <StepResumeDone master={master} baselines={baselines} baseline={baseline} locked={flow.draft !== null} onBaseline={(id) => dispatch({ type: "baseline", id })} />,
    });
    if (open === "review" || open === "add") doneRows.push({ id: "job", change: () => go({ type: "go", step: "job" }, "job"), body: <span className="steps-done-sum muted small">{jobName}</span> });
    if (open === "add") doneRows.push({ id: "review", change: () => go({ type: "go", step: "review" }, "review"), body: <span className="steps-done-sum muted small">{letterKept ? "Resume and cover letter" : "Resume"}</span> });
  }

  const heading = (id: Open, text: string) => (
    <h2 className="steps-h" id={`steps-h-${id}`} tabIndex={-1}>
      {id !== "done" ? <span className="steps-n" aria-hidden="true">{STEP_ORDER.indexOf(id) + 1}</span> : null}
      {text}
    </h2>
  );

  let body: ReactNode = null;
  if (open === "resume") {
    body = (
      <section className="steps-open" aria-labelledby="steps-h-resume">
        {heading("resume", STEP_NAMES.resume)}
        <StepResumeOpen db={db} ai={deps.ai} convert={deps.convert} report={report} onSaved={() => { focusStep.current = "job"; }} />
      </section>
    );
  } else if (open === "job" && baseline) {
    body = (
      <section className="steps-open" aria-labelledby="steps-h-job">
        {heading("job", STEP_NAMES.job)}
        <div className="card steps-card">
          <StepJob db={db} flow={flow} dispatch={dispatch} deps={deps} baseline={baseline} write={write} byHand={byHand}
                   onBackToReview={() => go({ type: "go", step: "review" }, "review")} />
        </div>
      </section>
    );
  } else if ((open === "review" || open === "add") && baseline && flow.draft && flow.resume) {
    const ready = { ...flow, draft: flow.draft, resume: flow.resume };
    body = (
      <section className="steps-open" aria-labelledby={`steps-h-${open}`}>
        {heading(open, STEP_NAMES[open])}
        <div className="card steps-card">
          {open === "review" ? (
            <StepReview db={db} flow={ready} dispatch={dispatch} deps={deps} baseline={baseline} write={write} byHand={byHand}
                        onNext={() => go({ type: "go", step: "add" }, "add")} onBack={() => go({ type: "go", step: "job" }, "job")} />
          ) : (
            <StepAdd db={db} flow={ready} dispatch={dispatch} deps={deps}
                     onSaved={(saved) => go({ type: "saved", saved }, "done")} onBack={() => go({ type: "go", step: "review" }, "review")} />
          )}
        </div>
      </section>
    );
  } else if (open === "done" && flow.saved) {
    body = (
      <section className="steps-open" aria-labelledby="steps-h-done">
        {heading("done", `Saved to ${flow.saved.company}`)}
        <div className="card steps-card">
          <StepDone db={db} saved={flow.saved} onAnother={() => go({ type: "reset" }, "job")} />
        </div>
      </section>
    );
  }

  return (
    <section className="steps" aria-label="Tailor for a job">
      <div className="steps-top">
        <StepStrip states={states} />
        {master && hasWork(flow) ? (
          <button type="button" className="quiet steps-over" onClick={() => (flow.draft ? setRestarting(true) : startOver())} disabled={restarting}>Start over</button>
        ) : null}
      </div>
      {restarting ? (
        <InlineConfirm title="Start over?" help="The job and the draft will be cleared. Nothing has been saved." confirmLabel="Start over" act={startAct} actionKey="over"
                       onConfirm={startOver} onCancel={() => setRestarting(false)} />
      ) : null}
      {doneRows.length ? (
        <ul className="card steps-done" aria-label="Finished steps">
          {doneRows.map((r) => (
            <li key={r.id} className="steps-done-row">
              <span className="steps-done-name">
                <span className="steps-mark is-done" aria-hidden="true"><Check size={16} strokeWidth={3} /></span>
                {STEP_NAMES[r.id]}
              </span>
              {r.body}
              <button type="button" className="steps-change" onClick={r.change} aria-label={`Change ${STEP_NAMES[r.id].toLowerCase()}`}>Change</button>
            </li>
          ))}
        </ul>
      ) : null}
      {body}
    </section>
  );
}


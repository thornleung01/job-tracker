// Step 1, Your resume. Before there is a master it is the way in (the template, a file or pasted text, then the check); after, one line that
// names the master, with Change (the master's editor under Your documents) and which resume the job is tailored from.
import type { AiDeps } from "../../../ai";
import { dayText } from "../../../db/dayText";
import type { DocumentRow, JobTrackerDB } from "../../../db/schema";
import type { ConvertFn } from "../ConvertPanel";
import { MasterStart } from "../intake";
import type { ReportUnsaved } from "../unsaved";

export function StepResumeOpen({ db, ai, convert, report, onSaved }: { db: JobTrackerDB; ai: AiDeps; convert: ConvertFn; report: ReportUnsaved; onSaved(): void }) {
  return (
    <>
      <p className="muted small steps-lead">Your resume is the starting point for every job you tailor for.</p>
      <MasterStart db={db} ai={ai} convert={convert} report={report} onSaved={onSaved} />
    </>
  );
}

interface DoneProps {
  master: DocumentRow;
  /** the master, then the versions */
  baselines: readonly DocumentRow[];
  baseline: DocumentRow;
  /** a draft was written from the baseline, so it is shown, not chosen */
  locked: boolean;
  onBaseline(id: number | null): void;
}

/** The line under the strip once there is a master: what it is and when it changed, and the resume to tailor from. */
export function StepResumeDone({ master, baselines, baseline, locked, onBaseline }: DoneProps) {
  const summary = `${master.title} · updated ${dayText(master.updatedAt, "short")}`;
  const name = (r: DocumentRow) => (r.master ? "Master" : r.title);
  return (
    <>
      <span className="steps-done-sum muted small">{summary}{locked && !baseline.master ? ` · Based on: ${baseline.title}` : ""}</span>
      {!locked && baselines.length > 1 ? (
        <span className="fgroup steps-based">
          <label htmlFor="steps-baseline">Based on</label>
          <select id="steps-baseline" value={baseline.id} onChange={(e) => onBaseline(Number(e.target.value) === master.id ? null : Number(e.target.value))}>
            {baselines.map((r) => <option key={r.id} value={r.id}>{name(r)}</option>)}
          </select>
        </span>
      ) : null}
    </>
  );
}

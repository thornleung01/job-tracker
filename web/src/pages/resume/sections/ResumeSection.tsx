// The master resume on the Resume page, shown once. Before there is a master it is the page's first section and the way in (the template, a file or
// pasted text, then the check). After, it is not a section at all: MasterSummary is one line at the top of the Job card ("Using: Master resume ·
// updated Sep 26 · Based on [select] · Edit"), where Edit opens the master's editor under Your documents.
import type { AiDeps } from "../../../ai";
import { dayText } from "../../../db/dayText";
import type { DocumentRow, JobTrackerDB } from "../../../db/schema";
import type { ConvertFn } from "../ConvertPanel";
import { MasterStart } from "../intake";
import type { ReportUnsaved } from "../unsaved";

interface IntakeProps {
  db: JobTrackerDB;
  ai: AiDeps;
  convert: ConvertFn;
  report: ReportUnsaved;
  /** the first master was saved */
  onSaved(): void;
}

/** Resume, with no master yet: the first-run intake. */
export function ResumeSection({ db, ai, convert, report, onSaved }: IntakeProps) {
  return (
    <section className="rs-section" aria-labelledby="rs-resume-h">
      <h2 className="rs-h" id="rs-resume-h">Resume</h2>
      <MasterStart db={db} ai={ai} convert={convert} report={report} onSaved={onSaved} />
    </section>
  );
}

interface SummaryProps {
  master: DocumentRow;
  /** the master, then the versions */
  baselines: readonly DocumentRow[];
  /** the resume the job is tailored from */
  baseline: DocumentRow;
  /** a draft was written from the baseline, so it is shown, not chosen */
  locked: boolean;
  onBaseline(id: number | null): void;
  onEdit(): void;
}

/** The one line that says which resume the job is tailored from. */
export function MasterSummary({ master, baselines, baseline, locked, onBaseline, onEdit }: SummaryProps) {
  const name = (r: DocumentRow) => (r.master ? "Master" : r.title);
  return (
    <div className="rs-master">
      <span className="rs-master-sum">Using: {master.title} · updated {dayText(master.updatedAt, "short")}</span>
      {baselines.length > 1 ? (
        <span className="fgroup rs-based">
          <label htmlFor="rs-baseline">Based on</label>
          <select id="rs-baseline" value={baseline.id} disabled={locked} onChange={(e) => onBaseline(Number(e.target.value) === master.id ? null : Number(e.target.value))}>
            {baselines.map((r) => <option key={r.id} value={r.id}>{name(r)}</option>)}
          </select>
        </span>
      ) : null}
      <button type="button" className="rs-edit" onClick={onEdit}>Edit</button>
    </div>
  );
}

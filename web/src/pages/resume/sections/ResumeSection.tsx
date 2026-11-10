// Resume, the first section. Before there is a master it is the way in (the template, a file or pasted text, then the check); after, one compact
// row: the master and when it changed, which resume the job is tailored from, and Edit (the master's editor under Your documents).
import type { AiDeps } from "../../../ai";
import { dayText } from "../../../db/dayText";
import type { DocumentRow, JobTrackerDB } from "../../../db/schema";
import type { ConvertFn } from "../ConvertPanel";
import { MasterStart } from "../intake";
import type { ReportUnsaved } from "../unsaved";

interface Props {
  db: JobTrackerDB;
  ai: AiDeps;
  convert: ConvertFn;
  report: ReportUnsaved;
  /** the live master, or undefined before there is one */
  master: DocumentRow | undefined;
  /** the master, then the versions */
  baselines: readonly DocumentRow[];
  /** the resume the job is tailored from */
  baseline: DocumentRow | undefined;
  /** a draft was written from the baseline, so it is shown, not chosen */
  locked: boolean;
  onBaseline(id: number | null): void;
  onEdit(): void;
  /** the first master was saved */
  onSaved(): void;
}

export function ResumeSection({ db, ai, convert, report, master, baselines, baseline, locked, onBaseline, onEdit, onSaved }: Props) {
  const name = (r: DocumentRow) => (r.master ? "Master" : r.title);
  return (
    <section className="rs-section" aria-labelledby="rs-resume-h">
      <h2 className="rs-h" id="rs-resume-h">Resume</h2>
      {!master || !baseline ? (
        <MasterStart db={db} ai={ai} convert={convert} report={report} onSaved={onSaved} />
      ) : (
        <div className="card rs-master">
          <span className="rs-master-sum">{master.title} · updated {dayText(master.updatedAt, "short")}</span>
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
      )}
    </section>
  );
}

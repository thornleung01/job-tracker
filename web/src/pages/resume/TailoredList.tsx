import { Notice } from "../../components/Notice";
import { useAction } from "../../components/useAction";
import { dayText } from "../../db/dayText";
import type { DocumentRow, JobTrackerDB } from "../../db/schema";
import { promoteTailored } from "../../sync/documents";

export interface TailoredItem {
  doc: DocumentRow;
  app: { id: number; company: string; role: string } | null;
}

interface Props {
  db: JobTrackerDB;
  items: TailoredItem[];
  /** the live resumes (master and versions), to name what each tailored copy was based on */
  baselines: readonly DocumentRow[];
  /** say something on the page, and move focus to it when the control that had focus is gone */
  say(message: string, removed?: boolean): void;
}

/** "Based on: Master", the version's title, or a sentence for a baseline that has been deleted. Empty when the copy records none. */
export function basedOnText(doc: DocumentRow, baselines: readonly DocumentRow[]): string {
  if (doc.basedOn === undefined) return "";
  const base = baselines.find((b) => b.id === doc.basedOn);
  if (!base) return "Based on: a deleted resume";
  return `Based on: ${base.master ? "Master" : base.title}`;
}

function Row({ db, item, baselines, say }: { db: JobTrackerDB; item: TailoredItem; baselines: readonly DocumentRow[]; say: Props["say"] }) {
  const { doc, app } = item;
  const act = useAction();
  const based = basedOnText(doc, baselines);
  const promote = () =>
    void act.run("promote", async () => {
      await promoteTailored(db, doc.id);
      say(`${doc.title} is now one of your resume versions.`, true);   // the row leaves this tab
    });
  return (
    <li className="card doc-tailored">
      <div className="doc-tailored-row">
        <div className="doc-cover-text">
          <span className="doc-cover-title">{doc.title}</span>
          <p className="muted small">
            {app ? <><a href={`#/app/${app.id}`}>{[app.company, app.role].filter(Boolean).join(", ") || "Open the application"}</a> · </> : null}
            {based ? `${based} · ` : ""}
            {`Updated ${dayText(doc.updatedAt, "short")}`}
          </p>
        </div>
        <div className="row doc-tailored-actions">
          {app ? <a className="btn" href={`#/tailor/${app.id}`} aria-label={`Open ${doc.title} in Tailor`}>Open in Tailor</a> : null}
          <button type="button" onClick={promote} aria-label={`Make ${doc.title} reusable`} {...act.button("promote")}>Make reusable</button>
          <a className="btn" href={`#/resume/print/${doc.id}`} aria-label={`Print ${doc.title}`}>Print</a>
        </div>
      </div>
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
    </li>
  );
}

/** The resumes tailored for one application each, newest first. Each opens in the Tailor workspace; new ones start from the Resume page steps. */
export function TailoredList({ db, items, baselines, say }: Props) {
  if (!items.length) {
    return (
      <div className="doc-tailored-empty">
        <p className="muted">No tailored resumes yet.</p>
        <a className="btn" href="#/resume?step=job">Tailor for a job</a>
      </div>
    );
  }
  return (
    <ul className="doc-covers">
      {items.map((item) => <Row key={item.doc.id} db={db} item={item} baselines={baselines} say={say} />)}
    </ul>
  );
}

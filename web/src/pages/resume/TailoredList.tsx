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
  /** say something on the page, and move focus to it when the control that had focus is gone */
  say(message: string, removed?: boolean): void;
}

function Row({ db, item, say }: { db: JobTrackerDB; item: TailoredItem; say: Props["say"] }) {
  const { doc, app } = item;
  const act = useAction();
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
            {`Updated ${dayText(doc.updatedAt, "short")}`}
          </p>
        </div>
        <div className="row doc-tailored-actions">
          <button type="button" onClick={promote} aria-label={`Make ${doc.title} reusable`} {...act.button("promote")}>Make reusable</button>
          <a className="btn" href={`#/resume/print/${doc.id}`} aria-label={`Print ${doc.title}`}>Print</a>
        </div>
      </div>
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
    </li>
  );
}

/** The resumes tailored for one application each, newest first. Tailoring happens on the application's own page. */
export function TailoredList({ db, items, say }: Props) {
  if (!items.length) return <p className="muted">No tailored resumes yet. Open an application with its job posting saved to make one.</p>;
  return (
    <ul className="doc-covers">
      {items.map((item) => <Row key={item.doc.id} db={db} item={item} say={say} />)}
    </ul>
  );
}

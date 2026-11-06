import { useQuery } from "../../app/useQuery";
import { sectionsToText } from "../../db/documentShape";
import type { DocumentRow, JobTrackerDB } from "../../db/schema";
import { downloadText } from "../settings/actions";
import "./print.css";

/** "Resume for data roles" becomes "resume-for-data-roles.txt". */
export function textFilename(title: string): string {
  const slug = title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${slug || "document"}.txt`;
}

/** What the text file holds: a resume starts with its title (the name line), a letter is just its words. */
export function documentText(doc: Pick<DocumentRow, "kind" | "title" | "sections">): string {
  const body = sectionsToText(doc.sections);
  return doc.kind === "resume" ? `${doc.title}\n\n${body}\n` : `${body}\n`;
}

const missing = (
  <>
    <h1 className="page">Resume</h1>
    <p className="muted">That document isn't there any more.</p>
    <a className="btn" href="#/resume">Back to Resume</a>
  </>
);

/** One document as a clean single column, for printing or saving as PDF. Any live resume or cover letter id works. */
export function PrintView({ db, id }: { db: JobTrackerDB; id: string }) {
  const n = /^\d+$/.test(id) ? Number(id) : NaN;
  const doc = useQuery(async () => (Number.isSafeInteger(n) ? (await db.documents.get(n)) ?? null : null), [db, n]);
  if (doc === undefined) return <h1 className="page">Resume</h1>;
  if (doc === null || doc.deletedAt) return missing;
  const letter = doc.kind === "cover";
  return (
    <div className="doc-print">
      <div className="doc-print-bar">
        <a className="back" href="#/resume"><span className="chev" aria-hidden="true"></span>Resume</a>
        <div className="row">
          <button type="button" className="primary" onClick={() => window.print()}>Print or save as PDF</button>
          <button type="button" onClick={() => downloadText(textFilename(doc.title), documentText(doc), "text/plain")}>Download as text</button>
        </div>
      </div>
      <article className="doc-sheet">
        <h1 className={letter ? "page sr" : "page doc-name"}>{doc.title}</h1>
        {doc.sections.map((s) => (
          <section key={s.id} className="doc-block">
            {s.heading ? <h2>{s.heading}</h2> : null}
            {letter ? (
              s.items.map((i) => <p key={i.id}>{i.text}</p>)
            ) : (
              <ul>{s.items.map((i) => <li key={i.id}>{i.text}</li>)}</ul>
            )}
          </section>
        ))}
      </article>
    </div>
  );
}

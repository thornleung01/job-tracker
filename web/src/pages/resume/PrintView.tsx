import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "../../app/useQuery";
import { sectionsToText } from "../../db/documentShape";
import type { DocItem, DocSection, DocumentRow, JobTrackerDB } from "../../db/schema";
import { downloadText } from "../settings/actions";
import { CLASSIC_LINE_PX, PRINTABLE_HEIGHT_PX, measureSheetHeight, pageVerdict, pageVerdictText, type PageVerdict } from "./onepage";
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

const isHeader = (s: DocSection) => s.heading.trim().toLocaleLowerCase() === "header";

/** "Label: text", the label bold. A line with no label is just its text. */
const labelled = (i: DocItem): ReactNode => (
  <>
    {i.label ? <><strong>{i.label}:</strong> </> : null}
    {i.text}
  </>
);

/** A job or school (bold, its location on the right) or a title (italic, its dates on the right). */
function Row({ item }: { item: DocItem }) {
  const Tag = item.kind === "title" ? "em" : "strong";
  return (
    <div className={item.kind === "title" ? "doc-row doc-title" : "doc-row doc-org"}>
      <Tag>{item.text}</Tag>
      {item.right ? <Tag className="doc-right">{item.right}</Tag> : null}
    </div>
  );
}

/**
 * One resume section's lines in the owner's template. Consecutive bullets share one list. A section of several plain lines and nothing else
 * (a resume from before kinds) stays a plain list, as it always was. A lone plain line, like a summary, is a paragraph.
 */
function classicLines(items: DocItem[]): ReactNode[] {
  const legacy = items.length > 1 && items.every((i) => !i.kind);
  const out: ReactNode[] = [];
  let run: DocItem[] = [];
  const flush = () => {
    if (!run.length) return;
    out.push(
      <ul key={run[0].id} className={legacy ? undefined : "doc-bullets"}>
        {run.map((i) => <li key={i.id}>{legacy ? i.text : labelled(i)}</li>)}
      </ul>,
    );
    run = [];
  };
  for (const i of items) {
    if (legacy || i.kind === "bullet") {
      run.push(i);
      continue;
    }
    flush();
    if (i.kind === "org" || i.kind === "school" || i.kind === "title") out.push(<Row key={i.id} item={i} />);
    else if (i.kind === "skill") out.push(<p key={i.id} className="doc-skill">{labelled(i)}</p>);
    else out.push(<p key={i.id}>{i.text}</p>);
  }
  flush();
  return out;
}

/**
 * One document as a clean single column, for printing or saving as PDF. Any live resume or cover letter id works.
 * `measure` is the page-height probe, a seam for tests (jsdom has no layout).
 */
export function PrintView({ db, id, measure = measureSheetHeight }: { db: JobTrackerDB; id: string; measure?: (sheet: HTMLElement) => number }) {
  const n = /^\d+$/.test(id) ? Number(id) : NaN;
  const doc = useQuery(async () => (Number.isSafeInteger(n) ? (await db.documents.get(n)) ?? null : null), [db, n]);
  const sheet = useRef<HTMLElement>(null);
  const [verdict, setVerdict] = useState<PageVerdict | null>(null);
  const resume = !!doc && !doc.deletedAt && doc.kind === "resume";
  // Advisory only: the screen render approximates print, so the browser's own print preview has the last word.
  useLayoutEffect(() => {
    const el = sheet.current;
    if (!resume || !el) return;
    const check = () => setVerdict(pageVerdict(measure(el), PRINTABLE_HEIGHT_PX, CLASSIC_LINE_PX));
    check();
    let live = true;
    // fonts arriving late change the line breaks
    void document.fonts?.ready.then(() => live && check());
    return () => {
      live = false;
    };
  }, [resume, doc, measure]);
  if (doc === undefined) return <h1 className="page">Resume</h1>;
  if (doc === null || doc.deletedAt) return missing;
  const letter = doc.kind === "cover";
  const header = letter ? undefined : doc.sections.find((s) => isHeader(s) && s.items.length);
  const name = header ? header.items[0].text : doc.title;
  return (
    <div className="doc-print">
      <div className="doc-print-bar">
        <a className="back" href="#/resume"><span className="chev" aria-hidden="true"></span>Resume</a>
        <div className="row">
          {resume && verdict ? <span className="doc-fit muted" role="status">{pageVerdictText(verdict)}</span> : null}
          <button type="button" className="primary" onClick={() => window.print()}>Print or save as PDF</button>
          <button type="button" onClick={() => downloadText(textFilename(doc.title), documentText(doc), "text/plain")}>Download as text</button>
        </div>
      </div>
      <article ref={sheet} className={letter ? "doc-sheet" : "doc-sheet classic"}>
        <h1 className={letter ? "page sr" : "page doc-name"}>{name}</h1>
        {header ? <div className="doc-contact">{header.items.slice(1).map((i) => <p key={i.id}>{i.text}</p>)}</div> : null}
        {doc.sections.map((s) =>
          s === header ? null : (
            <section key={s.id} className="doc-block">
              {s.heading ? <h2>{s.heading}</h2> : null}
              {letter ? s.items.map((i) => <p key={i.id}>{i.text}</p>) : classicLines(s.items)}
            </section>
          ),
        )}
      </article>
    </div>
  );
}

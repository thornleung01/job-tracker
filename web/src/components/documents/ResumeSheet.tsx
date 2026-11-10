import type { ReactNode, Ref } from "react";
import { isHeaderHeading } from "../../db/documentShape";
import type { DocItem, DocSection } from "../../db/schema";
import { FitBox } from "./FitBox";
import "./resumesheet.css";

/** "Label: text", the label bold. A line with no label is just its text. */
function LabelledText({ item }: { item: DocItem }) {
  return (
    <>
      {item.label ? <><strong>{item.label}:</strong> </> : null}
      {item.text}
    </>
  );
}

/** A job or school (bold, its location on the right) or a title (italic, its dates on the right). */
function Row({ item }: { item: DocItem }) {
  const isTitle = item.kind === "title";
  const Tag = isTitle ? "em" : "strong";
  return (
    <div className={isTitle ? "doc-row doc-title" : "doc-row doc-org"}>
      <Tag>{item.text}</Tag>
      {item.right ? <Tag className="doc-right">{item.right}</Tag> : null}
    </div>
  );
}

/**
 * One resume section's lines in the owner's template. Consecutive bullets share one list. A section of several plain lines and nothing else
 * (a resume from before kinds) stays a plain list, as it always was. A lone plain line, like a summary, is a paragraph.
 * A legacy section shows `i.text` only: a line without a kind never carries a label (the importer and editor drop it), so there is none to show.
 */
function classicLines(items: DocItem[]): ReactNode[] {
  const legacy = items.length > 1 && items.every((i) => !i.kind);
  const out: ReactNode[] = [];
  let run: DocItem[] = [];
  const flush = () => {
    if (!run.length) return;
    out.push(
      <ul key={run[0].id} className={legacy ? undefined : "doc-bullets"}>
        {run.map((i) => <li key={i.id}>{legacy ? i.text : <LabelledText item={i} />}</li>)}
      </ul>,
    );
    run = [];
  };
  for (const i of items) {
    if (legacy) {
      run.push(i);
      continue;
    }
    switch (i.kind) {
      case "bullet":
        run.push(i);
        break;
      case "org":
      case "school":
      case "title":
        flush();
        out.push(<Row key={i.id} item={i} />);
        break;
      case "skill":
        flush();
        out.push(<p key={i.id}><LabelledText item={i} /></p>);
        break;
      default:
        flush();
        out.push(<p key={i.id}>{i.text}</p>);
    }
  }
  flush();
  return out;
}

/**
 * A resume as the owner's classic one-page sheet: the name and contact lines centred (from the header section, or `title` when there is none),
 * then each section under a ruled heading. With `fit` it keeps its 816px width and is scaled down into a narrower column. Read only. It is the page itself, so it keeps its own serif black-on-white look in light and dark.
 */
export function ResumeSheet({ sections, title, sheetRef, fit = false }: { sections: DocSection[]; title: string; sheetRef?: Ref<HTMLElement>; fit?: boolean }) {
  const header = sections.find((s) => isHeaderHeading(s.heading) && s.items.length);
  const name = header ? header.items[0].text : title;
  return (
    <FitBox on={fit}>
    <article ref={sheetRef} className="doc-sheet classic">
      <h1 className="page doc-name">{name}</h1>
      {header ? <div className="doc-contact">{header.items.slice(1).map((i) => <p key={i.id}>{i.text}</p>)}</div> : null}
      {sections.map((s) =>
        s === header ? null : (
          <section key={s.id} className="doc-block">
            {s.heading ? <h2>{s.heading}</h2> : null}
            {classicLines(s.items)}
          </section>
        ),
      )}
    </article>
    </FitBox>
  );
}

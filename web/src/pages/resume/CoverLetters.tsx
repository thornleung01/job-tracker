import { dayText } from "../../db/dayText";
import type { ApplicationRow, DocumentRow } from "../../db/schema";

interface Props {
  letters: DocumentRow[];
  /** the live applications, by id: a letter whose application is deleted isn't listed */
  apps: ReadonlyMap<number, ApplicationRow>;
}

/** The cover letters you have written, newest first. Writing and editing happen on the application's own page. */
export function CoverLetters({ letters, apps }: Props) {
  const rows = letters
    .flatMap((d) => {
      const app = d.applicationId === null ? undefined : apps.get(d.applicationId);
      return app ? [{ doc: d, app }] : [];
    })
    .sort((a, b) => (a.doc.updatedAt < b.doc.updatedAt ? 1 : a.doc.updatedAt > b.doc.updatedAt ? -1 : 0));
  if (!rows.length) return <p className="muted">No cover letters yet.</p>;
  return (
    <ul className="doc-covers">
      {rows.map(({ doc, app }) => (
        <li key={doc.id} className="card">
          <div className="doc-cover-text">
            <a className="doc-cover-title" href={`#/app/${app.id}`}>{doc.title}</a>
            <p className="muted small">{[app.company, app.role, `Updated ${dayText(doc.updatedAt, "short")}`].filter(Boolean).join(" · ")}</p>
          </div>
          <a className="btn" href={`#/app/${app.id}`} aria-label={`Open ${doc.title}`}>Open</a>
        </li>
      ))}
    </ul>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PageProps } from "../../app/pageProps";
import { useQuery } from "../../app/useQuery";
import { Notice } from "../../components/Notice";
import { PersonCard } from "../../components/PersonCard";
import { derive, type Contact } from "../../sync/contacts";
import "./people.css";

const UNKNOWN_ROLE = "Unknown role";

interface Group {
  id: number;
  company: string;
  role: string;
  last: string;
  people: Contact[];
}

/** People grouped under their application, the one you spoke to last on top. */
export function groupByApplication(shown: Contact[]): Group[] {
  const groups = new Map<number, Group>();
  for (const c of shown) {
    const g = groups.get(c.appId) ?? { id: c.appId, company: c.company, role: c.role, last: c.last, people: [] };
    groups.set(c.appId, g);
    g.people.push(c);
    if (c.last > g.last) g.last = c.last;
  }
  return [...groups.values()].sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
}

export default function PeoplePage({ db, query, navigate }: PageProps) {
  const q = (query.get("q") ?? "").trim();
  const everyone = useQuery(() => derive(db), [db]);
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  const [notice, setNotice] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  if (!everyone) return <h1 className="page">People</h1>;
  const needle = q.toLocaleLowerCase();
  const shown = everyone.filter((c) => !needle || [c.name, c.title, c.company, c.role, c.email].join(" ").toLocaleLowerCase().includes(needle));
  const groups = groupByApplication(shown);
  const total = everyone.length;

  const search = (e: FormEvent) => {
    e.preventDefault();
    navigate(draft.trim() ? `/people?q=${encodeURIComponent(draft.trim())}` : "/people");
  };
  const fold = (open: boolean) => list.current?.querySelectorAll("details.company").forEach((d) => { (d as HTMLDetailsElement).open = open; });

  return (
    <>
      <h1 className="page">People</h1>
      <p className="muted">Who you are talking to on each application, worked out from its emails.</p>
      {notice ? <Notice>{notice}</Notice> : null}

      <form className="row people-search" onSubmit={search}>
        <div className="fgroup f-search">
          <label htmlFor="c-q">Search</label>
          <input id="c-q" name="q" value={draft} placeholder="Name, title, company or role" autoComplete="off" onChange={(e) => setDraft(e.target.value)} />
        </div>
        <button type="submit" className="primary">Search</button>
        {q ? <a className="small clear-search" href="#/people">Clear</a> : null}
      </form>

      <div className="result-line" role="status">
        {q ? `${shown.length} of ${total}` : total} {total === 1 ? "person" : "people"} across {groups.length} application{groups.length === 1 ? "" : "s"}
      </div>

      {groups.length > 1 ? (
        <div className="row fold-row">
          <button type="button" onClick={() => fold(true)}>Expand all</button>
          <button type="button" onClick={() => fold(false)}>Collapse all</button>
        </div>
      ) : null}

      <div ref={list} className="company-list">
        {/* Every company is a dropdown. It opens by itself when there is only one, or when you searched and so want to see what matched. */}
        {groups.map((g) => (
          <details key={g.id} className="company" id={`g-${g.id}`} open={Boolean(q) || groups.length === 1}>
            <summary className="disclosure">
              <span className="chev" aria-hidden="true"></span>
              <span className="company-name">{g.company}</span>
              {g.role && g.role !== UNKNOWN_ROLE ? <span className="muted company-role">{g.role}</span> : null}
              <span className="muted company-count">{g.people.length} {g.people.length === 1 ? "person" : "people"}</span>
            </summary>
            <ul className="people">
              {g.people.map((c) => <li key={c.key}><PersonCard db={db} contact={c} onNotice={setNotice} /></li>)}
            </ul>
            <p className="small company-open"><a href={`#/app/${g.id}`}>Open this application</a></p>
          </details>
        ))}
      </div>
      {!groups.length ? (
        <p className="muted">{q ? `Nobody matches "${q}".` : "No people yet. They appear once emails from real people, such as a recruiter or an interviewer, belong to an application."}</p>
      ) : null}
    </>
  );
}

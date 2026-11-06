import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { PageProps } from "../../app/pageProps";
import { useQuery } from "../../app/useQuery";
import { Combobox } from "../../components/Combobox";
import { Notice } from "../../components/Notice";
import { PersonCard } from "../../components/PersonCard";
import { useNoticeFocus } from "../../components/useNoticeFocus";
import { UNKNOWN_ROLE } from "../../pipeline/extract";
import { derive, suggestionsFor, type Contact } from "../../sync/contacts";
import type { Suggestion } from "../../sync/queries";
import "./people.css";

const SUGGESTION_KINDS: Suggestion["kind"][] = ["Person", "Company", "Role", "Title"];

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
  const result = useNoticeFocus();
  const say = (message: string, removed?: boolean) => {
    setNotice(message);
    if (removed) result.focus();   // the Not a person button is gone with the card
  };
  const list = useRef<HTMLDivElement>(null);
  const suggest = useMemo(() => suggestionsFor(everyone ?? []), [everyone]);

  if (!everyone) return <h1 className="page">People</h1>;
  const needle = q.toLocaleLowerCase();
  const shown = everyone.filter((c) => !needle || [c.name, c.title, c.company, c.role, c.email].join(" ").toLocaleLowerCase().includes(needle));
  const groups = groupByApplication(shown);
  const total = everyone.length;

  const go = (text: string) => navigate(text.trim() ? `/people?q=${encodeURIComponent(text.trim())}` : "/people");
  const search = (e: FormEvent) => {
    e.preventDefault();
    go(draft);
  };
  const choose = (text: string) => {
    setDraft(text);
    go(text);
  };
  const fold = (open: boolean) => list.current?.querySelectorAll("details.company").forEach((d) => { (d as HTMLDetailsElement).open = open; });

  return (
    <>
      <h1 className="page">People</h1>
      <div ref={result.box}>{notice ? <Notice>{notice}</Notice> : null}</div>

      <form className="row people-search" onSubmit={search}>
        <div className="fgroup f-search">
          <label htmlFor="c-q">Search</label>
          <Combobox id="c-q" value={draft} onChange={setDraft} suggestions={suggest} kinds={SUGGESTION_KINDS} placeholder="Name, title, company or role"
                    listLabel="People, companies, roles and titles you have" emptyText="No people yet." onChoose={choose} />
        </div>
        {q ? <a className="small clear-search" href="#/people">Clear search</a> : null}
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
              {g.people.map((c) => <li key={c.key}><PersonCard db={db} contact={c} onNotice={say} /></li>)}
            </ul>
            <p className="small company-open"><a href={`#/app/${g.id}`}>Open this application</a></p>
          </details>
        ))}
      </div>
      {!groups.length ? (
        <p className="muted">{q ? `No people match "${q}".` : "No people yet. They appear once emails from real people, such as a recruiter or an interviewer, belong to an application."}</p>
      ) : null}
    </>
  );
}

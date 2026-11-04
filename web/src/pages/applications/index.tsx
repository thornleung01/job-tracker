import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import type { PageProps } from "../../app/pageProps";
import { useQuery } from "../../app/useQuery";
import { ApplicationPanel } from "../../components/ApplicationPanel";
import { Combobox } from "../../components/Combobox";
import { Notice } from "../../components/Notice";
import { StageCell } from "../../components/StageBadge";
import { LastActivity } from "../../components/TimeText";
import { useAction } from "../../components/useAction";
import { listAccounts } from "../../db/repo";
import { STAGES, isStage, type Stage } from "../../db/stages";
import { localToday } from "../../db/time";
import { addApplication } from "../../sync/actions";
import { DEFAULT_DIR, SORT_COLUMNS, listApplications, reviewCount, stageCounts, suggestions, type SortColumn } from "../../sync/queries";
import { COLUMNS, loadSettings, type ColumnId } from "../../sync/settings";
import "./applications.css";

interface ListState {
  stage: string;
  q: string;
  account: number;
  sort: string;
  dir: string;
  open: number[];
}

/** The list's address, with every filter in the hash query so reload and back both land on the same view. */
export function listUrl(s: Partial<ListState>): string {
  const p = new URLSearchParams();
  if (s.stage) p.set("stage", s.stage);
  if (s.q?.trim()) p.set("q", s.q.trim());
  if (s.account) p.set("account", String(s.account));
  if (s.sort) p.set("sort", s.sort);
  if (s.dir) p.set("dir", s.dir);
  if (s.open?.length) p.set("open", s.open.join(","));
  const qs = p.toString();
  return qs ? `/?${qs}` : "/";
}

/** The attribute the stylesheet hangs the phone layout on: last activity is `last_activity` there. */
const dataCol = (c: ColumnId): string => (c === "lastActivity" ? "last_activity" : c);

function readState(query: URLSearchParams): ListState {
  const sort = query.get("sort") ?? "";
  const dir = query.get("dir") ?? "";
  return {
    stage: isStage(query.get("stage")) ? (query.get("stage") as Stage) : "",
    q: query.get("q") ?? "",
    account: Number(query.get("account")) || 0,
    sort: SORT_COLUMNS.includes(sort as SortColumn) ? sort : "",
    dir: dir === "asc" || dir === "desc" ? dir : "",
    open: [...new Set((query.get("open") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))],
  };
}

export default function ApplicationsPage({ db, query, navigate }: PageProps) {
  const state = readState(query);
  const { stage, q, account, open } = state;
  const sort = (state.sort || "lastActivity") as SortColumn;
  const dir = state.dir || DEFAULT_DIR[sort];

  const data = useQuery(async () => {
    const rows = await listApplications(db, { stage, q, account, sort, dir });
    const counts = await stageCounts(db);
    return {
      rows, counts, accounts: await listAccounts(db), review: await reviewCount(db),
      columns: (await loadSettings(db)).appearance.columns, suggestions: await suggestions(db),
    };
  }, [db, stage, q, account, sort, dir]);

  // The filter form edits drafts; Apply filters (or picking a suggestion) puts them in the address.
  const [draftQ, setDraftQ] = useState(q);
  const [draftStage, setDraftStage] = useState<string>(stage);
  const [draftAccount, setDraftAccount] = useState(account);
  useEffect(() => setDraftQ(q), [q]);
  useEffect(() => setDraftStage(stage), [stage]);
  useEffect(() => setDraftAccount(account), [account]);

  const sorting = { sort: state.sort, dir: state.dir };
  const apply = (e?: FormEvent) => {
    e?.preventDefault();
    navigate(listUrl({ stage: draftStage, q: draftQ, account: draftAccount, ...sorting }));
  };
  const setOpen = (ids: number[]) => navigate(listUrl({ stage, q, account, ...sorting, open: ids }), { replace: true });
  const toggle = (id: number) => setOpen(open.includes(id) ? open.filter((x) => x !== id) : [...open, id]);

  // Add an application manually
  const add = useAction();
  const [addOpen, setAddOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [addStage, setAddStage] = useState<Stage>("Applied");
  const [appliedOn, setAppliedOn] = useState(localToday());
  const addBox = useRef<HTMLDetailsElement>(null);
  const companyInput = useRef<HTMLInputElement>(null);
  const [focusAdd, setFocusAdd] = useState(0);
  useEffect(() => {
    if (!focusAdd) return;
    addBox.current?.scrollIntoView?.({ block: "center" });
    companyInput.current?.focus();
  }, [focusAdd]);
  const submitAdd = (e: FormEvent) => {
    e.preventDefault();
    void add.run("add", async () => {
      await addApplication(db, { company, role, stage: addStage, appliedOn });
      const added = company.trim();
      setCompany("");
      setRole("");
      setAddStage("Applied");
      setAppliedOn(localToday());
      return `Added ${added}. It is kept as yours, so a sync never changes it.`;
    });
  };

  if (!data) return <h1 className="page">Applications</h1>;
  const { rows, counts, accounts, review, columns, suggestions: suggest } = data;
  const total = STAGES.reduce((n, s) => n + counts[s], 0);
  const filtered = Boolean(stage || q.trim() || account);
  const thisAccount = accounts.find((a) => a.id === account);

  const sortHref = (c: ColumnId) =>
    "#" + listUrl({ stage, q, account, sort: c, dir: sort === c ? (dir === "asc" ? "desc" : "asc") : DEFAULT_DIR[c] });

  const onRowClick = (e: MouseEvent<HTMLTableRowElement>, id: number) => {
    // Clicking empty space in a row opens it too.
    if ((e.target as Element).closest("a, button, input, select, textarea, label, form")) return;
    toggle(id);
  };
  const onExpanderKey = (e: KeyboardEvent<HTMLAnchorElement>, id: number) => {
    if (e.key === " ") {
      e.preventDefault(); // role=button also answers to Space
      toggle(id);
    }
  };

  const cell = (c: ColumnId, r: (typeof rows)[number], isOpen: boolean) => {
    switch (c) {
      case "company":
        return (
          <td role="cell" data-col="company" key={c}>
            <a className="expander" href={"#" + listUrl({ stage, q, account, ...sorting, open: isOpen ? open.filter((x) => x !== r.id) : [...open, r.id] })}
               role="button" data-id={r.id} aria-expanded={isOpen} aria-controls={`panel-${r.id}`}
               onClick={(e) => { e.preventDefault(); toggle(r.id); }} onKeyDown={(e) => onExpanderKey(e, r.id)}>
              <span className="chev" aria-hidden="true"></span><strong>{r.company}</strong>
            </a>
            <a className="open-link small" href={`#/app/${r.id}`} aria-label={`Open the full page for ${r.company}`}>Open page</a>
            <span className="role-sub">{r.role}</span>
          </td>
        );
      case "role": return <td role="cell" data-col="role" key={c}>{r.role}</td>;
      case "stage": return <td role="cell" data-col="stage" key={c} id={`stage-${r.id}`}><StageCell stage={r.stage} locked={r.locked} /></td>;
      case "applied": return <td role="cell" data-col="applied" key={c} className="small muted">{r.appliedAt ? r.appliedAt.slice(0, 10) : "unknown"}</td>;
      case "lastActivity":
        return <td role="cell" data-col="last_activity" key={c} id={`last-${r.id}`} className="small muted"><LastActivity iso={r.lastActivity} idleDays={r.idleDays} /></td>;
      case "emails": return <td role="cell" data-col="emails" key={c} className="small muted">{r.nEmails}</td>;
    }
  };

  return (
    <>
      <h1 className="page">Applications</h1>
      <nav className="tabs" aria-label="Filter by stage">
        <a href={"#" + listUrl({})} className="tab" aria-current={!stage ? "true" : undefined}>All <span className="n">{total}</span></a>
        {STAGES.map((s) => (
          <a key={s} href={"#" + listUrl(s === stage ? {} : { stage: s })} className="tab"
             aria-current={s === stage ? "true" : undefined} title={s === stage ? "Click again to show all stages" : undefined}>
            {s} <span className="n" id={`count-${s}`}>{counts[s]}</span>
          </a>
        ))}
      </nav>

      <div className="card">
        <form className="row filters" onSubmit={apply}>
          <div className="fgroup f-search">
            <label htmlFor="f-q">Search</label>
            <Combobox id="f-q" value={draftQ} onChange={setDraftQ} suggestions={suggest} placeholder="Company or role"
                      onChoose={(text) => { setDraftQ(text); navigate(listUrl({ stage: draftStage, q: text, account: draftAccount, ...sorting })); }} />
          </div>
          <div className="fgroup">
            <label htmlFor="f-stage">Stage</label>
            <select id="f-stage" name="stage" value={draftStage} onChange={(e) => setDraftStage(e.target.value)}>
              <option value="">All stages</option>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {accounts.length > 1 ? (
            <div className="fgroup">
              <label htmlFor="f-account">Account</label>
              <select id="f-account" name="account" value={draftAccount} onChange={(e) => setDraftAccount(Number(e.target.value))}>
                <option value={0}>All accounts</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.address}</option>)}
              </select>
            </div>
          ) : null}
          <button type="submit" className="primary">Apply filters</button>
          <button type="button" onClick={() => { setAddOpen(true); setFocusAdd((n) => n + 1); }}>+ Add application</button>
        </form>
      </div>

      <div className="result-line" role="status">
        <span className="small muted">Showing {rows.length}{filtered ? ` of ${total}` : ""} application{rows.length !== 1 ? "s" : ""}</span>
        {stage ? <span className="chip">Stage: {stage}</span> : null}
        {q.trim() ? <span className="chip">Search: {q.trim()}</span> : null}
        {thisAccount ? <span className="chip">Account: {thisAccount.address}</span> : null}
        {filtered ? <a className="small clear-filters" href={"#" + listUrl({})}>Clear filters</a> : null}
      </div>

      {!accounts.length ? <Notice>No mail account connected yet. <a href="#/settings">Connect one in Settings</a> to start syncing.</Notice> : null}
      {review ? (
        <Notice>
          <a href="#/review">{review} email{review !== 1 ? "s" : ""} need{review !== 1 ? "" : "s"} a look</a>. The tracker wasn't sure which application {review !== 1 ? "they belong" : "it belongs"} to.
        </Notice>
      ) : null}

      <div className="card list-card">
        <table className="list" role="table">
          <thead role="rowgroup">
            <tr role="row">
              {columns.map((c) => (
                <th key={c} scope="col" role="columnheader" data-col={dataCol(c)} aria-sort={sort === c ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                  <a className="sort" href={sortHref(c)}>{COLUMNS[c]}<span className="sort-ind" aria-hidden="true"></span></a>
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows.map((r) => {
              const isOpen = open.includes(r.id);
              return (
                <Fragment key={r.id}>
                  <tr className={`app-row${isOpen ? " is-open" : ""}`} role="row" onClick={(e) => onRowClick(e, r.id)}>
                    {columns.map((c) => cell(c, r, isOpen))}
                  </tr>
                  <tr className="panel-row" role="row" id={`panel-${r.id}`} hidden={!isOpen}>
                    <td role="cell" colSpan={columns.length}>
                      {isOpen ? <div className="panel"><ApplicationPanel db={db} appId={r.id} includeEmails navigate={navigate} /></div> : null}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            {!rows.length ? (
              <tr role="row">
                <td role="cell" colSpan={columns.length} className="muted list-empty">
                  {filtered ? "No applications match these filters." : <>No applications yet. <a href="#/settings">Sync your mail in Settings</a>, or add one with "Add an application manually" below.</>}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <details className="card" id="add-application" ref={addBox} open={addOpen} onToggle={(e) => setAddOpen(e.currentTarget.open)}>
        <summary className="disclosure"><span className="chev" aria-hidden="true"></span>Add an application manually</summary>
        <p className="help add-note">Applied somewhere that never emailed you, or the mail is on another account? Log it here. It is kept as yours, so a sync never changes it.</p>
        {add.error ? <Notice tone="err">{add.error}</Notice> : null}
        {add.status ? <Notice>{add.status}</Notice> : null}
        <form className="row row-end" onSubmit={submitAdd}>
          <div className="fgroup f-grow">
            <label htmlFor="add-company">Company</label>
            <input id="add-company" name="company" ref={companyInput} required pattern=".*\S.*" title="Enter a company name" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="fgroup f-grow">
            <label htmlFor="add-role">Role (optional)</label>
            <input id="add-role" name="role" value={role} onChange={(e) => setRole(e.target.value)} />
          </div>
          <div className="fgroup">
            <label htmlFor="add-stage">Stage</label>
            <select id="add-stage" name="stage" value={addStage} onChange={(e) => setAddStage(e.target.value as Stage)}>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="fgroup">
            <label htmlFor="add-date">Date applied</label>
            <input id="add-date" name="applied_on" type="date" value={appliedOn} max={localToday()} onChange={(e) => setAppliedOn(e.target.value)} />
          </div>
          <button type="submit" className="primary" {...add.button("add")}>Add application</button>
        </form>
      </details>
    </>
  );
}

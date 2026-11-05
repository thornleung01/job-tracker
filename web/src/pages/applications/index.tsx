import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { PageProps } from "../../app/pageProps";
import { useQuery } from "../../app/useQuery";
import { BulkBar } from "../../components/bulk/BulkBar";
import { SelectAll } from "../../components/bulk/SelectBoxes";
import { useSelection } from "../../components/bulk/useSelection";
import { Combobox } from "../../components/Combobox";
import { DuplicateNotice } from "../../components/duplicates/DuplicateNotice";
import { useDuplicates } from "../../components/duplicates/useDuplicates";
import { FollowUpToggle } from "../../components/followup/FollowUpToggle";
import { JobLinkField } from "../../components/joblink/JobLinkField";
import type { JobLinkDeps } from "../../components/joblink/deps";
import { realJobLinkDeps } from "../../components/joblink/deps";
import { useJobLink } from "../../components/joblink/useJobLink";
import { Notice } from "../../components/Notice";
import { ComingUp } from "../../components/upcoming/ComingUp";
import { useAction } from "../../components/useAction";
import { isLocalUser } from "../../app/localUser";
import { listAccounts } from "../../db/repo";
import { STAGES, isStage, type Stage } from "../../db/stages";
import { localToday } from "../../db/time";
import { addApplication as realAddApplication } from "../../sync/actions";
import { DEFAULT_DIR, SORT_COLUMNS, listApplications, reviewCount, stageCounts, suggestions, type SortColumn } from "../../sync/queries";
import { COLUMNS, loadSettings, type ColumnId } from "../../sync/settings";
import { AppRow } from "./AppRow";
import "./applications.css";

interface ListState {
  stage: string;
  q: string;
  account: number;
  sort: string;
  dir: string;
  followUp: boolean;
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
  if (s.followUp) p.set("followUp", "1");
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
    followUp: query.get("followUp") === "1",
    open: [...new Set((query.get("open") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))],
  };
}

/** What tests may swap: the job-link library and the save. The router passes neither. */
export interface ApplicationsPageDeps extends Partial<JobLinkDeps> {
  addApplication?: typeof realAddApplication;
}

export default function ApplicationsPage({ db, user, query, navigate, deps = {} }: PageProps & { deps?: ApplicationsPageDeps }) {
  const addApplication = deps.addApplication ?? realAddApplication;
  const local = isLocalUser(user);
  const state = readState(query);
  const { stage, q, account, followUp, open } = state;
  const sort = (state.sort || "lastActivity") as SortColumn;
  const dir = state.dir || DEFAULT_DIR[sort];

  const data = useQuery(async () => {
    const rows = await listApplications(db, { stage, q, account, followUp, sort, dir });
    const counts = await stageCounts(db);
    return {
      rows, counts, accounts: await listAccounts(db), review: await reviewCount(db),
      columns: (await loadSettings(db)).appearance.columns, suggestions: await suggestions(db),
    };
  }, [db, stage, q, account, followUp, sort, dir]);

  // The ticked rows live here, not in the address, and are dropped when the filters change.
  const selection = useSelection(data?.rows, JSON.stringify([stage, q, account, followUp]));

  // The filter form edits drafts; Apply filters (or picking a suggestion) puts them in the address.
  const [draftQ, setDraftQ] = useState(q);
  const [draftStage, setDraftStage] = useState<string>(stage);
  const [draftAccount, setDraftAccount] = useState(account);
  const [draftFollowUp, setDraftFollowUp] = useState(followUp);
  useEffect(() => setDraftQ(q), [q]);
  useEffect(() => setDraftStage(stage), [stage]);
  useEffect(() => setDraftAccount(account), [account]);
  useEffect(() => setDraftFollowUp(followUp), [followUp]);

  const sorting = { sort: state.sort, dir: state.dir };
  const apply = (e?: FormEvent) => {
    e?.preventDefault();
    navigate(listUrl({ stage: draftStage, q: draftQ, account: draftAccount, followUp: draftFollowUp, ...sorting }));
  };
  const setOpen = (ids: number[]) => navigate(listUrl({ stage, q, account, followUp, ...sorting, open: ids }), { replace: true });
  const toggle = (id: number) => setOpen(open.includes(id) ? open.filter((x) => x !== id) : [...open, id]);
  // Rows are memoised, so the callback they get must keep its identity: it reads the latest `toggle` through a ref.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const onToggleOpen = useCallback((id: number) => toggleRef.current(id), []);

  // Add an application by hand: one button opens the form under the filter card
  const add = useAction();
  const [addOpen, setAddOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [postingUrl, setPostingUrl] = useState("");
  const [addStage, setAddStage] = useState<Stage>("Applied");
  const [appliedOn, setAppliedOn] = useState(localToday());
  const addBox = useRef<HTMLElement>(null);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const companyInput = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const link = useJobLink({ company, role, url: postingUrl }, { company: setCompany, role: setRole, url: setPostingUrl }, deps);
  const duplicates = useDuplicates(db, company, role, postingUrl, addOpen);
  const [focusAdd, setFocusAdd] = useState(0);
  const wantFocus = useRef<"company" | "save">("company");
  const ready = Boolean(data);
  // The form opens in place under the filter card, and its first field takes focus (Save, when a bookmarklet filled both fields).
  useEffect(() => {
    if (!focusAdd || !ready) return;
    addBox.current?.scrollIntoView?.({ block: "nearest" });
    (wantFocus.current === "save" ? saveButton.current : companyInput.current)?.focus();
  }, [focusAdd, ready]);
  const openAdd = () => {
    add.clear();
    wantFocus.current = "company";
    setAddOpen(true);
    setFocusAdd((n) => n + 1);
  };
  const closeAdd = () => {
    add.clear();
    link.reset();
    setAddOpen(false);
    addTrigger.current?.focus();
  };

  // The Save to Job Tracker bookmarklet sends the page you were viewing as #/?add=1&c=...: open the form filled in. It never saves.
  const arrival = useRef("");
  useEffect(() => {
    if (query.get("add") !== "1" || arrival.current === query.toString()) return;
    arrival.current = query.toString();
    const draft = (deps.draftFromHash ?? realJobLinkDeps.draftFromHash)(query);
    if (draft) {
      add.clear();
      link.adopt(draft);
      wantFocus.current = draft.company.trim() && draft.role.trim() ? "save" : "company";
      setAddOpen(true);
      setFocusAdd((n) => n + 1);
    }
    // Take the bookmarklet's parameters out of the address either way, so a reload does not open it again.
    navigate(listUrl({ stage, q, account, followUp, ...sorting, open }), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const submitAdd = (e: FormEvent) => {
    e.preventDefault();
    void add.run("add", async () => {
      await addApplication(db, { company, role, stage: addStage, appliedOn, url: postingUrl.trim() || undefined });
      const added = company.trim();
      link.reset();
      setCompany("");
      setRole("");
      setPostingUrl("");
      setAddStage("Applied");
      setAppliedOn(localToday());
      return `Added ${added}. It stays yours, so a sync never changes it.`;
    }).then((ok) => {
      if (!ok) return;
      setAddOpen(false);
      addTrigger.current?.focus();
    });
  };
  const onAddKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      closeAdd();
    }
  };

  if (!data) return <h1 className="page">Applications</h1>;
  const { rows, counts, accounts, review, columns, suggestions: suggest } = data;
  const total = STAGES.reduce((n, s) => n + counts[s], 0);
  const today = localToday();
  const filtered = Boolean(stage || q.trim() || account || followUp);
  const thisAccount = accounts.find((a) => a.id === account);

  const sortHref = (c: ColumnId) =>
    "#" + listUrl({ stage, q, account, followUp, sort: c, dir: sort === c ? (dir === "asc" ? "desc" : "asc") : DEFAULT_DIR[c] });

  return (
    <>
      <h1 className="page">Applications</h1>
      {filtered ? null : <ComingUp rows={rows} today={today} />}
      <nav className="tabs" aria-label="Filter by stage">
        <a href={"#" + listUrl({})} className="tab" aria-current={!stage ? "true" : undefined}>All <span className="n">{total}</span></a>
        {STAGES.map((s) => (
          <a key={s} href={"#" + listUrl(s === stage ? {} : { stage: s })} className="tab"
             aria-current={s === stage ? "true" : undefined} title={s === stage ? "Choose again to show all stages" : undefined}>
            {s} <span className="n" id={`count-${s}`}>{counts[s]}</span>
          </a>
        ))}
      </nav>

      <div className="card">
        <form className="row filters" onSubmit={apply}>
          <div className="fgroup f-search">
            <label htmlFor="f-q">Search</label>
            <Combobox id="f-q" value={draftQ} onChange={setDraftQ} suggestions={suggest} placeholder="Company or role"
                      onChoose={(text) => { setDraftQ(text); navigate(listUrl({ stage: draftStage, q: text, account: draftAccount, followUp: draftFollowUp, ...sorting })); }} />
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
          <FollowUpToggle checked={draftFollowUp} onChange={setDraftFollowUp} />
          {/* One primary per surface: the open add form owns it, so Apply filters steps down while the form is showing. */}
          <button type="submit" className={addOpen ? undefined : "primary"}>Apply filters</button>
          <button type="button" ref={addTrigger} aria-expanded={addOpen} aria-controls="add-application" onClick={openAdd}>Add application</button>
        </form>
      </div>

      {addOpen ? (
        <section className="card" id="add-application" ref={addBox} aria-labelledby="add-application-title" onKeyDown={onAddKey}>
          <h2 className="section" id="add-application-title">Add application</h2>
          <p className="help add-note">Applied somewhere that never emailed you, or the email is in another account? Add it here. It stays yours, so a sync never changes it.</p>
          {add.error ? <Notice tone="err">{add.error}</Notice> : null}
          <form onSubmit={submitAdd}>
            <div className="add-link-slot" id="add-link-slot">
              <JobLinkField link={link} navigate={navigate} />
            </div>
            <div className="row add-fields">
              <div className="fgroup f-grow">
                <label htmlFor="add-company">Company</label>
                <input id="add-company" name="company" ref={companyInput} required pattern=".*\S.*" title="Enter a company name." value={company}
                       aria-describedby={link.hints.company ? "add-company-hint" : undefined}
                       onChange={(e) => { link.edited("company"); setCompany(e.target.value); }} />
                {link.hints.company ? <p className="field-hint" id="add-company-hint">{link.hints.company}</p> : null}
              </div>
              <div className="fgroup f-grow">
                <label htmlFor="add-role">Role (optional)</label>
                <input id="add-role" name="role" value={role} aria-describedby={link.hints.role ? "add-role-hint" : undefined}
                       onChange={(e) => { link.edited("role"); setRole(e.target.value); }} />
                {link.hints.role ? <p className="field-hint" id="add-role-hint">{link.hints.role}</p> : null}
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
            </div>
            <div className="row add-url-row">
              <div className="fgroup f-grow">
                <label htmlFor="add-url">Posting link (optional)</label>
                <input id="add-url" name="url" type="text" inputMode="url" autoComplete="off" spellCheck={false} value={postingUrl}
                       onChange={(e) => { link.edited("url"); setPostingUrl(e.target.value); }} />
              </div>
            </div>
            <DuplicateNotice matches={duplicates} />
            <div className="row add-actions">
              <button type="submit" className="primary" ref={saveButton} {...add.button("add")}>Save application</button>
              <button type="button" onClick={closeAdd}>Cancel</button>
            </div>
          </form>
        </section>
      ) : add.status ? <Notice>{add.status}</Notice> : null}

      <div className="result-line" role="status">
        <span className="small muted">Showing {rows.length}{filtered ? ` of ${total}` : ""} application{rows.length !== 1 ? "s" : ""}</span>
        {stage ? <span className="chip">Stage: {stage}</span> : null}
        {q.trim() ? <span className="chip">Search: {q.trim()}</span> : null}
        {followUp ? <span className="chip">Needs follow-up</span> : null}
        {thisAccount ? <span className="chip">Account: {thisAccount.address}</span> : null}
        {filtered ? <a className="small clear-filters" href={"#" + listUrl({})}>Clear filters</a> : null}
      </div>

      {!accounts.length && !local ? <Notice>No email account connected yet. <a href="#/settings">Connect one in Settings</a> to start syncing.</Notice> : null}
      {review ? (
        <Notice>
          <a href="#/review">{review} email{review !== 1 ? "s" : ""} need{review !== 1 ? "" : "s"} review</a>. We weren't sure which application {review !== 1 ? "they belong" : "it belongs"} to.
        </Notice>
      ) : null}

      <BulkBar db={db} selection={selection} />

      <div className="card list-card">
        <table className="list" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader" data-col="select"><SelectAll selection={selection} disabled={!rows.length} /></th>
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
                <AppRow key={r.id} db={db} navigate={navigate} r={r} columns={columns} isOpen={isOpen} selected={selection.has(r.id)} today={today}
                        href={"#" + listUrl({ stage, q, account, followUp, ...sorting, open: isOpen ? open.filter((x) => x !== r.id) : [...open, r.id] })}
                        onToggleOpen={onToggleOpen} onToggleSelect={selection.toggle} />
              );
            })}
            {!rows.length ? (
              <tr role="row">
                <td role="cell" colSpan={columns.length + 1} className="muted list-empty">
                  {filtered ? "No applications match these filters." : (local ? <>No applications yet. Choose "Add application" to add one, or load the demo data from the banner above.</> : <>No applications yet. <a href="#/settings">Sync your mailbox in Settings</a>, or choose "Add application" to add one.</>)}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

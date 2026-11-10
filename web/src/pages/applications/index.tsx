import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from "react";
import type { PageProps } from "../../app/pageProps";
import { useQuery } from "../../app/useQuery";
import { BookmarkletCard } from "../../components/BookmarkletCard";
import { ReviewBanner } from "../../components/ReviewBanner";
import { BulkBar } from "../../components/bulk/BulkBar";
import { SelectAll } from "../../components/bulk/SelectBoxes";
import { useSelection } from "../../components/bulk/useSelection";
import { BulkAdd } from "../../components/bulkadd/BulkAdd";
import { ResumeSelect } from "../../components/bulkadd/ResumeSelect";
import { CalendarView } from "../../components/calendar/CalendarView";
import { Combobox } from "../../components/Combobox";
import { DuplicateNotice } from "../../components/duplicates/DuplicateNotice";
import { useDuplicates } from "../../components/duplicates/useDuplicates";
import { FollowUpToggle } from "../../components/followup/FollowUpToggle";
import { GhostedToggle } from "../../components/ghosted/GhostedToggle";
import { WeeklyGoal } from "../../components/goal/WeeklyGoal";
import { JobLinkField } from "../../components/joblink/JobLinkField";
import type { JobDraft } from "../../jobs/types";
import type { JobLinkDeps } from "../../components/joblink/deps";
import { realJobLinkDeps } from "../../components/joblink/deps";
import { useJobLink } from "../../components/joblink/useJobLink";
import { Notice } from "../../components/Notice";
import { CompareOffers } from "../../components/offers/CompareOffers";
import { SaveViewForm } from "../../components/savedviews/SaveViewForm";
import { useSavedViews } from "../../components/savedviews/useSavedViews";
import { ViewChips } from "../../components/savedviews/ViewChips";
import { ShortcutHelp } from "../../components/shortcuts/ShortcutHelp";
import type { ShortcutAction } from "../../components/shortcuts/keys";
import { useShortcuts } from "../../components/shortcuts/useShortcuts";
import { ComingUp } from "../../components/upcoming/ComingUp";
import { useAction } from "../../components/useAction";
import { isLocalUser } from "../../app/localUser";
import { listAccounts } from "../../db/repo";
import type { JobTrackerDB } from "../../db/schema";
import { STAGES, isStage, type Stage } from "../../db/stages";
import { MAX_COMPANY_CHARS, MAX_ROLE_CHARS, MAX_URL_CHARS } from "../../db/limits";
import { isDayString, localToday } from "../../db/time";
import { addApplication as realAddApplication, type AddApplicationInput } from "../../sync/actions";
import { liveResumes } from "../../sync/documents";
import { calendarEvents, calendarSteps, type CalendarEvent } from "../../sync/calendar";
import { gridRange, parseMonth } from "../../sync/calendarGrid";
import { DEFAULT_DIR, SORT_COLUMNS, listApplications, stageCounts, suggestions, type SortColumn } from "../../sync/queries";
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
  ghosted: boolean;
  /** a resume version's id, "none" for no resume set, or "" for any */
  resume: string;
  open: number[];
  /** "calendar" or the default "list" (left out of the address) */
  view: string;
  /** the calendar's month, YYYY-MM; "" is the current month */
  month: string;
  /** the calendar's chosen day, YYYY-MM-DD, or "" */
  day: string;
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
  if (s.ghosted) p.set("ghosted", "1");
  if (s.resume) p.set("resume", s.resume);
  if (s.open?.length) p.set("open", s.open.join(","));
  if (s.view === "calendar") {
    p.set("view", "calendar");
    if (s.month) p.set("month", s.month);
    if (s.day) p.set("day", s.day);
  }
  const qs = p.toString();
  return qs ? `/?${qs}` : "/";
}

/** "none" or a whole-number resume id from the address; anything else is no filter. */
const readResume = (raw: string | null): string => (raw === "none" || (raw !== null && /^[1-9]\d{0,15}$/.test(raw)) ? raw : "");

/** The last "Resume sent" choice, kept for this tab and this account's database only. */
const lastResumeKey = (db: JobTrackerDB) => `jobtracker:lastResume:${db.name}`;
function readLastResume(db: JobTrackerDB): string {
  try {
    return sessionStorage.getItem(lastResumeKey(db)) ?? "";
  } catch {
    return "";
  }
}
function rememberResume(db: JobTrackerDB, value: string): void {
  try {
    sessionStorage.setItem(lastResumeKey(db), value);
  } catch {
    // a browser that won't keep it just starts from None next time
  }
}

/** The job posting text a draft carries (JobDraft.description), or "". */
const descriptionOf = (draft: JobDraft | null): string => draft?.description?.trim() ?? "";

/** The attribute the stylesheet hangs the phone layout on: last activity is `last_activity` there. */
const dataCol = (c: ColumnId): string => (c === "lastActivity" ? "last_activity" : c);

function readState(query: URLSearchParams, today: string): ListState {
  const sort = query.get("sort") ?? "";
  const dir = query.get("dir") ?? "";
  // A day in the address names its own month when there is none, and a day the grid doesn't show is dropped.
  const rawDay = query.get("day") ?? "";
  const rawMonth = query.get("month");
  const month = rawMonth ? parseMonth(rawMonth, today) : isDayString(rawDay) ? rawDay.slice(0, 7) : "";
  const { from, to } = gridRange(month || today.slice(0, 7));
  return {
    view: query.get("view") === "calendar" ? "calendar" : "list",
    month,
    day: isDayString(rawDay) && rawDay >= from && rawDay <= to ? rawDay : "",
    stage: isStage(query.get("stage")) ? (query.get("stage") as Stage) : "",
    q: query.get("q") ?? "",
    account: Number(query.get("account")) || 0,
    sort: SORT_COLUMNS.includes(sort as SortColumn) ? sort : "",
    dir: dir === "asc" || dir === "desc" ? dir : "",
    followUp: query.get("followUp") === "1",
    ghosted: query.get("ghosted") === "1",
    resume: readResume(query.get("resume")),
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
  const today = localToday();
  const state = readState(query, today);
  const { stage, q, account, followUp, ghosted, resume, open, view, day } = state;
  const calendar = view === "calendar";
  const month = state.month || today.slice(0, 7);
  /** the calendar's place in the address: spread into every navigation, so no link or button can drop the view */
  const keep = { view, month: state.month, day };
  /** the filters in the address, for every link and navigation that must keep them */
  const filters = { stage, q, account, followUp, ghosted, resume };
  const sort = (state.sort || "lastActivity") as SortColumn;
  const dir = state.dir || DEFAULT_DIR[sort];

  const data = useQuery(async () => {
    const rows = await listApplications(db, { stage, q, account, followUp, ghosted, resume, sort, dir });
    const counts = await stageCounts(db);
    return {
      rows, counts, accounts: await listAccounts(db),
      columns: (await loadSettings(db)).appearance.columns, suggestions: await suggestions(db),
      resumes: (await liveResumes(db)).map(({ id, title, master }) => ({ id, title, master })),
    };
  }, [db, stage, q, account, followUp, ghosted, resume, sort, dir], { keepPrevious: true });   // a filter change keeps the old rows until the new ones arrive

  // The ticked rows live here, not in the address, and are dropped when the filters change.
  const selection = useSelection(data?.rows, JSON.stringify([stage, q, account, followUp, ghosted, resume]));

  // The filter form edits drafts; Apply filters (or picking a suggestion) puts them in the address.
  const [draftQ, setDraftQ] = useState(q);
  const [draftStage, setDraftStage] = useState<string>(stage);
  const [draftAccount, setDraftAccount] = useState(account);
  const [draftFollowUp, setDraftFollowUp] = useState(followUp);
  const [draftGhosted, setDraftGhosted] = useState(ghosted);
  const [draftResume, setDraftResume] = useState(resume);
  useEffect(() => setDraftQ(q), [q]);
  useEffect(() => setDraftStage(stage), [stage]);
  useEffect(() => setDraftAccount(account), [account]);
  useEffect(() => setDraftFollowUp(followUp), [followUp]);
  useEffect(() => setDraftGhosted(ghosted), [ghosted]);
  useEffect(() => setDraftResume(resume), [resume]);

  const sorting = { sort: state.sort, dir: state.dir };
  const apply = (e?: FormEvent) => {
    e?.preventDefault();
    navigate(listUrl({ stage: draftStage, q: draftQ, account: draftAccount, followUp: draftFollowUp, ghosted: draftGhosted, resume: draftResume, ...sorting, ...keep }));
  };
  const setOpen = (ids: number[]) => navigate(listUrl({ ...filters, ...sorting, ...keep, open: ids }), { replace: true });

  // The calendar: the page's filtered rows plus the steps logged in the grid's days. Moving around it replaces the history entry.
  const range = useMemo(() => gridRange(month), [month]);
  const steps = useQuery(() => (calendar ? calendarSteps(db, range.from, range.to) : []), [db, calendar, range.from, range.to], { keepPrevious: true });
  const dataRows = data?.rows;
  const events = useMemo<ReadonlyMap<string, readonly CalendarEvent[]>>(
    () => (calendar && dataRows ? calendarEvents(dataRows, steps ?? [], today, range) : new Map()), [calendar, dataRows, steps, today, range]);
  const calendarUrl = (o: { month: string; day: string }) => listUrl({ ...filters, ...sorting, ...keep, ...o });
  const goMonth = (m: string) => {
    const { from, to } = gridRange(m);
    navigate(calendarUrl({ month: m, day: day >= from && day <= to ? day : "" }), { replace: true });
  };
  const pickDay = (d: string) => navigate(calendarUrl({ month: d.slice(0, 7), day: d }), { replace: true });
  const toggle = (id: number) => setOpen(open.includes(id) ? open.filter((x) => x !== id) : [...open, id]);
  // Rows are memoised, so the callback they get must keep its identity: it reads the latest `toggle` through a ref.
  const toggleRef = useRef(toggle);
  useLayoutEffect(() => {
    toggleRef.current = toggle;
  });
  const onToggleOpen = useCallback((id: number) => toggleRef.current(id), []);

  // Add an application by hand: one button opens the form under the filter card
  const add = useAction();
  /** the application just added, when the Added notice can offer to tailor your resume for it (it has posting text and there is a master resume) */
  const [tailorFor, setTailorFor] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [postingUrl, setPostingUrl] = useState("");
  const [addStage, setAddStage] = useState<Stage>("Applied");
  const [appliedOn, setAppliedOn] = useState(localToday());
  // "Resume sent" starts as the one last used, and a version that has gone since reads as None.
  const [addResume, setAddResume] = useState(() => readLastResume(db));
  useEffect(() => setAddResume(readLastResume(db)), [db]);
  const addBox = useRef<HTMLElement>(null);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const companyInput = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  // The posting text a link or pasted text brought in (a draft's description), kept for the save. The job-link hook doesn't hand drafts
  // back, so the library calls it makes are watched here.
  const posting = useRef("");
  const lib = { ...realJobLinkDeps, ...deps };
  const watched: Partial<JobLinkDeps> = {
    ...deps,
    parseJobUrl: (url) => {
      const draft = lib.parseJobUrl(url);
      posting.current = descriptionOf(draft);
      return draft;
    },
    enrichJobDraft: async (draft, opts) => {
      const enriched = await lib.enrichJobDraft(draft, opts);
      if (!opts?.signal?.aborted && descriptionOf(enriched)) posting.current = descriptionOf(enriched);
      return enriched;
    },
    parsePastedText: (text, url) => {
      const draft = lib.parsePastedText(text, url);
      if (draft) posting.current = descriptionOf(draft);
      return draft;
    },
  };
  const link = useJobLink({ company, role, url: postingUrl }, { company: setCompany, role: setRole, url: setPostingUrl }, watched);
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
    posting.current = "";
    setAddOpen(false);
    addTrigger.current?.focus();
  };

  // The Save to Job Tracker bookmarklet sends the page you were viewing as #/?add=1&c=...: open the form filled in. It never saves.
  const arrival = useRef("");
  useEffect(() => {
    if (query.get("add") !== "1" || arrival.current === query.toString()) return;
    arrival.current = query.toString();
    const draft = lib.draftFromHash(query);
    if (draft) {
      add.clear();
      posting.current = descriptionOf(draft);
      link.adopt(draft);
      wantFocus.current = draft.company.trim() && draft.role.trim() ? "save" : "company";
      setAddOpen(true);
      setFocusAdd((n) => n + 1);
    }
    // Take the bookmarklet's parameters out of the address either way, so a reload does not open it again.
    navigate(listUrl({ ...filters, ...sorting, ...keep, open }), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Only a master resume makes versions to choose from: without one the select offers None and "Add your resume".
  const resumes = data?.resumes.some((r) => r.master) ? data.resumes : [];
  const sentResume = resumes.some((r) => String(r.id) === addResume) ? addResume : "";
  const chooseResume = (value: string) => {
    setAddResume(value);
    rememberResume(db, value);
  };
  const submitAdd = (e: FormEvent) => {
    e.preventDefault();
    void add.run("add", async () => {
      const input: AddApplicationInput = {
        company, role, stage: addStage, appliedOn, url: postingUrl.trim() || undefined,
        ...(posting.current ? { postingText: posting.current } : {}),
        ...(sentResume ? { resumeId: Number(sentResume) } : {}),
      };
      setTailorFor(null);
      const id = await addApplication(db, input);
      if (posting.current && resumes.some((r) => r.master)) setTailorFor(id);
      const added = company.trim();
      link.reset();
      posting.current = "";
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

  // Saved views: the "Save this view" form opens under the filter card, the chips sit above the list.
  const [saveOpen, setSaveOpen] = useState(false);
  // Closing the form (Cancel, Escape, or saved) puts focus back on the button that opened it, which stays on the page.
  const saveTrigger = useRef<HTMLButtonElement>(null);
  const closeSave = () => {
    saveTrigger.current?.focus();
    setSaveOpen(false);
  };
  const views = useSavedViews(db);

  // The row the keyboard is on. It follows focus (a click or Tab into a row makes it current), and j and k move it. Rows are
  // memoised, so only the row that gains it and the one that loses it redraw.
  const [current, setCurrent] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpFrom = useRef<HTMLElement | null>(null);
  const helpButton = useRef<HTMLButtonElement>(null);
  const openHelp = (from?: HTMLElement) => {
    helpFrom.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setHelpOpen(true);
  };
  const listBody = useRef<HTMLTableSectionElement>(null);
  // The calendar has no rows, so the row shortcuts find nothing to act on and leave their keys alone.
  const rowIds = calendar ? [] : data?.rows.map((r) => r.id) ?? [];
  const currentId = current !== null && rowIds.includes(current) ? current : null;
  const onRowFocus = (e: FocusEvent<HTMLElement>) => {
    const id = Number((e.target as Element).closest<HTMLElement>("tr[data-id]")?.dataset.id);
    if (id) setCurrent((was) => (was === id ? was : id));
  };
  /** The row focus is in, else the current row: where j and k start from. */
  const rowInFocus = (): number | null => {
    const id = Number((document.activeElement as Element | null)?.closest<HTMLElement>("tr[data-id]")?.dataset.id);
    return id && rowIds.includes(id) ? id : currentId;
  };
  const moveTo = (id: number) => {
    setCurrent(id);
    // Focus goes to the row's company link: it has the application's name, says whether it is open, and Enter on it works by itself.
    const link = listBody.current?.querySelector<HTMLElement>(`a.expander[data-id="${id}"]`);
    link?.focus();
    link?.scrollIntoView?.({ block: "nearest" });
  };
  const onShortcut = (action: ShortcutAction): boolean | void => {
    if (helpOpen) {
      // The help dialog traps the keyboard; Escape (or ? again) is the only key the page answers while it is up.
      if (action !== "clear" && action !== "help") return false;
      setHelpOpen(false);
      return;
    }
    const at = rowInFocus();
    switch (action) {
      case "focusSearch": {
        const box = document.getElementById("f-q") as HTMLInputElement | null;
        box?.focus();
        box?.select();
        return;
      }
      case "next":
      case "prev": {
        if (!rowIds.length) return false;
        const i = at === null ? -1 : rowIds.indexOf(at);
        moveTo(rowIds[action === "next" ? Math.min(i + 1, rowIds.length - 1) : i < 0 ? rowIds.length - 1 : Math.max(i - 1, 0)]);
        return;
      }
      case "toggleOpen":
        if (at === null) return false;
        toggle(at);
        return;
      case "select":
        if (at === null) return false;
        selection.toggle(at);
        return;
      case "add":
        openAdd();
        return;
      case "goSettings":
        navigate("/settings");
        return;
      case "goResume":
        navigate("/resume");
        return;
      case "clear":
        if (currentId === null) return false;
        setCurrent(null);
        if ((document.activeElement as Element | null)?.closest("tr[data-id]")) (document.activeElement as HTMLElement).blur();
        return;
      case "help":
        openHelp();
        return;
    }
  };
  useShortcuts(onShortcut);

  if (!data) return <h1 className="page">Applications</h1>;
  const { rows, counts, accounts, columns, suggestions: suggest, resumes: allResumes } = data;
  const total = STAGES.reduce((n, s) => n + counts[s], 0);
  const filtered = Boolean(stage || q.trim() || account || followUp || ghosted || resume);
  const thisAccount = accounts.find((a) => a.id === account);
  const resumeTitle = (id: string): string | undefined => allResumes.find((r) => String(r.id) === id)?.title;
  // "Save this view" is offered only when what the form shows (or the sort) differs from the plain list: there is nothing to save otherwise.
  const differs = Boolean(draftStage || draftQ.trim() || draftAccount || draftFollowUp || draftGhosted || draftResume || state.sort || state.dir);

  const sortHref = (c: ColumnId) =>
    "#" + listUrl({ ...filters, ...keep, sort: c, dir: sort === c ? (dir === "asc" ? "desc" : "asc") : DEFAULT_DIR[c] });

  return (
    <>
      <div className="page-head">
        <h1 className="page">Applications</h1>
        <div className="page-actions">
          <button type="button" ref={addTrigger} aria-expanded={addOpen} aria-controls="add-application" onClick={openAdd}>Add application</button>
          <nav className="tabs view-tabs" aria-label="View">
            <a href={"#" + listUrl({ ...filters, ...sorting })} className="tab" aria-current={!calendar ? "true" : undefined}>List</a>
            <a href={"#" + listUrl({ ...filters, ...sorting, view: "calendar" })} className="tab" aria-current={calendar ? "true" : undefined}>Calendar</a>
          </nav>
        </div>
      </div>
      <ReviewBanner db={db} />
      {filtered || calendar ? null : <ComingUp rows={rows} today={today} db={db} />}
      <nav className="tabs stage-tabs" aria-label="Filter by stage">
        <a href={"#" + listUrl({ ...keep })} className="tab" aria-current={!stage ? "true" : undefined}>All <span className="n">{total}</span></a>
        {STAGES.map((s) => (
          <a key={s} href={"#" + listUrl(s === stage ? { ...keep } : { stage: s, ...keep })} className="tab"
             aria-current={s === stage ? "true" : undefined} title={s === stage ? "Choose again to show all stages" : undefined}>
            {s} <span className="n" id={`count-${s}`}>{counts[s]}</span>
          </a>
        ))}
      </nav>

      <div className="card filter-card">
        <form className="row filters" onSubmit={apply}>
          <div className="fgroup f-search">
            <label htmlFor="f-q">Search</label>
            <Combobox id="f-q" value={draftQ} onChange={setDraftQ} suggestions={suggest} placeholder="Company, role, email, note or posting"
                      onChoose={(text) => { setDraftQ(text); navigate(listUrl({ stage: draftStage, q: text, account: draftAccount, followUp: draftFollowUp, ghosted: draftGhosted, resume: draftResume, ...sorting, ...keep })); }} />
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
          {allResumes.length || draftResume ? (
            <div className="fgroup">
              <label htmlFor="f-resume">Resume</label>
              <select id="f-resume" name="resume" value={draftResume} onChange={(e) => setDraftResume(e.target.value)}>
                <option value="">Any resume</option>
                {allResumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                <option value="none">No resume set</option>
                {draftResume && draftResume !== "none" && !resumeTitle(draftResume) ? <option value={draftResume}>(deleted)</option> : null}
              </select>
            </div>
          ) : null}
          <fieldset className="fgroup show-group">
            <legend>Show</legend>
            <div className="show-group-boxes">
              <FollowUpToggle checked={draftFollowUp} onChange={setDraftFollowUp} />
              <GhostedToggle checked={draftGhosted} onChange={setDraftGhosted} />
            </div>
          </fieldset>
          {/* One primary per surface: the open add form owns it, so Apply filters steps down while the form is showing. */}
          <button type="submit" className={addOpen ? undefined : "primary"}>Apply filters</button>
        </form>
      </div>

      {addOpen ? (
        <section className="card" id="add-application" ref={addBox} aria-labelledby="add-application-title" onKeyDown={onAddKey}>
          <h2 className="section" id="add-application-title">Add application</h2>
          <p className="help add-note">Applied somewhere that never emailed you, or the email is in another account? Add it here. It stays yours, so a sync never changes it.</p>
          {add.error ? <Notice tone="err">{add.error}</Notice> : null}
          <form onSubmit={submitAdd}>
            <div className="add-link-slot" id="add-link-slot">
              <JobLinkField link={link} />
            </div>
            <div className="row add-fields">
              <div className="fgroup f-grow">
                <label htmlFor="add-company">Company</label>
                <input id="add-company" name="company" ref={companyInput} required maxLength={MAX_COMPANY_CHARS} pattern=".*\S.*" title="Enter a company name." value={company}
                       aria-describedby={link.hints.company ? "add-company-hint" : undefined}
                       onChange={(e) => { link.edited("company"); setCompany(e.target.value); }} />
                {link.hints.company ? <p className="field-hint" id="add-company-hint">{link.hints.company}</p> : null}
              </div>
              <div className="fgroup f-grow">
                <label htmlFor="add-role">Role (optional)</label>
                <input id="add-role" name="role" value={role} maxLength={MAX_ROLE_CHARS} aria-describedby={link.hints.role ? "add-role-hint" : undefined}
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
              <div className="fgroup">
                <label htmlFor="add-resume">Resume sent</label>
                <ResumeSelect id="add-resume" resumes={resumes} value={sentResume} onChange={chooseResume} onAdd={() => navigate("/resume")} />
              </div>
            </div>
            <div className="row add-url-row">
              <div className="fgroup f-grow">
                <label htmlFor="add-url">Posting link (optional)</label>
                <input id="add-url" name="url" type="text" inputMode="url" autoComplete="off" spellCheck={false} value={postingUrl} maxLength={MAX_URL_CHARS}
                       onChange={(e) => { link.edited("url"); setPostingUrl(e.target.value); }} />
              </div>
            </div>
            <DuplicateNotice matches={duplicates} />
            <div className="row add-actions">
              <button type="submit" className="primary" ref={saveButton} {...add.button("add")}>Save application</button>
              <button type="button" onClick={closeAdd}>Cancel</button>
            </div>
          </form>
          <details className="add-bookmarklet">
            <summary>Save jobs from any site</summary>
            <BookmarkletCard embedded />
          </details>
          <BulkAdd db={db} deps={{ parseJobUrl: lib.parseJobUrl, enrichJobDraft: lib.enrichJobDraft }}
                   resumes={resumes} resume={sentResume} onResume={chooseResume} onAddResume={() => navigate("/resume")} />
        </section>
      ) : add.status ? (
        <Notice>{add.status}{tailorFor !== null ? <> <a href={`#/app/${tailorFor}`}>Tailor your resume for this job</a></> : null}</Notice>
      ) : null}

      {views ? (
        <ViewChips db={db} views={views} currentUrl={listUrl({ ...filters, ...sorting, ...keep })} urlFor={(v) => listUrl({ ...v, ...keep })} navigate={navigate}
                   accountName={(id) => accounts.find((a) => a.id === id)?.address} resumeName={resumeTitle} />
      ) : null}
      {calendar ? null : <CompareOffers db={db} />}

      <div className="status-row">
        <div className="status-main">
          <div className="result-line" role="status">
            <span className="small muted">Showing {rows.length}{filtered ? ` of ${total}` : ""} application{rows.length !== 1 ? "s" : ""}</span>
            {stage ? <span className="chip">Stage: {stage}</span> : null}
            {q.trim() ? <span className="chip">Search: {q.trim()}</span> : null}
            {followUp ? <span className="chip">Needs follow-up</span> : null}
            {ghosted ? <span className="chip">No reply</span> : null}
            {thisAccount ? <span className="chip">Account: {thisAccount.address}</span> : null}
            {resume === "none" ? <span className="chip">No resume set</span> : resume ? <span className="chip">Resume: {resumeTitle(resume) ?? "(deleted)"}</span> : null}
            {filtered ? <a className="small clear-filters" href={"#" + listUrl({ ...keep })}>Clear filters</a> : null}
            {differs || saveOpen ? (
              <button type="button" className="quiet save-view-trigger" ref={saveTrigger} aria-expanded={saveOpen} aria-controls="save-view" onClick={() => setSaveOpen(!saveOpen)}>Save this view</button>
            ) : null}
          </div>
        </div>
        <WeeklyGoal db={db} />
      </div>
      {saveOpen ? (
        <div id="save-view">
          <SaveViewForm db={db} count={views?.length ?? 0} accountName={thisAccount?.address} resumeName={resumeTitle(draftResume)} onClose={closeSave}
                        filters={{ stage: draftStage, q: draftQ.trim(), account: draftAccount, followUp: draftFollowUp, ghosted: draftGhosted, resume: draftResume, sort: state.sort, dir: state.dir }} />
        </div>
      ) : null}

      {!accounts.length && !local ? <Notice>No email account connected yet. <a href="#/settings">Connect one in Settings</a> to start syncing.</Notice> : null}

      {calendar ? (
        <CalendarView month={month} today={today} day={day} events={events} onMonth={goMonth} onSelectDay={pickDay} />
      ) : <>
      <BulkBar db={db} selection={selection} resumes={allResumes} />

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
          <tbody role="rowgroup" ref={listBody} onFocus={onRowFocus}>
            {rows.map((r) => {
              const isOpen = open.includes(r.id);
              return (
                <AppRow key={r.id} db={db} navigate={navigate} r={r} columns={columns} isOpen={isOpen} selected={selection.has(r.id)} today={today}
                        current={r.id === currentId}
                        href={"#" + listUrl({ ...filters, ...sorting, ...keep, open: isOpen ? open.filter((x) => x !== r.id) : [...open, r.id] })}
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
      </>}

      <p className="page-foot">
        <button type="button" className="quiet" ref={helpButton} aria-haspopup="dialog" onClick={(e) => openHelp(e.currentTarget)}>Keyboard shortcuts</button>
      </p>
      {helpOpen ? <ShortcutHelp onClose={() => setHelpOpen(false)} returnTo={helpFrom.current} fallback={helpButton.current} /> : null}
    </>
  );
}

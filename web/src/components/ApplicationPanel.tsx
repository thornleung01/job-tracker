import { ArrowUpRight } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import type { JobTrackerDB } from "../db/schema";
import { MAX_NOTE_CHARS } from "../db/limits";
import { localToday } from "../db/time";
import { useQuery } from "../app/useQuery";
import { STEP_GROUPS, addStep, deleteEntry, history, type HistoryItem } from "../sync/activity";
import { deleteApplication, learnedNotice, notAnApplication } from "../sync/actions";
import { documentLine } from "../sync/documentLine";
import { getMaster } from "../sync/documents";
import { titles as contactTitles } from "../sync/contacts";
import { TRASH_DAYS } from "../sync/trash";
import { EmailText } from "./EmailText";
import { ApplicationActions } from "./followup/ApplicationActions";
import { InlineConfirm } from "./InlineConfirm";
import { MailActions } from "./MailActions";
import { MailMeta } from "./MailMeta";
import { Notice } from "./Notice";
import { TimeText, dayText } from "./TimeText";
import { setFlash } from "./flash";
import { announceDeleted } from "./trash/deletedNotice";
import { useAction } from "./useAction";
import "./components.css";
import "./applicationpanel.css";

interface PanelProps {
  db: JobTrackerDB;
  appId: number;
  /** the company name, used to name the "Open full page" link for screen readers */
  company?: string;
  /** the list panel also shows the emails in the history and the Delete controls; the detail page lists emails itself */
  includeEmails: boolean;
  navigate(to: string, opts?: { replace?: boolean }): void;
  /** how many history entries to show */
  limit?: number;
  /** the application is gone (deleted from this panel) */
  onRemoved?(): void;
}

/** Notes, steps and history for one application. Used under each list row and on the detail page. */
export function ApplicationPanel({ db, appId, company, includeEmails, navigate, limit = 20, onRemoved }: PanelProps) {
  const data = useQuery(async () => ({
    ...(await history(db, appId, limit, includeEmails)),
    titles: includeEmails ? await contactTitles(db, appId) : {},
  }), [db, appId, includeEmails, limit], { keepPrevious: true });   // "show more" raises `limit`: keep the list while it loads
  // One quiet line under the actions in list mode: the resume sent and the cover letter, each a way to the detail page.
  const docs = useQuery(async () => {
    if (!includeEmails) return null;
    const line = await documentLine(db, appId);
    return line && { ...line, master: Boolean(await getMaster(db)) };
  }, [db, appId, includeEmails]);
  const act = useAction();
  // The one question open at a time, and the button that asked it (focus goes back there on cancel).
  const [ask, setAsk] = useState<{ kind: "entry"; item: HistoryItem; opener: HTMLElement } | { kind: "delete" | "not"; opener: HTMLElement } | null>(null);
  const statusBox = useRef<HTMLDivElement>(null);
  const today = localToday();
  const [label, setLabel] = useState("");
  const [day, setDay] = useState(today);
  const [body, setBody] = useState("");

  const logStep = (e: FormEvent) => {
    e.preventDefault();
    void act.run("step", async () => {
      const moved = await addStep(db, appId, label, day, body);
      setLabel("");
      setBody("");
      return moved ? "Step logged. The stage was updated." : "Step logged.";
    });
  };
  const removeEntry = (item: HistoryItem) => {
    void act
      .run(`entry-${item.id}`, async () => {
        const gone = await deleteEntry(db, appId, item.id);
        setAsk(null);
        return gone ? "Entry deleted." : "That entry was already gone.";
      })
      // The Delete button that was pressed is gone, so the result takes focus.
      .then((ok) => ok && statusBox.current?.focus());
  };
  const remove = () => {
    void act.run("delete", async () => {
      await deleteApplication(db, appId, "clear");
      announceDeleted(company || "the application", [appId]);
      setAsk(null);
      onRemoved?.();
    });
  };
  const notApplication = () => {
    void act.run("not", async () => {
      const done = await notAnApplication(db, appId);
      setFlash(learnedNotice(done.rules, done.cleared, `Removed ${done.company}.`));
      navigate("/review");
    });
  };

  // Under a list row the panel sits right below the page heading, so its headings are level 2. On the detail page they sit under "Notes and steps".
  const Heading = includeEmails ? "h2" : "h3";
  const items = data?.items ?? [];
  const latestEmail = items.find((i) => i.kind === "email")?.id;
  const stepId = `step-label-${appId}`;

  return (
    <div className="panel-inner" data-app={appId}>
      <div className="panel-status small muted" role="status" tabIndex={-1} ref={statusBox}>{act.status ?? ""}</div>
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}

      <div className="panel-split">
      <div className="panel-forms">
        <form onSubmit={logStep}>
          <Heading className="panel-h">Log a step</Heading>
          <div className="row row-end">
            <div className="f-grow step-field">
              <label className="field small" htmlFor={stepId}>Step</label>
              <select id={stepId} name="label" required value={label} onChange={(e) => setLabel(e.target.value)}>
                <option value="" hidden>Choose a step</option>
                {STEP_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.steps.map((s) => <option key={s} value={s}>{s}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="field small" htmlFor={`step-day-${appId}`}>Date</label>
              <input id={`step-day-${appId}`} type="date" name="day" value={day} max={today} onChange={(e) => setDay(e.target.value)} />
            </div>
          </div>
          <label className="field small stack-top-sm" htmlFor={`step-body-${appId}`}>Note (optional)</label>
          <textarea id={`step-body-${appId}`} name="body" rows={2} maxLength={MAX_NOTE_CHARS} className="step-note" value={body} onChange={(e) => setBody(e.target.value)} />
          <button type="submit" className="primary" {...act.button("step")}>Log step</button>
        </form>
      </div>

      <div className="panel-history">
      <Heading className="panel-h panel-h-history">History</Heading>
      {data && !items.length ? <p className="muted small">Nothing logged yet. Log a step above, with a note if you like.</p> : null}
      {items.length ? (
        <>
          <ol className="hist">
            {items.map((i) => (
              <li key={`${i.kind}-${i.id}`}>
                {i.kind === "email" ? (
                  <EmailEntry item={i} titles={data?.titles ?? {}} latest={i.id === latestEmail} />
                ) : (
                  <>
                    <div className="hist-head">
                      <span className={`tag tag-${i.kind}`}>{i.kind === "note" ? "Note" : "Step"}</span>
                      {i.kind === "note" ? <span className="hist-text">{i.body}</span> : <strong>{i.title}</strong>}
                      <span className="small muted hist-date">{dayText(i.when, "short")}</span>
                      <button type="button" className="danger small hist-del" aria-label={`Delete ${i.kind} from ${dayText(i.when)}`}
                              onClick={(e) => setAsk({ kind: "entry", item: i, opener: e.currentTarget })} {...act.button(`entry-${i.id}`)}>Delete</button>
                    </div>
                    {i.kind === "step" && i.body ? <div className="hist-body">{i.body}</div> : null}
                    {ask?.kind === "entry" && ask.item.id === i.id && ask.item.kind === i.kind ? (
                      <InlineConfirm
                        title={`Delete this ${i.kind}?`}
                        help="A stage change it made stays."
                        confirmLabel={`Delete ${i.kind}`}
                        onConfirm={() => removeEntry(i)}
                        onCancel={() => setAsk(null)}
                        act={act}
                        actionKey={`entry-${i.id}`}
                        opener={ask.opener}
                      />
                    ) : null}
                  </>
                )}
              </li>
            ))}
          </ol>
          {data && data.total > items.length ? (
            <p className="small muted">
              Showing the latest {items.length} of {data.total}.{includeEmails ? <> <a href={`#/app/${appId}`}>Open the full page</a> for the rest.</> : null}
            </p>
          ) : null}
        </>
      ) : null}
      </div>
      </div>

      {includeEmails ? <ApplicationActions db={db} appId={appId} /> : null}
      {includeEmails ? (
        <div className="panel-actions">
          <a className="btn small open-full" href={`#/app/${appId}`} aria-label={company ? `Open full page for ${company}` : undefined}>
            Open full page
            <ArrowUpRight className="ico" size={16} strokeWidth={3} aria-hidden="true" focusable="false" />
          </a>
          <button type="button" className="danger small" aria-label={company ? `Delete application ${company}` : undefined} onClick={(e) => setAsk({ kind: "delete", opener: e.currentTarget })} {...act.button("delete")}>Delete application</button>
          <button type="button" className="danger small" aria-label={company ? `Not an application: ${company}` : undefined} title="Removes it and learns to ignore emails like the ones that made it."
                  onClick={(e) => setAsk({ kind: "not", opener: e.currentTarget })} {...act.button("not")}>Not an application</button>
        </div>
      ) : null}
      {docs ? (
        <p className="small muted panel-docs">
          {docs.resume !== null ? <>Resume: <a href={`#/app/${appId}`}>{docs.resume}</a></> : null}
          {docs.resume !== null ? " \u00b7 " : null}
          <a href={`#/app/${appId}`}>{docs.cover ? "Cover letter" : "Write a cover letter"}</a>
          {docs.master && !docs.tailored ? <>{" \u00b7 "}<a href={`#/tailor/${appId}`}>Tailor for this job</a></> : null}
        </p>
      ) : null}
      {ask?.kind === "delete" ? (
        <InlineConfirm
          title={company ? `Delete ${company}?` : "Delete this application?"}
          help={`You can restore it for ${TRASH_DAYS} days.`}
          confirmLabel="Delete application"
          onConfirm={remove}
          onCancel={() => setAsk(null)}
          act={act}
          actionKey="delete"
          opener={ask.opener}
        />
      ) : null}
      {ask?.kind === "not" ? (
        <InlineConfirm
          title="Remove this and teach the app it wasn't a job application?"
          help="Emails like it will be ignored from now on."
          confirmLabel="Remove and ignore emails like it"
          onConfirm={notApplication}
          onCancel={() => setAsk(null)}
          act={act}
          actionKey="not"
          opener={ask.opener}
        />
      ) : null}
    </div>
  );
}

function EmailEntry({ item: i, titles, latest }: { item: HistoryItem; titles: Record<string, string>; latest: boolean }) {
  return (
    <details className="mail">
      <summary className="hist-head">
        <span className="chev" aria-hidden="true"></span>
        <span className="tag tag-email">Email</span>
        <strong>{i.title}</strong>
        {i.detail ? <span className="small muted">(read as {i.detail})</span> : null}
        {latest ? <span className="tag latest">Latest</span> : null}
        <span className="small muted hist-date"><TimeText iso={i.when} format="short" /></span>
      </summary>
      <div className="mail-body">
        <MailMeta sender={i.sender ?? ""} titles={titles}>
          <TimeText iso={i.when} relative /> {"·"} {i.account}
        </MailMeta>
        <EmailText body={i.body} />
        {i.truncated ? <p className="small muted note-tight">Only the first part of the email is stored here.</p> : null}
        <MailActions open={i.open} reply={i.reply} />
      </div>
    </details>
  );
}

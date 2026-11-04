import { useState, type FormEvent } from "react";
import type { JobTrackerDB } from "../db/schema";
import { localToday } from "../db/time";
import { useQuery } from "../app/useQuery";
import { STEP_GROUPS, addStep, deleteEntry, history, type HistoryItem } from "../sync/activity";
import { deleteApplication, learnedNotice, notAnApplication } from "../sync/actions";
import { titles as contactTitles } from "../sync/contacts";
import { EmailText } from "./EmailText";
import { MailActions } from "./MailActions";
import { MailMeta } from "./MailMeta";
import { Notice } from "./Notice";
import { TimeText } from "./TimeText";
import { setFlash } from "./flash";
import { useAction } from "./useAction";
import "./components.css";

interface PanelProps {
  db: JobTrackerDB;
  appId: number;
  /** the list panel also shows the emails in the history and the Delete controls; the detail page lists emails itself */
  includeEmails: boolean;
  navigate(to: string, opts?: { replace?: boolean }): void;
  /** how many history entries to show */
  limit?: number;
  /** the application is gone (deleted from this panel) */
  onRemoved?(): void;
}

/** Notes, steps and history for one application. Used under each list row and on the detail page. */
export function ApplicationPanel({ db, appId, includeEmails, navigate, limit = 20, onRemoved }: PanelProps) {
  const data = useQuery(async () => ({
    ...(await history(db, appId, limit, includeEmails)),
    titles: includeEmails ? await contactTitles(db, appId) : {},
  }), [db, appId, includeEmails, limit]);
  const act = useAction();
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
    if (!window.confirm(`Delete this ${item.kind}? A stage change it made stays.`)) return;
    void act.run(`entry-${item.id}`, async () => ((await deleteEntry(db, appId, item.id)) ? "Entry deleted." : "That entry was already gone."));
  };
  const remove = () => {
    if (!window.confirm("Delete this application? Its notes, steps and saved emails are removed from the app. Your mailbox is not touched.")) return;
    void act.run("delete", async () => {
      await deleteApplication(db, appId, "clear");
      onRemoved?.();
    });
  };
  const notApplication = () => {
    if (!window.confirm("Remove this and teach the app it was not a job application? Mail like it will be ignored from now on.")) return;
    void act.run("not", async () => {
      const done = await notAnApplication(db, appId);
      setFlash(learnedNotice(done.rules, done.cleared, `Removed ${done.company}.`));
      navigate("/review");
    });
  };

  const items = data?.items ?? [];
  const latestEmail = items.find((i) => i.kind === "email")?.id;
  const stepId = `step-label-${appId}`;

  return (
    <div className="panel-inner" data-app={appId}>
      <div className="panel-status small muted" role="status" tabIndex={-1}>{act.status ?? ""}</div>
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}

      <div className="panel-forms">
        <form onSubmit={logStep}>
          <h3 className="panel-h">Log a step</h3>
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
          <textarea id={`step-body-${appId}`} name="body" rows={2} maxLength={2000} className="step-note" value={body} onChange={(e) => setBody(e.target.value)} />
          <p className="help flush">Choosing a stage (like Interview) also moves the application to it. Other steps only go in the history.</p>
          <button type="submit" className="primary" {...act.button("step")}>Log step</button>
        </form>
      </div>

      <h3 className="panel-h panel-h-history">History</h3>
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
                      <span className="small muted hist-date">{i.when.slice(0, 10)}</span>
                      <button type="button" className="danger small hist-del" aria-label={`Delete ${i.kind} from ${i.when.slice(0, 10)}`}
                              onClick={() => removeEntry(i)} {...act.button(`entry-${i.id}`)}>Delete</button>
                    </div>
                    {i.kind === "step" && i.body ? <div className="hist-body">{i.body}</div> : null}
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

      {includeEmails ? (
        <div className="panel-danger">
          <button type="button" className="danger small" onClick={remove} {...act.button("delete")}>Delete</button>
          <button type="button" className="danger small" title="Removes it and learns to ignore mail like the emails that made it"
                  onClick={notApplication} {...act.button("not")}>Not an application</button>
        </div>
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
        {i.detail ? <span className="small muted">(detected: {i.detail})</span> : null}
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

import { useEffect, useState, type FormEvent } from "react";
import type { PageProps } from "../../app/pageProps";
import { useQuery } from "../../app/useQuery";
import { ApplicationPanel } from "../../components/ApplicationPanel";
import { EmailText } from "../../components/EmailText";
import { MailActions } from "../../components/MailActions";
import { MailMeta } from "../../components/MailMeta";
import { Notice } from "../../components/Notice";
import { PersonCard } from "../../components/PersonCard";
import { StageBadge } from "../../components/StageBadge";
import { TimeText } from "../../components/TimeText";
import { setFlash } from "../../components/flash";
import { useAction } from "../../components/useAction";
import { STAGES, type Stage } from "../../db/stages";
import {
  deleteApplication, editApplication, learnedNotice, mergeApplications, notAnApplication, setStage, unlockStage,
} from "../../sync/actions";
import { mailboxLink, replyLink } from "../../sync/links";
import { applicationDetail } from "../../sync/queries";
import "./detail.css";

const UNKNOWN_ROLE = "Unknown role";

const eventLabel = (event: string): string => {
  const words = event.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export default function DetailPage({ db, params, query, navigate }: PageProps) {
  const id = Number(params.id);
  const data = useQuery(() => applicationDetail(db, id), [db, id]);
  const act = useAction();
  const [notice, setNotice] = useState<string | null>(null);

  const app = data?.application;
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [stage, setStageChoice] = useState<Stage>("Applied");
  const [mergeInto, setMergeInto] = useState(0);
  // Fill the forms when the application first arrives, and again when it changes under them (a merge, a rename elsewhere).
  const seen = app ? `${app.id}|${app.company}|${app.role}|${app.stage}` : "";
  useEffect(() => {
    if (!app) return;
    setCompany(app.company);
    setRole(app.role === UNKNOWN_ROLE ? "" : app.role);
    setStageChoice(app.stage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen]);
  const firstOther = data?.others[0]?.id ?? 0;
  useEffect(() => {
    setMergeInto((cur) => (data?.others.some((o) => o.id === cur) ? cur : firstOther));
  }, [data?.others, firstOther]);

  // Arriving from a person's email list: bring that email into view.
  const wanted = query.get("email");
  useEffect(() => {
    if (!wanted || !data) return;
    document.getElementById(`email-${wanted}`)?.scrollIntoView?.({ block: "start" });
  }, [wanted, data !== undefined && data !== null]);

  if (data === undefined) return <a className="back" href="#/"><span className="chev" aria-hidden="true"></span>All applications</a>;
  if (data === null || !app) {
    return (
      <>
        <a className="back" href="#/"><span className="chev" aria-hidden="true"></span>All applications</a>
        <h1 className="page detail-missing">Application not found</h1>
        <p className="muted">It may have been deleted or merged into another one.</p>
      </>
    );
  }

  const latestEmailId = data.emails[0]?.id;
  const say = (message: string) => setNotice(message);

  const saveCompany = (e: FormEvent) => {
    e.preventDefault();
    void act.run("edit", async () => {
      await editApplication(db, id, company, role);
      return "Saved.";
    });
  };
  const changeStage = (e: FormEvent) => {
    e.preventDefault();
    void act.run("stage", async () => {
      await setStage(db, id, stage);
      return `Stage set to ${stage}. Syncs won't change it.`;
    });
  };
  const unlock = () => act.run("unlock", async () => {
    await unlockStage(db, id);
    return "Unlocked. Mail can move the stage again.";
  });
  const merge = (e: FormEvent) => {
    e.preventDefault();
    const target = data.others.find((o) => o.id === mergeInto);
    if (!target || !window.confirm(`Merge ${app.company} into ${target.company} (${target.role})? Its emails, notes and steps move across and this application is removed.`)) return;
    void act.run("merge", async () => {
      await mergeApplications(db, id, mergeInto);
      navigate(`/app/${mergeInto}`);
    });
  };
  const notApplication = () => {
    if (!window.confirm("Remove this and teach the app it was not a job application? Mail like it will be ignored from now on.")) return;
    void act.run("not", async () => {
      const done = await notAnApplication(db, id);
      setFlash(learnedNotice(done.rules, done.cleared, `Removed ${done.company}.`));
      navigate("/review");
    });
  };
  const remove = (emails: "clear" | "review") => {
    const sure = emails === "clear"
      ? "Delete this application? Its notes, steps and saved emails are removed from the app. Your mailbox is not touched."
      : "Delete this application and send its emails to Needs review so you can place them yourself?";
    if (!window.confirm(sure)) return;
    void act.run(`delete-${emails}`, async () => {
      await deleteApplication(db, id, emails);
      navigate("/");
    });
  };

  return (
    <>
      <a className="back" href="#/"><span className="chev" aria-hidden="true"></span>All applications</a>
      {notice ? <Notice>{notice}</Notice> : null}
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      {act.status ? <Notice>{act.status}</Notice> : null}

      <div className="card">
        <h1 className="page detail-title">{app.company}</h1>
        <div className="muted">{app.role}</div>
        <div className="row detail-facts">
          <StageBadge stage={app.stage} />
          <span className="small muted">Applied {app.appliedAt ? app.appliedAt.slice(0, 10) : "unknown"} {"·"} last activity {app.lastActivity ? app.lastActivity.slice(0, 10) : "unknown"}</span>
          {app.locked ? <span className="small muted">{"·"} Stage set by you. Syncs won't change it.</span> : null}
        </div>
        <details className="more detail-edit">
          <summary>Edit company or role</summary>
          <form className="row" onSubmit={saveCompany}>
            <label className="sr" htmlFor="ed-company">Company</label>
            <input id="ed-company" name="company" value={company} maxLength={80} required onChange={(e) => setCompany(e.target.value)} />
            <label className="sr" htmlFor="ed-role">Role</label>
            <input id="ed-role" name="role" value={role} maxLength={100} placeholder="Role" onChange={(e) => setRole(e.target.value)} />
            <button type="submit" {...act.button("edit")}>Save</button>
          </form>
        </details>
        <div className="row detail-controls">
          <form onSubmit={changeStage}>
            <select name="stage" aria-label="Set stage" value={stage} onChange={(e) => setStageChoice(e.target.value as Stage)}>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="submit" {...act.button("stage")}>Set stage</button>
          </form>
          {app.locked ? <button type="button" onClick={unlock} {...act.button("unlock")}>Unlock</button> : null}
          {data.others.length ? (
            <form onSubmit={merge}>
              <select name="into" aria-label="Merge into" value={mergeInto} onChange={(e) => setMergeInto(Number(e.target.value))}>
                {data.others.map((o) => <option key={o.id} value={o.id}>{o.company} {"·"} {o.role}</option>)}
              </select>
              <button type="submit" {...act.button("merge")}>Merge into{"…"}</button>
            </form>
          ) : null}
          <button type="button" className="danger" title="Removes it and learns to ignore mail like the emails that made it" onClick={notApplication} {...act.button("not")}>Not an application</button>
          <button type="button" className="danger" onClick={() => remove("clear")} {...act.button("delete-clear")}>Delete</button>
          <button type="button" className="danger" title="Use this when the emails belong to a different application" onClick={() => remove("review")} {...act.button("delete-review")}>Delete, keep emails for review</button>
        </div>
      </div>

      <section className="card" aria-labelledby="h-people">
        <h2 id="h-people" className="section">People</h2>
        {data.people.length ? (
          <>
            <p className="help">Who you've dealt with on this application, and what they do here, from its emails.</p>
            <ul className="people">
              {data.people.map((c) => <li key={c.key}><PersonCard db={db} contact={c} onNotice={say} /></li>)}
            </ul>
          </>
        ) : (
          <p className="muted flush-p">No people yet. A recruiter or interviewer shows up here once their email belongs to this application.</p>
        )}
      </section>

      <section className="card" aria-labelledby="h-notes">
        <h2 id="h-notes" className="section">Notes and steps</h2>
        <ApplicationPanel db={db} appId={id} includeEmails={false} navigate={navigate} limit={1000} />
      </section>

      <h2 className="section spaced">Email timeline <span className="small muted timeline-note">newest first</span></h2>
      {data.emails.map((e) => (
        <article className="card" id={`email-${e.id}`} key={e.id}>
          <header className="mail-head">
            <h3 className="mail-subject">{e.subject || "(no subject)"}</h3>
            <MailMeta sender={e.sender} titles={data.titles}>
              {e.id === latestEmailId ? <><span className="tag latest">Latest</span> </> : null}
              <TimeText iso={e.receivedAt} relative /> {"·"} {e.provider.charAt(0).toUpperCase() + e.provider.slice(1)} {e.address}
            </MailMeta>
            {e.event ? <p className="mail-guess">Read as <b>{eventLabel(e.event)}</b>{e.confidence ? ` (${e.confidence} confidence)` : ""}</p> : null}
          </header>
          <EmailText body={e.body} />
          <MailActions open={mailboxLink(e.provider, e.address, e.threadId, e.webLink)} reply={replyLink(e.provider, e.address, e.sender ?? "", e.subject, e.webLink)} />
        </article>
      ))}
      {!data.emails.length ? <p className="muted">No emails linked{app.manual ? " (added manually)" : ""}.</p> : null}
    </>
  );
}

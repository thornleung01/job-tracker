import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ExternalLink } from "lucide-react";
import type { PageProps } from "../../app/pageProps";
import { useQuery } from "../../app/useQuery";
import { ApplicationPanel } from "../../components/ApplicationPanel";
import type { DocumentsDeps } from "../../components/documents/deps";
import { DocumentsSection } from "../../components/documents/DocumentsSection";
import { resumeLabel } from "../../components/documents/tailorReview";
import { EmailText } from "../../components/EmailText";
import { InlineConfirm } from "../../components/InlineConfirm";
import { MailActions } from "../../components/MailActions";
import { MailMeta } from "../../components/MailMeta";
import { ApplicationActions } from "../../components/followup/ApplicationActions";
import { eventLabel } from "../../components/eventLabel";
import { MoreMenu } from "../../components/detail/MoreMenu";
import { Notice } from "../../components/Notice";
import { PersonCard } from "../../components/PersonCard";
import { OfferDetails, showsOffer } from "../../components/offer/OfferDetails";
import { InterviewRounds } from "../../components/rounds/InterviewRounds";
import { StageBadge } from "../../components/StageBadge";
import { TimeText, dayText } from "../../components/TimeText";
import { setFlash } from "../../components/flash";
import { announceDeleted } from "../../components/trash/deletedNotice";
import { useAction } from "../../components/useAction";
import { useNoticeFocus } from "../../components/useNoticeFocus";
import { MAX_COMPANY_CHARS, MAX_ROLE_CHARS, MAX_URL_CHARS } from "../../db/limits";
import { postingHost, safePostingUrl } from "../../db/postingUrl";
import { UNKNOWN_ROLE } from "../../pipeline/extract";
import { STAGES, type Stage } from "../../db/stages";
import {
  deleteApplication, editApplication, learnedNotice, mergeApplications, notAnApplication, setStage, unlockStage,
} from "../../sync/actions";
import { mailboxLink, replyLink } from "../../sync/links";
import { applicationDetail } from "../../sync/queries";
import { TRASH_DAYS, deletedApplication, restoreApplication } from "../../sync/trash";
import { plural } from "../../sync/text";
import "./detail.css";

export default function DetailPage({ db, params, query, navigate, deps }: PageProps & { deps?: { documents?: Partial<DocumentsDeps> } }) {
  const id = Number(params.id);
  const data = useQuery(() => applicationDetail(db, id), [db, id]);
  // A deleted application has no detail (it is hidden everywhere), but its page says so and offers Restore.
  const gone = useQuery(() => deletedApplication(db, id), [db, id]);
  const justRestored = useRef(false);
  const act = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  const result = useNoticeFocus();

  const app = data?.application;
  // The resume sent, for the header line before an interview. A deleted resume has no line.
  const sentTitle = useQuery(async () => {
    const doc = app?.resumeId !== undefined ? await db.documents.get(app.resumeId) : undefined;
    return doc && doc.kind === "resume" && !doc.deletedAt ? resumeLabel(doc) : "";
  }, [db, app?.resumeId]);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [postingUrl, setPostingUrl] = useState("");
  const [stage, setStageChoice] = useState<Stage>("Applied");
  const [mergeInto, setMergeInto] = useState(0);
  // The one inline step open under the action row: choosing a merge target, or a question before a removal.
  const [step, setStep] = useState<"merge" | "delete" | "not" | null>(null);
  const controls = useRef<HTMLDivElement>(null);
  const stepBox = useRef<HTMLDivElement>(null);
  // Fill the forms when the application first arrives, and again when it changes under them (a merge, a rename elsewhere).
  // The stage has its own seed: a stage change (or a sync moving it) must not wipe text typed in Edit details.
  const seenFields = app ? `${app.id}|${app.company}|${app.role}|${app.postingUrl ?? ""}` : "";
  useEffect(() => {
    if (!app) return;
    setCompany(app.company);
    setRole(app.role === UNKNOWN_ROLE ? "" : app.role);
    setPostingUrl(app.postingUrl ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seenFields]);
  const seenStage = app ? `${app.id}|${app.stage}` : "";
  useEffect(() => {
    if (app) setStageChoice(app.stage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seenStage]);

  // The tab and the history name the application, not just "Application".
  const titleName = app?.company;
  useEffect(() => {
    if (titleName) document.title = `${titleName} · Job Tracker`;
  }, [titleName]);
  const firstOther = data?.others[0]?.id ?? 0;
  useEffect(() => {
    setMergeInto((cur) => (data?.others.some((o) => o.id === cur) ? cur : firstOther));
  }, [data?.others, firstOther]);

  // The merge step takes focus when it opens. The removal questions put focus on Cancel themselves.
  useEffect(() => {
    if (step === "merge") stepBox.current?.querySelector<HTMLElement>("select, button")?.focus();
  }, [step]);

  // Arriving from a person's email list: bring that email into view.
  const wanted = query.get("email");
  useEffect(() => {
    if (!wanted || !data) return;
    document.getElementById(`email-${wanted}`)?.scrollIntoView?.({ block: "start" });
  }, [wanted, data !== undefined && data !== null]);

  const restoreDeleted = () => {
    void act.run("restore", async () => {
      await restoreApplication(db, id);
      justRestored.current = true;
      setNotice(`Restored ${gone?.company ?? "the application"}.`);
    });
  };
  // Once Restore has put the application back, the result notice takes focus: the Restore button is gone.
  useEffect(() => {
    if (app && justRestored.current) {
      justRestored.current = false;
      result.focus();
    }
  }, [app]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (data === undefined || (data === null && gone === undefined)) return <a className="back" href="#/"><span className="chev" aria-hidden="true"></span>All applications</a>;
  if ((data === null || !app) && gone) {
    return (
      <>
        <a className="back" href="#/"><span className="chev" aria-hidden="true"></span>All applications</a>
        {act.error ? <Notice tone="err">{act.error}</Notice> : null}
        <h1 className="page detail-missing">This application was deleted</h1>
        <p className="muted">{gone.company}{gone.role ? ` · ${gone.role}` : ""}. It stays in Recently deleted for {plural(gone.daysLeft, "more day")}.</p>
        <div className="row">
          <button type="button" className="primary" onClick={restoreDeleted} {...act.button("restore")}>Restore</button>
          <a className="btn" href="#/settings/data">Recently deleted</a>
        </div>
      </>
    );
  }
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
  // Checked again here, whatever the database holds: only a plain http(s) address ever becomes a link.
  const posting = safePostingUrl(app.postingUrl);
  const say = (message: string, removed?: boolean) => {
    setNotice(message);
    if (removed) result.focus();   // the Not a person button is gone with the card
  };

  const saveCompany = (e: FormEvent) => {
    e.preventDefault();
    void act.run("edit", async () => {
      await editApplication(db, id, company, role, postingUrl);
      return "Saved.";
    });
  };
  // The stage select applies as soon as it changes, and puts the old stage back if that fails.
  const changeStage = (next: Stage) => {
    setStageChoice(next);
    void act.run("stage", async () => {
      await setStage(db, id, next);
      return `Stage set to ${next}. Syncs won't change it.`;
    }).then((done) => {
      if (!done) setStageChoice(app.stage);
    });
  };
  const unlock = () => act.run("unlock", async () => {
    await unlockStage(db, id);
    return "Unlocked. Emails can move the stage again.";
  });
  const menuButton = () => controls.current?.querySelector<HTMLElement>("[aria-haspopup='menu']") ?? null;
  const closeStep = () => {
    setStep(null);
    menuButton()?.focus();
  };
  const onStepKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    closeStep();
  };
  const merge = (e: FormEvent) => {
    e.preventDefault();
    const target = data.others.find((o) => o.id === mergeInto);
    if (!target) return;
    void act.run("merge", async () => {
      await mergeApplications(db, id, mergeInto);
      navigate(`/app/${mergeInto}`);
    });
  };
  const notApplication = () => {
    void act.run("not", async () => {
      const done = await notAnApplication(db, id);
      setFlash(learnedNotice(done.rules, done.cleared, `Removed ${done.company}.`));
      navigate("/review");
    });
  };
  const remove = (emails: "clear" | "review") => {
    void act.run(`delete-${emails}`, async () => {
      await deleteApplication(db, id, emails);
      // Going to the trash can be undone for a few seconds from the list; removing for good can't, so it says nothing.
      if (emails === "clear") announceDeleted(app.company, [id]);
      navigate("/");
    });
  };

  return (
    <>
      <a className="back" href="#/"><span className="chev" aria-hidden="true"></span>All applications</a>
      <div ref={result.box}>{notice ? <Notice>{notice}</Notice> : null}</div>
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      {act.status ? <Notice>{act.status}</Notice> : null}

      <div className="card">
        <h1 className="page detail-title">{app.company}</h1>
        <div className="muted">{app.role}</div>
        {posting ? (
          <a className="btn detail-posting" href={posting} target="_blank" rel="noopener noreferrer" aria-label="Open posting (opens in a new tab)" title={postingHost(posting)}>
            <ExternalLink size={16} strokeWidth={3} aria-hidden="true" />Open posting
          </a>
        ) : null}
        <div className="row detail-facts">
          <StageBadge stage={app.stage} />
          <span className="small muted">Applied {dayText(app.appliedAt)} {"·"} last activity {dayText(app.lastActivity)}</span>
          {app.locked ? <span className="small muted">{"·"} Stage set by you. Syncs won't change it.</span> : null}
          {app.stage === "Interview" && sentTitle ? <span className="small muted">{"·"} You sent: {sentTitle}</span> : null}
        </div>
        {data.rounds || app.stage === "Interview" ? <div className="detail-rounds"><InterviewRounds db={db} appId={id} rounds={data.rounds} /></div> : null}
        <ApplicationActions db={db} appId={id} />
        {showsOffer(app) ? <OfferDetails db={db} app={app} /> : null}
        <details className="more detail-edit">
          <summary>Edit details</summary>
          <form className="row" onSubmit={saveCompany}>
            <label className="sr" htmlFor="ed-company">Company</label>
            <input id="ed-company" name="company" value={company} maxLength={MAX_COMPANY_CHARS} required onChange={(e) => setCompany(e.target.value)} />
            <label className="sr" htmlFor="ed-role">Role</label>
            <input id="ed-role" name="role" value={role} maxLength={MAX_ROLE_CHARS} placeholder="Role" onChange={(e) => setRole(e.target.value)} />
            <label className="sr" htmlFor="ed-url">Posting link (optional)</label>
            <input id="ed-url" name="url" type="text" inputMode="url" value={postingUrl} maxLength={MAX_URL_CHARS} placeholder="Posting link (optional)" autoComplete="off" onChange={(e) => setPostingUrl(e.target.value)} />
            <button type="submit" {...act.button("edit")}>Save changes</button>
          </form>
        </details>
        <div className="row detail-controls" ref={controls}>
          <select name="stage" aria-label="Set stage" value={stage} disabled={act.busy !== null} onChange={(e) => changeStage(e.target.value as Stage)}>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {app.locked ? <button type="button" onClick={unlock} {...act.button("unlock")}>Unlock stage</button> : null}
          <MoreMenu
            disabled={act.busy !== null}
            items={[
              ...(data.others.length ? [{ key: "merge", label: "Merge into\u2026", onSelect: () => setStep("merge") }] : []),
              { key: "not", label: "Not an application", onSelect: () => setStep("not") },
              { key: "delete", label: "Delete application", onSelect: () => setStep("delete") },
            ]}
          />
        </div>
        {step === "merge" && data.others.length ? (
          <div className="detail-step" ref={stepBox} onKeyDown={onStepKey}>
            <form className="row" onSubmit={merge}>
              <select name="into" aria-label="Merge into" value={mergeInto} onChange={(e) => setMergeInto(Number(e.target.value))}>
                {data.others.map((o) => <option key={o.id} value={o.id}>{o.company} {"\u00b7"} {o.role}</option>)}
              </select>
              <button type="submit" className="danger" {...act.button("merge")}>Merge applications</button>
              <button type="button" onClick={closeStep}>Cancel</button>
            </form>
            <p className="help">Its emails, notes and steps move across, and this application is removed.</p>
          </div>
        ) : null}
        {step === "delete" ? (
          <InlineConfirm
            title={`Delete ${app.company}?`}
            help={`You can restore it for ${TRASH_DAYS} days.`}
            confirmLabel="Delete application"
            onConfirm={() => remove("clear")}
            onCancel={() => setStep(null)}
            act={act}
            actionKey="delete-clear"
            opener={menuButton()}
          >
            <button type="button" className="danger" onClick={() => remove("review")} {...act.button("delete-review")}>Delete for good, keep emails in Needs review</button>
          </InlineConfirm>
        ) : null}
        {step === "not" ? (
          <InlineConfirm
            title="Remove this and teach the app it wasn't a job application?"
            help="Emails like it will be ignored from now on."
            confirmLabel="Remove and ignore emails like it"
            onConfirm={notApplication}
            onCancel={() => setStep(null)}
            act={act}
            actionKey="not"
            opener={menuButton()}
          />
        ) : null}
      </div>

      <section className="detail-section" aria-labelledby="h-people">
        <h2 id="h-people" className="section">People</h2>
        {data.people.length ? (
          <>
            <ul className="people">
              {data.people.map((c) => <li key={c.key}><PersonCard db={db} contact={c} onNotice={say} /></li>)}
            </ul>
          </>
        ) : (
          <p className="muted flush-p">No people yet. A recruiter or interviewer shows up here once their email belongs to this application.</p>
        )}
      </section>

      <DocumentsSection db={db} app={app} people={data.people} act={act} deps={deps?.documents} />

      <section className="detail-section" aria-labelledby="h-notes">
        <h2 id="h-notes" className="section">Notes and steps</h2>
        <ApplicationPanel db={db} appId={id} includeEmails={false} navigate={navigate} limit={1000} />
      </section>

      <h2 className="section spaced detail-timeline-h">Email timeline <span className="small muted timeline-note">newest first</span></h2>
      <ul className="timeline">
        {data.emails.map((e) => (
          <li key={e.id}>
            <article className="card" id={`email-${e.id}`}>
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
          </li>
        ))}
      </ul>
      {!data.emails.length ? <p className="muted">No emails linked{app.manual ? " (added manually)" : ""}.</p> : null}
    </>
  );
}

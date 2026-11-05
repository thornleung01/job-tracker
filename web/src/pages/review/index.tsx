import { useEffect, useState, type FormEvent } from "react";
import { UNKNOWN_COMPANY, UNKNOWN_ROLE } from "../../pipeline/extract";
import type { PageProps } from "../../app/pageProps";
import { useQuery } from "../../app/useQuery";
import { EmailText } from "../../components/EmailText";
import { MailActions } from "../../components/MailActions";
import { MailMeta } from "../../components/MailMeta";
import { eventLabel } from "../../components/eventLabel";
import { Notice } from "../../components/Notice";
import { TimeText, dayText } from "../../components/TimeText";
import { clearFlash, peekFlash } from "../../components/flash";
import { useAction, type ActionRunner } from "../../components/useAction";
import { useNoticeFocus } from "../../components/useNoticeFocus";
import { STAGES, type Stage } from "../../db/stages";
import type { JobTrackerDB } from "../../db/schema";
import { ignoredIsReal, learnedNotice, resolveReview, undoRule } from "../../sync/actions";
import { mailboxLink, replyLink } from "../../sync/links";
import { reviewPage, type ReviewItem } from "../../sync/queries";
import "./review.css";

export default function ReviewPage({ db }: PageProps) {
  const data = useQuery(() => reviewPage(db), [db]);
  const act = useAction();
  const [notice, setNotice] = useState<string | null>(() => peekFlash());
  useEffect(() => clearFlash(), []);
  const result = useNoticeFocus();

  if (!data) return <h1 className="page">Needs review</h1>;

  // Settling an email or undoing a rule removes the button that was pressed, so the result takes focus.
  const tell = (message: string) => {
    setNotice(message || null);
    if (message) result.focus();
  };
  const undo = (id: number) => act.run(`undo-${id}`, async () => tell(await undoRule(db, id)));
  const restore = (id: number) => act.run(`real-${id}`, async () => tell((await ignoredIsReal(db, id)).message));

  return (
    <>
      <h1 className="page">Needs review</h1>
      <div ref={result.box}>{notice ? <Notice>{notice}</Notice> : null}</div>
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}

      {data.emails.map((e) => <ReviewCard key={e.id} db={db} email={e} apps={data.apps} onDone={tell} />)}
      {!data.emails.length ? <p className="muted">Nothing to review.</p> : null}

      <section className="card" id="learned" aria-labelledby="h-learned">
        <h2 id="h-learned" className="section">What the app has learned</h2>
        {data.learned.length ? (
          <>
            <p className="help">These come from your answers. They apply to new and saved emails. Undo any that are wrong.</p>
            {data.learned.map((r) => (
              <div className="row review-line" key={r.id}>
                <span>{r.text}</span>
                <button type="button" className="small" aria-label={`Undo: ${r.text}`} onClick={() => void undo(r.id)} {...act.button(`undo-${r.id}`)}>Undo</button>
              </div>
            ))}
          </>
        ) : (
          <p className="muted flush-p">Nothing yet. When an email here isn't about a job, choose <b>Not job mail</b>. On an application, choose <b>Not an application</b> to do the same and remove it.</p>
        )}
      </section>

      {data.ignored.length ? (
        <section className="card" id="ignored" aria-labelledby="h-ignored">
          <h2 id="h-ignored" className="section">Ignored because of what the app learned</h2>
          <p className="help">Kept for 30 days in case a rule was too strict. If one of these was a real job email, choose Restore email. The rule is undone and the email is read again.</p>
          {data.ignored.map((m) => (
            <div className="row review-line" key={m.id}>
              <span className="what">
                <b>{m.subject || "(no subject)"}</b>
                <span className="small muted who">{m.sender} {"·"} {dayText(m.receivedAt, "short")}</span>
              </span>
              <button type="button" className="small" aria-label={`Restore email: ${m.subject || "(no subject)"}`} onClick={() => void restore(m.id)} {...act.button(`real-${m.id}`)}>Restore email</button>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}

interface CardProps {
  db: JobTrackerDB;
  email: ReviewItem;
  apps: { id: number; company: string; role: string }[];
  onDone(message: string): void;
}

/** One email waiting for you: what the tracker thinks it is, the cleaned text, and the three ways to settle it. */
function ReviewCard({ db, email: e, apps, onDone }: CardProps) {
  const act: ActionRunner = useAction();
  const [stage, setStage] = useState<Stage>(e.guessStage);
  const [appId, setAppId] = useState(0);
  const [company, setCompany] = useState(e.guessCompany !== UNKNOWN_COMPANY ? e.guessCompany : "");
  const [role, setRole] = useState(e.guessRole !== UNKNOWN_ROLE ? e.guessRole : "");

  const settle = (key: string, decision: Parameters<typeof resolveReview>[2], prefix: string) =>
    act.run(key, async () => {
      const done = await resolveReview(db, e.id, decision);
      onDone(learnedNotice(done.rules, done.cleared, prefix));
    });
  const assign = (ev: FormEvent) => {
    ev.preventDefault();
    const target = apps.find((a) => a.id === appId);
    void settle("assign", { action: "assign", appId, stage }, target ? `Added to ${target.company}.` : "");
  };
  const create = (ev: FormEvent) => {
    ev.preventDefault();
    void settle("new", { action: "new", company, role, stage }, `Created ${company.trim()}.`);
  };

  const provider = e.provider ?? "";
  const address = e.address ?? "";
  const open = e.provider ? mailboxLink(provider, address, e.threadId, e.webLink) : null;
  const reply = e.provider ? replyLink(provider, address, e.sender ?? "", e.subject, e.webLink) : null;

  return (
    <article className="card">
      <header className="mail-head">
        <div className="review-title">
          <h2 className="mail-subject">{e.subject || "(no subject)"}</h2>
          <button type="button" className="danger small" aria-label={`Not job mail: ${e.subject || "(no subject)"}`} title="Not about a job application. Its content is erased and the app learns to ignore emails like it."
                  onClick={() => void settle("dismiss", { action: "dismiss" }, "Marked as not job mail.")} {...act.button("dismiss")}>Not job mail</button>
        </div>
        <MailMeta sender={e.sender}><TimeText iso={e.receivedAt} relative /></MailMeta>
        <p className="mail-guess">Looks like <b>{e.event ? eventLabel(e.event) : "something unclear"}</b>{e.confidence ? `, ${e.confidence} confidence` : ""}</p>
      </header>
      <EmailText body={e.body} />
      <MailActions open={open} reply={reply} quiet />
      {act.error ? <Notice tone="err" className="stack-top">{act.error}</Notice> : null}

      <div className="review-decide">
        <div className="review-stage">
          <label className="field small" htmlFor={`stage-${e.id}`}>Stage</label>
          <select id={`stage-${e.id}`} name="stage" value={stage} onChange={(ev) => setStage(ev.target.value as Stage)}>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <form className="row review-form" onSubmit={assign}>
          <select aria-label="Existing application" name="app_id" value={appId} onChange={(ev) => setAppId(Number(ev.target.value))}>
            <option value={0}>Existing application{"…"}</option>
            {apps.map((a) => <option key={a.id} value={a.id}>{a.company} {"·"} {a.role}</option>)}
          </select>
          <button type="submit" aria-label={`Add to application: ${e.subject || "(no subject)"}`} {...act.button("assign")}>Add to application</button>
        </form>
        <form className="row review-form" onSubmit={create}>
          <input name="company" aria-label="Company" placeholder="Company" pattern=".*\S.*" value={company} onChange={(ev) => setCompany(ev.target.value)} />
          <input name="role" aria-label="Role" placeholder="Role" value={role} onChange={(ev) => setRole(ev.target.value)} />
          <button type="submit" className="primary" aria-label={`Create application from: ${e.subject || "(no subject)"}`} {...act.button("new")}>Create application</button>
        </form>
      </div>
    </article>
  );
}

// "Mail rules": what the app has learned from your answers on Needs review, and the mail those rules set aside.
import { useState } from "react";
import { useQuery } from "../../app/useQuery";
import { Notice } from "../../components/Notice";
import { dayText } from "../../components/TimeText";
import { useAction } from "../../components/useAction";
import { useNoticeFocus } from "../../components/useNoticeFocus";
import type { JobTrackerDB } from "../../db/schema";
import { ignoredIsReal, undoRule } from "../../sync/actions";
import { reviewPage } from "../../sync/queries";

export function MailRulesSection({ db }: { db: JobTrackerDB }) {
  const data = useQuery(() => reviewPage(db), [db]);
  const act = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  const result = useNoticeFocus();

  if (!data) return null;

  // Undoing a rule or restoring an email removes the button that was pressed, so the result takes focus.
  const tell = (message: string) => {
    setNotice(message || null);
    if (message) result.focus();
  };
  const undo = (id: number) => act.run(`undo-${id}`, async () => tell(await undoRule(db, id)));
  const restore = (id: number) => act.run(`real-${id}`, async () => tell((await ignoredIsReal(db, id)).message));

  return (
    <>
      <div ref={result.box}>{notice ? <Notice>{notice}</Notice> : null}</div>
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}

      <section className="card" id="learned" aria-labelledby="h-learned">
        <h2 id="h-learned" className="sec" tabIndex={-1}>What the app has learned</h2>
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
          <p className="muted flush-p">Nothing yet. When an email in Needs review isn't about a job, choose <b>Not job mail</b>. On an application, choose <b>Not an application</b> to do the same and remove it.</p>
        )}
      </section>

      {data.ignored.length ? (
        <section className="card" id="ignored" aria-labelledby="h-ignored">
          <h2 id="h-ignored" className="sec" tabIndex={-1}>Ignored because of what the app learned</h2>
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

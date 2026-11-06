// "Recently deleted": the applications you deleted in the last 30 days. Restore brings one back as it was; Delete now and
// Empty recently deleted erase for good, each after a question in place (the shared InlineConfirm).
import { useState } from "react";
import { InlineConfirm } from "../../components/InlineConfirm";
import { Notice } from "../../components/Notice";
import { StageBadge } from "../../components/StageBadge";
import { useAction } from "../../components/useAction";
import { useNoticeFocus } from "../../components/useNoticeFocus";
import { useQuery } from "../../app/useQuery";
import type { JobTrackerDB } from "../../db/schema";
import { plural } from "../../sync/text";
import { TRASH_DAYS, deleteForever, emptyTrash, listDeleted, restoreApplication, type TrashEntry } from "../../sync/trash";
import "./trash.css";

/** "today", "1 day ago", "3 days ago" */
const agoText = (days: number) => (days === 0 ? "today" : `${plural(days, "day")} ago`);

export function TrashSection({ db }: { db: JobTrackerDB }) {
  const entries = useQuery(() => listDeleted(db), [db]);
  const act = useAction();
  // The one question open at a time, and the button that asked it (focus goes back there on cancel).
  const [ask, setAsk] = useState<{ kind: "one"; entry: TrashEntry; opener: HTMLElement } | { kind: "all"; opener: HTMLElement } | null>(null);
  const result = useNoticeFocus();

  // The button that was pressed is gone with its row, so the result takes focus (once it is on the page: see useNoticeFocus).
  const done = (ok: Promise<boolean>) => void ok.then((fine) => fine && result.focus());

  const restore = (e: TrashEntry) => done(act.run(`restore-${e.id}`, async () => {
    // false: it was restored in another tab while this one was open
    return (await restoreApplication(db, e.id)) ? `Restored ${e.company}.` : `${e.company} was already restored.`;
  }));
  const eraseOne = (e: TrashEntry) =>
    done(act.run(`erase-${e.id}`, async () => {
      const erased = await deleteForever(db, e.id);
      setAsk(null);
      // false: it was restored or erased in another tab while this one was open
      return erased ? `Deleted ${e.company} for good.` : `${e.company} is no longer in Recently deleted.`;
    }));
  const eraseAll = () =>
    done(act.run("empty", async () => {
      const n = await emptyTrash(db);
      setAsk(null);
      return n ? `Deleted ${plural(n, "application")} for good.` : "Nothing to delete.";
    }));

  const list = entries ?? [];
  return (
    <section className="card" id="trash" aria-labelledby="h-trash">
      <h2 className="sec" id="h-trash" tabIndex={-1}>Recently deleted</h2>
      <p className="help">Deleted applications stay here with their emails and notes for {TRASH_DAYS} days, then they are erased.</p>
      <div ref={result.box}>{act.status ? <Notice>{act.status}</Notice> : null}</div>
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      {entries && !list.length ? <p className="muted flush-p">Nothing deleted.</p> : null}
      {list.length ? (
        <>
          <ul className="trash-list">
            {list.map((e) => (
              <li key={e.id} className="trash-row">
                <div className="trash-what">
                  <strong className="trash-company">{e.company}</strong>
                  <span className="muted trash-role">{e.role}</span>
                  <StageBadge stage={e.stage} />
                </div>
                <div className="small muted trash-when">Deleted {agoText(e.daysAgo)} {"·"} {plural(e.daysLeft, "day")} left</div>
                <div className="row trash-actions">
                  <button type="button" className="small" aria-label={`Restore ${e.company}`} onClick={() => restore(e)} {...act.button(`restore-${e.id}`)}>Restore</button>
                  <button type="button" className="small danger" aria-label={`Delete ${e.company} now`} onClick={(ev) => setAsk({ kind: "one", entry: e, opener: ev.currentTarget })} {...act.button(`erase-${e.id}`)}>Delete now</button>
                </div>
                {ask?.kind === "one" && ask.entry.id === e.id ? (
                  <InlineConfirm
                    title={`Delete ${e.company} now?`}
                    help="Its emails, notes and steps are erased from this device. This can't be undone."
                    confirmLabel="Delete now"
                    onConfirm={() => eraseOne(e)}
                    onCancel={() => setAsk(null)}
                    act={act}
                    actionKey={`erase-${e.id}`}
                    opener={ask.opener}
                  />
                ) : null}
              </li>
            ))}
          </ul>
          <div className="row trash-empty">
            <button type="button" className="danger" onClick={(ev) => setAsk({ kind: "all", opener: ev.currentTarget })} {...act.button("empty-ask")}>Empty recently deleted</button>
          </div>
          {ask?.kind === "all" ? (
            <InlineConfirm
              title={`Delete ${plural(list.length, "application")} for good?`}
              help="Their emails, notes and steps are erased from this device. This can't be undone."
              confirmLabel="Empty recently deleted"
              onConfirm={eraseAll}
              onCancel={() => setAsk(null)}
              act={act}
              actionKey="empty"
              opener={ask.opener}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

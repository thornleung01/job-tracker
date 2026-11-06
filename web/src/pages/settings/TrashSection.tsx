// "Recently deleted": the applications, resumes and cover letters you deleted in the last 30 days. Restore brings one back as it was;
// Delete now and Empty recently deleted erase for good, each after a question in place (the shared InlineConfirm).
import { useState } from "react";
import { InlineConfirm } from "../../components/InlineConfirm";
import { Notice } from "../../components/Notice";
import { StageBadge } from "../../components/StageBadge";
import { useAction } from "../../components/useAction";
import { useNoticeFocus } from "../../components/useNoticeFocus";
import { useQuery } from "../../app/useQuery";
import { MissingRecordError } from "../../db/errors";
import type { JobTrackerDB } from "../../db/schema";
import { restoreDocument } from "../../sync/documents";
import { plural } from "../../sync/text";
import { TRASH_DAYS, deleteDocumentForever, deleteForever, emptyTrash, listTrash, restoreApplication, type AnyTrashEntry } from "../../sync/trash";
import "./trash.css";

/** "today", "1 day ago", "3 days ago" */
const agoText = (days: number) => (days === 0 ? "today" : `${plural(days, "day")} ago`);

/** The name a row goes by in messages: an application is its company, a document its label ("Resume for Acme, Analyst"). */
const nameOf = (e: AnyTrashEntry) => (e.kind === "application" ? e.company : e.label);
/** The same for a button's accessible name, where a cover letter's label ("Acme, Analyst") needs its noun. */
const spokenName = (e: AnyTrashEntry) => (e.kind === "cover" ? `cover letter for ${e.label}` : nameOf(e));
const KIND_WORD = { resume: "Resume", cover: "Cover letter" } as const;
/** An application and a document can share an id, so every row is keyed by its kind too. */
const rowKey = (e: AnyTrashEntry) => `${e.kind}-${e.id}`;

export function TrashSection({ db }: { db: JobTrackerDB }) {
  const entries = useQuery(() => listTrash(db), [db]);
  const act = useAction();
  // The one question open at a time, and the button that asked it (focus goes back there on cancel).
  const [ask, setAsk] = useState<{ kind: "one"; entry: AnyTrashEntry; opener: HTMLElement } | { kind: "all"; opener: HTMLElement } | null>(null);
  const result = useNoticeFocus();

  // The button that was pressed is gone with its row, so the result takes focus (once it is on the page: see useNoticeFocus).
  const done = (ok: Promise<boolean>) => void ok.then((fine) => fine && result.focus());

  const restore = (e: AnyTrashEntry) => done(act.run(`restore-${rowKey(e)}`, async () => {
    const name = nameOf(e);
    // false: it was restored in another tab while this one was open
    if (e.kind === "application") return (await restoreApplication(db, e.id)) ? `Restored ${name}.` : `${name} was already restored.`;
    try {
      await restoreDocument(db, e.id);
    } catch (err) {
      // Restored or erased elsewhere meanwhile, or the refusal's own words ("Restore the application first.") shown in the notice.
      if (err instanceof MissingRecordError) return `${name} is no longer in Recently deleted.`;
      throw err;
    }
    return `Restored ${name}.`;
  }));
  const eraseOne = (e: AnyTrashEntry) =>
    done(act.run(`erase-${rowKey(e)}`, async () => {
      const erased = e.kind === "application" ? await deleteForever(db, e.id) : await deleteDocumentForever(db, e.id);
      setAsk(null);
      // false: it was restored or erased in another tab while this one was open
      return erased ? `Deleted ${nameOf(e)} for good.` : `${nameOf(e)} is no longer in Recently deleted.`;
    }));

  const list = entries ?? [];
  // "2 applications" while only applications are here, so the wording the section always had stays; "3 items" once a document is in the mix.
  const onlyApplications = list.every((e) => e.kind === "application");
  const noun = onlyApplications ? "application" : "item";
  const eraseAll = () =>
    done(act.run("empty", async () => {
      const n = await emptyTrash(db);
      setAsk(null);
      return n ? `Deleted ${plural(n, noun)} for good.` : "Nothing to delete.";
    }));

  return (
    <section className="card" id="trash" aria-labelledby="h-trash">
      <h2 className="sec" id="h-trash" tabIndex={-1}>Recently deleted</h2>
      <p className="help">Deleted applications, resumes and cover letters stay here for {TRASH_DAYS} days, then they are erased.</p>
      <div ref={result.box}>{act.status ? <Notice>{act.status}</Notice> : null}</div>
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      {entries && !list.length ? <p className="muted flush-p">Nothing deleted.</p> : null}
      {list.length ? (
        <>
          <ul className="trash-list">
            {list.map((e) => (
              <li key={rowKey(e)} className="trash-row">
                <div className="trash-what">
                  {e.kind === "application" ? (
                    <>
                      <strong className="trash-company">{e.company}</strong>
                      <span className="muted trash-role">{e.role}</span>
                      <StageBadge stage={e.stage} />
                    </>
                  ) : (
                    <>
                      <span className="muted trash-kind">{KIND_WORD[e.kind]} {"·"}</span>{" "}
                      <strong className="trash-company">{e.label}</strong>
                    </>
                  )}
                </div>
                <div className="small muted trash-when">Deleted {agoText(e.daysAgo)} {"·"} {plural(e.daysLeft, "day")} left</div>
                <div className="row trash-actions">
                  <button type="button" className="small" aria-label={`Restore ${spokenName(e)}`} onClick={() => restore(e)} {...act.button(`restore-${rowKey(e)}`)}>Restore</button>
                  <button type="button" className="small danger" aria-label={`Delete ${spokenName(e)} now`} onClick={(ev) => setAsk({ kind: "one", entry: e, opener: ev.currentTarget })} {...act.button(`erase-${rowKey(e)}`)}>Delete now</button>
                </div>
                {ask?.kind === "one" && rowKey(ask.entry) === rowKey(e) ? (
                  <InlineConfirm
                    title={`Delete ${nameOf(e)} now?`}
                    help={e.kind === "application" ? "Its emails, notes and steps are erased from this device. This can't be undone." : "It's erased from this device. This can't be undone."}
                    confirmLabel="Delete now"
                    onConfirm={() => eraseOne(e)}
                    onCancel={() => setAsk(null)}
                    act={act}
                    actionKey={`erase-${rowKey(e)}`}
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
              title={`Delete ${plural(list.length, noun)} for good?`}
              help={onlyApplications ? "Their emails, notes and steps are erased from this device. This can't be undone." : "They're erased from this device, with the emails and notes of any application. This can't be undone."}
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

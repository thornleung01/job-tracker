import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "../../app/useQuery";
import type { ApplicationRow, DocumentRow, JobTrackerDB } from "../../db/schema";
import { coverLetterMail } from "../../sync/applicationActions";
import type { Contact } from "../../sync/contacts";
import { TRASH_DAYS } from "../../db/limits";
import { deleteDocument, saveCoverLetter } from "../../sync/documents";
import { InlineConfirm } from "../InlineConfirm";
import type { ActionRunner } from "../useAction";
import { greeting, letterSections, letterText } from "../../documents/letter";

interface Props {
  db: JobTrackerDB;
  app: ApplicationRow;
  /** this application's saved cover letter, if it has one */
  cover: DocumentRow | undefined;
  /** this application's people, for the greeting */
  people: readonly Contact[];
  act: ActionRunner;
}

/** The cover letter for this application: write it, edit it, copy it, print it or open it as a draft in Gmail or Outlook. */
export function CoverLetter({ db, app, cover, people, act }: Props) {
  const [text, setText] = useState<string | null>(null);   // the text box, while it is open
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState("");
  const box = useRef<HTMLDivElement>(null);
  // The control that is gone after an action (Write, Save, Delete) hands focus on to the one that replaces it.
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    if (!focusNext.current) return;
    box.current?.querySelector<HTMLElement>(focusNext.current)?.focus();
    focusNext.current = null;
  });

  const open = () => {
    setCopied("");
    setText(cover ? letterText(cover.sections) : `${greeting(people)}\n\n`);
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (text === null) return;
    void act.run("cover-save", async () => {
      await saveCoverLetter(db, app.id, letterSections(text, cover?.sections));
      focusNext.current = "[data-edit]";
      setText(null);
      return "Saved.";
    });
  };
  const remove = () => {
    if (!cover) return;
    void act.run("cover-delete", async () => {
      await deleteDocument(db, cover.id);
      focusNext.current = "[data-write]";
      setAsking(false);
      return `Cover letter deleted. You can restore it for ${TRASH_DAYS} days.`;
    });
  };
  const copy = async (letter: string) => {
    try {
      await navigator.clipboard.writeText(letter);
      setCopied("Copied");
    } catch {
      setCopied("Couldn't copy. Select the text and copy it.");
    }
  };

  const letter = cover ? letterText(cover.sections) : "";
  return (
    <div className="doc-block" ref={box}>
      <h3 className="doc-h">Cover letter</h3>
      {text !== null ? (
        <form className="doc-letter-form" onSubmit={save}>
          <label className="sr" htmlFor={`cover-${app.id}`}>Cover letter</label>
          <textarea id={`cover-${app.id}`} className="doc-letter-text" rows={14} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
          <div className="row">
            <button type="submit" className="primary" {...act.button("cover-save")}>Save</button>
            <button type="button" onClick={() => setText(null)} disabled={act.busy !== null}>Cancel</button>
          </div>
        </form>
      ) : cover ? (
        <>
          <div className="doc-letter">{cover.sections.flatMap((s) => [s.heading, ...s.items.map((i) => i.text)]).filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}</div>
          <div className="row doc-actions">
            <button type="button" data-edit="" onClick={open} disabled={act.busy !== null}>Edit</button>
            <button type="button" onClick={() => void copy(letter)}>Copy text</button>
            <a className="btn" href={`#/resume/print/${cover.id}`}>Print</a>
            <LetterDraft db={db} appId={app.id} letter={letter} />
            <button type="button" className="danger" onClick={() => setAsking(true)} disabled={act.busy !== null}>Delete</button>
            <span className="small muted" role="status">{copied}</span>
          </div>
          {asking ? (
            <InlineConfirm
              title="Delete this cover letter?"
              help={`You can restore it for ${TRASH_DAYS} days.`}
              confirmLabel="Delete cover letter"
              onConfirm={remove}
              onCancel={() => setAsking(false)}
              act={act}
              actionKey="cover-delete"
            />
          ) : null}
        </>
      ) : (
        <div className="row"><button type="button" data-write="" onClick={open} disabled={act.busy !== null}>Write a cover letter</button></div>
      )}
    </div>
  );
}

/** Draft in Gmail or Outlook: a new message to the person a follow-up would go to, in the same mailbox. Nothing when there is no mailbox to open it in. */
function LetterDraft({ db, appId, letter }: { db: JobTrackerDB; appId: number; letter: string }) {
  const mail = useQuery(() => coverLetterMail(db, appId, letter), [db, appId, letter]);
  const link = mail?.link;
  if (!mail || !link || !link.url.startsWith("https://")) return null;
  const service = link.label.replace("Draft in ", "");
  return (
    <>
      <a className="btn" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${link.label} (opens in a new tab)`}
         title={mail.to ? `Opens a new message to ${mail.to} in ${service}` : `Opens a new message in ${service}`}>{link.label}</a>
      {mail.cut ? <span className="small muted">Only the first part goes in the draft.</span> : null}
    </>
  );
}

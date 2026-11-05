import { useId, useState, type FormEvent } from "react";
import type { JobTrackerDB } from "../db/schema";
import { MAX_NAME_CHARS, MAX_TITLE_CHARS } from "../db/limits";
import { KIND_LABEL, hide, saveEdit, type Contact } from "../sync/contacts";
import { InlineConfirm } from "./InlineConfirm";
import { Notice } from "./Notice";
import { TimeText } from "./TimeText";
import { useAction } from "./useAction";
import "./components.css";

const providerOf = (label: string) => label.replace("Reply in ", "");

interface PersonCardProps {
  db: JobTrackerDB;
  contact: Contact;
  /** told after a save or a removal, so the page can say so even when this card goes away; `removed` is true when the card is gone, so the page can move focus to the message */
  onNotice?(message: string, removed?: boolean): void;
}

/**
 * One person on one application, used on the People page and inside each application: a bold name, a tag for the kind of
 * person, the title as plain text, then a muted address and last contact, and one row of actions.
 * Email (a new message in the mailbox their latest email reached), the emails list and Edit.
 */
export function PersonCard({ db, contact: c, onNotice }: PersonCardProps) {
  const act = useAction();
  const fieldId = useId();
  // The "Not a person" button that asked the question, so focus goes back to it on cancel.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const [name, setName] = useState(c.name);
  const [title, setTitle] = useState(c.title);
  const first = c.name.split(/\s+/)[0];

  const save = (e: FormEvent) => {
    e.preventDefault();
    void act.run("save", async () => {
      await saveEdit(db, c.key, name, title);
      onNotice?.("Saved.");
    });
  };
  const remove = () => {
    void act.run("hide", async () => {
      await hide(db, c.key);
      onNotice?.("Removed from this application.", true);
    });
  };

  return (
    <div className="person">
      <div className="person-head">
        <strong>{c.name}</strong>
        {c.kind ? <span className="tag">{KIND_LABEL[c.kind]}</span> : null}
        {c.edited ? <span className="tag">Edited by you</span> : null}
      </div>
      <p className="person-title">{c.title ? c.title : <span className="muted">No title found in this application's emails</span>}</p>
      <p className="person-meta">
        {c.email ? c.email : "No address, named in an invite"} {"·"} last <TimeText iso={c.last} format="short" relative />
      </p>
      <div className="mail-actions">
        {c.compose && c.compose.url.startsWith("https://") ? (
          <a className="btn primary" href={c.compose.url} target="_blank" rel="noopener noreferrer" aria-label={`Email ${first} in ${providerOf(c.compose.label)} (opens in a new tab)`}
             title={`Opens a new message to ${c.email} in ${providerOf(c.compose.label)}`}>Email {first}</a>
        ) : null}
        {c.mailCount ? (
          <details className="action">
            <summary>{c.mailCount} email{c.mailCount === 1 ? "" : "s"}</summary>
            <p className="small muted flush-p">Newest first</p>
            <ul className="thread">
              {c.mails.map((m) => (
                <li key={m.id}>
                  <span><a href={`#/app/${c.appId}?email=${m.id}`}>{m.subject}</a></span>
                  <span className="small muted"><TimeText iso={m.when} format="short" /> {"·"} {m.how === "from" ? "from them" : "names them"}</span>
                </li>
              ))}
            </ul>
            {c.mailCount > c.mails.length ? <p className="small muted flush-p">Showing the latest {c.mails.length} of {c.mailCount}.</p> : null}
          </details>
        ) : null}
        <details className="action">
          <summary>Edit person</summary>
          <form className="row row-end" onSubmit={save}>
            <div className="fgroup">
              <label htmlFor={`${fieldId}-name`}>Name</label>
              <input id={`${fieldId}-name`} name="name" value={name} maxLength={MAX_NAME_CHARS} required onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="fgroup f-grow">
              <label htmlFor={`${fieldId}-title`}>Title for this role</label>
              <input id={`${fieldId}-title`} name="title" value={title} maxLength={MAX_TITLE_CHARS} placeholder="For example, hiring manager" onChange={(e) => setTitle(e.target.value)} />
            </div>
            <button type="submit" {...act.button("save")}>Save changes</button>
          </form>
          <div className="stack-top-sm">
            <button type="button" className="danger" onClick={(e) => setOpener(e.currentTarget)} {...act.button("hide")}>Not a person</button>
          </div>
          {opener ? (
            <InlineConfirm
              title={`Remove ${c.name} from this application?`}
              confirmLabel="Remove from this application"
              onConfirm={remove}
              onCancel={() => setOpener(null)}
              act={act}
              actionKey="hide"
              opener={opener}
            />
          ) : null}
          {act.error ? <Notice tone="err" className="stack-top">{act.error}</Notice> : null}
        </details>
      </div>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import type { JobTrackerDB } from "../db/schema";
import { KIND_LABEL, hide, saveEdit, type Contact } from "../sync/contacts";
import { Notice } from "./Notice";
import { TimeText } from "./TimeText";
import { useAction } from "./useAction";
import "./components.css";

const providerOf = (label: string) => label.replace("Reply in ", "");

interface PersonCardProps {
  db: JobTrackerDB;
  contact: Contact;
  /** told after a save or a removal, so the page can say so even when this card goes away */
  onNotice?(message: string): void;
}

/**
 * One person on one application, used on the People page and inside each application: a bold name, a tag for the kind of
 * person, the title as plain text, then a muted address and last contact, and one row of actions.
 * Email (a new message in the mailbox their latest email reached), the emails list and Edit.
 */
export function PersonCard({ db, contact: c, onNotice }: PersonCardProps) {
  const act = useAction();
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
    if (!window.confirm(`Remove ${c.name} from this application?`)) return;
    void act.run("hide", async () => {
      await hide(db, c.key);
      onNotice?.("Removed from this application.");
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
          <a className="btn primary" href={c.compose.url} target="_blank" rel="noopener noreferrer"
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
              <label htmlFor={`n-${c.key}`}>Name</label>
              <input id={`n-${c.key}`} name="name" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="fgroup f-grow">
              <label htmlFor={`t-${c.key}`}>Title for this role</label>
              <input id={`t-${c.key}`} name="title" value={title} maxLength={100} placeholder="For example, hiring manager" onChange={(e) => setTitle(e.target.value)} />
            </div>
            <button type="submit" {...act.button("save")}>Save changes</button>
          </form>
          <div className="stack-top-sm">
            <button type="button" className="danger" onClick={remove} {...act.button("hide")}>Not a person</button>
          </div>
          {act.error ? <Notice tone="err" className="stack-top">{act.error}</Notice> : null}
        </details>
      </div>
    </div>
  );
}

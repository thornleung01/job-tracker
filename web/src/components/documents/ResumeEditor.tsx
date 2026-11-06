import { useState, type FormEvent } from "react";
import { newItemId } from "../../db/documentShape";
import { MAX_DOC_HEADING_CHARS, MAX_DOC_ITEMS, MAX_DOC_ITEM_CHARS } from "../../db/limits";
import type { DocSection } from "../../db/schema";
import type { ActionRunner } from "../useAction";

interface Props {
  /** what the editor starts from; the editor is keyed by the resume, so another resume starts fresh */
  sections: readonly DocSection[];
  act: ActionRunner;
  onSave(sections: DocSection[]): void;
  onCancel(): void;
}

/** A resume's sections as fields: a heading and a line each. Nothing is saved until Save. Empty lines are dropped when it saves. */
export function ResumeEditor({ sections, act, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<DocSection[]>(() => sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i })) })));
  const change = (si: number, fn: (s: DocSection) => DocSection) => setDraft((d) => d.map((s, i) => (i === si ? fn(s) : s)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(draft);
  };

  return (
    <form className="doc-editor" onSubmit={submit} aria-label="Edit resume">
      {draft.map((s, si) => (
        <fieldset key={s.id} className="doc-edit-section">
          <legend className="sr">{s.heading || `Section ${si + 1}`}</legend>
          <label className="sr" htmlFor={`doc-h-${s.id}`}>Heading of section {si + 1}</label>
          <input id={`doc-h-${s.id}`} className="doc-edit-heading" value={s.heading} maxLength={MAX_DOC_HEADING_CHARS} placeholder="Heading"
                 onChange={(e) => change(si, (x) => ({ ...x, heading: e.target.value }))} />
          {s.items.map((item, ii) => (
            <div className="doc-edit-line" key={item.id}>
              <label className="sr" htmlFor={`doc-i-${item.id}`}>Line {ii + 1} of {s.heading || `section ${si + 1}`}</label>
              <textarea id={`doc-i-${item.id}`} rows={2} value={item.text} maxLength={MAX_DOC_ITEM_CHARS}
                        onChange={(e) => change(si, (x) => ({ ...x, items: x.items.map((y) => (y.id === item.id ? { ...y, text: e.target.value } : y)) }))} />
              <button type="button" className="quiet small" aria-label={`Remove line ${ii + 1} of ${s.heading || `section ${si + 1}`}`}
                      onClick={() => change(si, (x) => ({ ...x, items: x.items.filter((y) => y.id !== item.id) }))}>Remove</button>
            </div>
          ))}
          <button type="button" className="small" disabled={s.items.length >= MAX_DOC_ITEMS}
                  onClick={() => change(si, (x) => ({ ...x, items: [...x.items, { id: newItemId(), text: "" }] }))}>
            Add line<span className="sr"> to {s.heading || `section ${si + 1}`}</span>
          </button>
        </fieldset>
      ))}
      <div className="row">
        <button type="submit" className="primary" {...act.button("resume-edit")}>Save</button>
        <button type="button" onClick={onCancel} disabled={act.busy !== null}>Cancel</button>
      </div>
    </form>
  );
}

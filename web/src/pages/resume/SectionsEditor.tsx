import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { newItemId } from "../../db/documentShape";
import { MAX_DOC_HEADING_CHARS, MAX_DOC_ITEM_CHARS, MAX_DOC_ITEMS, MAX_DOC_SECTIONS } from "../../db/limits";
import type { DocSection } from "../../db/schema";

interface Props {
  sections: DocSection[];
  onChange(next: DocSection[]): void;
  /** names the group for screen readers, like "Master resume" */
  label: string;
}

const blankItem = () => ({ id: newItemId(), text: "" });

/** A resume as sections and lines you can edit in place. It changes nothing but the list it is given: saving is the caller's. */
export function SectionsEditor({ sections, onChange, label }: Props) {
  // The field to focus once a line or section has been added.
  const [focusId, setFocusId] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusId) return;
    root.current?.querySelector<HTMLElement>(`[data-field="${focusId}"]`)?.focus();
    setFocusId(null);
  }, [focusId]);

  const setSection = (i: number, next: DocSection) => onChange(sections.map((s, j) => (j === i ? next : s)));
  const move = (items: DocSection["items"], from: number, to: number) => {
    const copy = [...items];
    [copy[from], copy[to]] = [copy[to], copy[from]];
    return copy;
  };

  return (
    <div className="doc-editor" role="group" aria-label={label} ref={root}>
      {sections.map((s, i) => (
        <section key={s.id} className="doc-section" aria-label={s.heading || `Section ${i + 1}`}>
          <div className="doc-heading">
            <input
              type="text" aria-label={`Heading of section ${i + 1}`} value={s.heading} maxLength={MAX_DOC_HEADING_CHARS} data-field={s.id}
              onChange={(e) => setSection(i, { ...s, heading: e.target.value })}
            />
            <button type="button" className="quiet" onClick={() => onChange(sections.filter((_, j) => j !== i))}>Remove section</button>
          </div>
          <ul className="doc-items">
            {s.items.map((item, k) => (
              <li key={item.id}>
                <textarea
                  rows={1} aria-label={`Line ${k + 1} of ${s.heading || `section ${i + 1}`}`} value={item.text} maxLength={MAX_DOC_ITEM_CHARS} data-field={item.id}
                  onChange={(e) => setSection(i, { ...s, items: s.items.map((x) => (x.id === item.id ? { ...x, text: e.target.value } : x)) })}
                />
                <div className="doc-line-actions">
                  <button type="button" className="icon" aria-label={`Move line ${k + 1} up`} disabled={k === 0}
                          onClick={() => setSection(i, { ...s, items: move(s.items, k, k - 1) })}>
                    <ArrowUp size={16} aria-hidden="true" />
                  </button>
                  <button type="button" className="icon" aria-label={`Move line ${k + 1} down`} disabled={k === s.items.length - 1}
                          onClick={() => setSection(i, { ...s, items: move(s.items, k, k + 1) })}>
                    <ArrowDown size={16} aria-hidden="true" />
                  </button>
                  <button type="button" className="icon" aria-label={`Remove line ${k + 1}`}
                          onClick={() => setSection(i, { ...s, items: s.items.filter((x) => x.id !== item.id) })}>
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className="quiet" disabled={s.items.length >= MAX_DOC_ITEMS} onClick={() => {
            const item = blankItem();
            setSection(i, { ...s, items: [...s.items, item] });
            setFocusId(item.id);
          }}>Add line</button>
        </section>
      ))}
      <button type="button" disabled={sections.length >= MAX_DOC_SECTIONS} onClick={() => {
        const next: DocSection = { id: newItemId(), heading: "", items: [blankItem()] };
        onChange([...sections, next]);
        setFocusId(next.id);
      }}>Add section</button>
    </div>
  );
}

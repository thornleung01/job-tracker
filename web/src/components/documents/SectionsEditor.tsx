import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { newItemId } from "../../db/documentShape";
import { MAX_DOC_HEADING_CHARS, MAX_DOC_ITEM_CHARS, MAX_DOC_ITEMS, MAX_DOC_LABEL_CHARS, MAX_DOC_RIGHT_CHARS, MAX_DOC_SECTIONS } from "../../db/limits";
import { isDocItemKind, type DocItem, type DocItemKind, type DocSection } from "../../db/schema";
import "./sectionseditor.css";

interface Props {
  sections: DocSection[];
  onChange(next: DocSection[]): void;
  /** names the group for screen readers, like "Master resume" */
  label: string;
}

/** What each kind is called, in the "Line type" select and on the main text field. No kind is a plain line, which stays "Line N" so existing names keep working. */
const KIND_NOUN: Record<"" | DocItemKind, string> = { "": "Line", org: "Job", title: "Job title", bullet: "Bullet", skill: "Skill", school: "School" };
const hasLabel = (kind?: DocItemKind) => kind === "bullet" || kind === "skill";
const rightName = (kind?: DocItemKind) => (kind === "org" || kind === "school" ? "Location" : kind === "title" ? "Dates" : null);

/** Choosing a type: the text is always kept, and the label and right-hand text are dropped when the new type hides them. */
function withKind(item: DocItem, value: string): DocItem {
  const { kind: _kind, label, right, ...rest } = item;
  const kind = isDocItemKind(value) ? value : undefined;
  return { ...rest, ...(kind ? { kind } : {}), ...(hasLabel(kind) && label ? { label } : {}), ...(rightName(kind) && right ? { right } : {}) };
}

/** A line added with "Add line" is plain, unless the line above it is a bullet: then it is a bullet too, so a run of bullets is quick to enter. */
const blankItem = (after?: DocItem): DocItem => ({ id: newItemId(), text: "", ...(after?.kind === "bullet" ? { kind: "bullet" as const } : {}) });

/** The fields of one line: its type, a label for a bullet or skill, the text, and the right-hand value for a job, school or title. */
function ItemFields({ item, k, where, onChange }: { item: DocItem; k: number; where: string; onChange(change: (x: DocItem) => DocItem): void }) {
  const labelled = hasLabel(item.kind);
  const right = rightName(item.kind);
  return (
    <div className={`doc-line-fields${labelled ? " has-label" : ""}${right ? " has-right" : ""}`}>
      <select className="doc-kind" aria-label={`Type of line ${k + 1} of ${where}`} value={item.kind ?? ""} onChange={(e) => onChange((x) => withKind(x, e.target.value))}>
        {(Object.entries(KIND_NOUN) as ["" | DocItemKind, string][]).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select>
      {labelled && (
        <input type="text" className="doc-label" placeholder="Label" aria-label={`Label of line ${k + 1} of ${where}`} value={item.label ?? ""} maxLength={MAX_DOC_LABEL_CHARS}
               onChange={(e) => onChange((x) => ({ ...x, label: e.target.value }))} />
      )}
      <textarea
        rows={1} aria-label={`${KIND_NOUN[item.kind ?? ""]} ${k + 1} of ${where}`} value={item.text} maxLength={MAX_DOC_ITEM_CHARS} data-field={item.id}
        onChange={(e) => onChange((x) => ({ ...x, text: e.target.value }))}
      />
      {right && (
        <input type="text" className="doc-right" placeholder={right} aria-label={`${right} of line ${k + 1} of ${where}`} value={item.right ?? ""} maxLength={MAX_DOC_RIGHT_CHARS}
               onChange={(e) => onChange((x) => ({ ...x, right: e.target.value }))} />
      )}
    </div>
  );
}

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
  const setItem = (i: number, id: string, change: (x: DocItem) => DocItem) =>
    setSection(i, { ...sections[i], items: sections[i].items.map((x) => (x.id === id ? change(x) : x)) });
  const move = (items: DocSection["items"], from: number, to: number) => {
    const copy = [...items];
    [copy[from], copy[to]] = [copy[to], copy[from]];
    return copy;
  };

  return (
    <div className="doc-editor" role="group" aria-label={label} ref={root}>
      {sections.map((s, i) => {
        // lowercase here, inside "Line 2 of section 1"; the section's own label below is "Section 1". Both are kept for existing test names.
        const where = s.heading || `section ${i + 1}`;
        return (
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
                <ItemFields item={item} k={k} where={where} onChange={(change) => setItem(i, item.id, change)} />
                <div className="doc-line-actions">
                  <button type="button" className="icon" aria-label={`Move line ${k + 1} up`} disabled={k === 0}
                          onClick={() => setSection(i, { ...s, items: move(s.items, k, k - 1) })}>
                    <ArrowUp size={16} strokeWidth={3} aria-hidden="true" />
                  </button>
                  <button type="button" className="icon" aria-label={`Move line ${k + 1} down`} disabled={k === s.items.length - 1}
                          onClick={() => setSection(i, { ...s, items: move(s.items, k, k + 1) })}>
                    <ArrowDown size={16} strokeWidth={3} aria-hidden="true" />
                  </button>
                  <button type="button" className="icon" aria-label={`Remove line ${k + 1}`}
                          onClick={() => setSection(i, { ...s, items: s.items.filter((x) => x.id !== item.id) })}>
                    <X size={16} strokeWidth={3} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className="quiet" disabled={s.items.length >= MAX_DOC_ITEMS} onClick={() => {
            const item = blankItem(s.items[s.items.length - 1]);
            setSection(i, { ...s, items: [...s.items, item] });
            setFocusId(item.id);
          }}>Add line</button>
        </section>
        );
      })}
      <button type="button" disabled={sections.length >= MAX_DOC_SECTIONS} onClick={() => {
        const next: DocSection = { id: newItemId(), heading: "", items: [blankItem()] };
        onChange([...sections, next]);
        setFocusId(next.id);
      }}>Add section</button>
    </div>
  );
}

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { HEADER_HEADING, isHeaderHeading, newItemId } from "../../db/documentShape";
import { MAX_DOC_HEADING_CHARS, MAX_DOC_ITEM_CHARS, MAX_DOC_ITEMS, MAX_DOC_LABEL_CHARS, MAX_DOC_RIGHT_CHARS, MAX_DOC_SECTIONS } from "../../db/limits";
import type { DocItem, DocItemKind, DocSection } from "../../db/schema";
import { PLACEHOLDERS, placeholderFor, templateSectionOf } from "../../documents/blankResume";
import { measureSheetHeight, pageVerdictText } from "./onepage";
import { useOnePage } from "./useOnePage";
import "./resumesheet.css";
import "./pageeditor.css";

interface Props {
  sections: DocSection[];
  onChange(next: DocSection[]): void;
  /** names the sheet for screen readers, like "Master resume" */
  label: string;
  /** shown as the name's placeholder when the resume has no header section (the read-only sheet falls back to it too) */
  title?: string;
  /** the page-height probe, a seam for tests (jsdom has no layout). The default measures the typed text, not the fields. */
  measure?: (sheet: HTMLElement) => number;
}

/** What each kind is called in the accessible names of its fields and buttons ("Bullet 2 of Work experience"). No kind is a plain line. */
const NOUN: Record<"" | DocItemKind, string> = { "": "line", org: "job", title: "job title", bullet: "bullet", skill: "skill", school: "school" };
const ADD_NAME: Record<"" | DocItemKind, string> = { "": "line", org: "job", title: "title", bullet: "bullet", skill: "skill", school: "school" };
const ALL: ("" | DocItemKind)[] = ["", "bullet", "skill", "org", "title", "school"];
const hasLabel = (kind?: DocItemKind) => kind === "bullet" || kind === "skill";
const rightName = (kind?: DocItemKind) => (kind === "org" || kind === "school" ? "Location" : kind === "title" ? "Dates" : null);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const DEBOUNCE_MS = 250;

/** The buttons of a section's "add" row, the likely next line first (a job is followed by its title, a title by its bullets...). */
function addOrder(items: DocItem[], heading: string): ("" | DocItemKind)[] {
  const last = items[items.length - 1];
  let first: ("" | DocItemKind)[];
  if (last) {
    const next: Record<"" | DocItemKind, ("" | DocItemKind)[]> = {
      org: ["title", "bullet"], title: ["bullet", "title"], bullet: ["bullet", "org", "title"], skill: ["skill", ""], school: ["", "school"], "": ["", "bullet", "skill"],
    };
    first = next[last.kind ?? ""];
  } else {
    const section = templateSectionOf(heading);
    first = section === "experience" ? ["org"] : section === "skills" ? ["skill"] : section === "education" ? ["school"] : [""];
  }
  return [...first, ...ALL.filter((k) => !first.includes(k))];
}

/** Text pasted into a field is plain: newlines become spaces in a one-line field, and what is pasted is cut to the field's limit. */
function pasteInto(single: boolean, max: number, set: (v: string) => void) {
  return (e: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    e.preventDefault();
    let text = e.clipboardData.getData("text/plain");
    text = single ? text.replace(/\s*[\r\n]+\s*/g, " ") : text.replace(/\r\n?/g, "\n");
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    text = text.slice(0, Math.max(0, max - (el.value.length - (end - start))));
    el.setRangeText(text, start, end, "end");
    set(el.value);
  };
}

const composing = (e: KeyboardEvent) => e.nativeEvent.isComposing;

interface FieldProps {
  fkey: string;
  /** the id FlagList's "Go to line" looks a field up by: the line's id (its text field) or the section's (its heading) */
  field?: string;
  value: string;
  label: string;
  placeholder: string;
  max: number;
  className: string;
  onValue(v: string): void;
  onKeyDown?(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void;
}

/** A one-line field in the sheet: it looks like the printed text. Enter moves on to the next field. */
function Single({ fkey, field, value, label, placeholder, max, className, onValue, onKeyDown, size }: FieldProps & { size?: number }) {
  return (
    <input
      type="text" className={`pe-field ${className}`} data-pe={fkey} data-field={field} aria-label={label} placeholder={placeholder} value={value} maxLength={max} size={size}
      onChange={(e) => onValue(e.target.value)} onPaste={pasteInto(true, max, onValue)} onKeyDown={onKeyDown}
    />
  );
}

const nativeSizing = () => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");

/** A field that grows with its text: `field-sizing: content` where there is one, the textarea's scroll height where there is not. */
function Multi({ fkey, field, value, label, placeholder, max, className, onValue, onKeyDown }: FieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || nativeSizing()) return;
    const fit = () => {
      el.style.height = "auto";
      if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    // a narrower or wider sheet re-wraps the text
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [value]);
  return (
    <textarea
      ref={ref} rows={1} className={`pe-field ${className}`} data-pe={fkey} data-field={field} aria-label={label} placeholder={placeholder} value={value} maxLength={max}
      onChange={(e) => onValue(e.target.value)} onPaste={pasteInto(false, max, onValue)} onKeyDown={onKeyDown}
    />
  );
}

interface ControlsProps {
  id: string;
  name: string;
  first: boolean;
  last: boolean;
  onMove(by: -1 | 1): void;
  onRemove(): void;
}

/** A line's move and remove buttons. They show on hover and focus on a desktop, always on a phone, and never print. */
function Controls({ id, name, first, last, onMove, onRemove }: ControlsProps) {
  return (
    <div className="pe-controls">
      <button type="button" className="pe-ctl" data-pe-ctl={`${id}:up`} aria-label={`Move ${name} up`} disabled={first} onClick={() => onMove(-1)}>
        <ArrowUp size={16} strokeWidth={3} aria-hidden="true" />
      </button>
      <button type="button" className="pe-ctl" data-pe-ctl={`${id}:down`} aria-label={`Move ${name} down`} disabled={last} onClick={() => onMove(1)}>
        <ArrowDown size={16} strokeWidth={3} aria-hidden="true" />
      </button>
      <button type="button" className="pe-ctl" data-pe-ctl={`${id}:remove`} aria-label={`Remove ${name}`} onClick={onRemove}>
        <X size={16} strokeWidth={3} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * The page measured as it would print: the sheet with each field turned into the text inside it (so the typed text counts, not a
 * field's height), the controls left out, and empty fields collapsing as the lines `normalizeSections` drops would.
 */
export function measureEditableSheet(sheet: HTMLElement): number {
  const copy = sheet.cloneNode(true) as HTMLElement;
  const live = [...sheet.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")];
  copy.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea").forEach((field, i) => {
    const span = document.createElement("span");
    span.className = field.className.replace("pe-field", "pe-text");
    span.textContent = live[i]?.value ?? "";
    field.replaceWith(span);
  });
  copy.querySelectorAll(".pe-controls, .pe-add").forEach((el) => el.remove());
  return measureSheetHeight(copy);
}

/**
 * A resume as the printed page itself: the classic sheet, every text a field you type into where it is. It is controlled like SectionsEditor
 * (`sections` and `onChange`) and never saves. The sheet works on the list it is given: a missing header is made on the first edit of the name or
 * contact line, and empty lines stay in the list until the caller saves (normalizeSections drops them then).
 */
export function PageEditor({ sections, onChange, label, title, measure = measureEditableSheet }: Props) {
  const sheet = useRef<HTMLElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  useEffect(() => {
    if (!focusKey) return;
    const el = sheet.current?.querySelector<HTMLElement>(`[data-pe="${focusKey}"], [data-pe-ctl="${focusKey}"]`);
    el?.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.setSelectionRange(el.value.length, el.value.length);
    setFocusKey(null);
  }, [focusKey]);

  // The one-page check: advisory, measured a moment after typing stops.
  const [settled, setSettled] = useState(sections);
  useEffect(() => {
    const t = setTimeout(() => setSettled(sections), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [sections]);
  const verdict = useOnePage(sheet, [settled], measure);

  const header = sections.find((s) => isHeaderHeading(s.heading));
  const namePlaceholder = !header && title ? title : PLACEHOLDERS.name;

  const setSection = (id: string, change: (s: DocSection) => DocSection) => onChange(sections.map((s) => (s.id === id ? change(s) : s)));
  const setItem = (sid: string, id: string, change: (x: DocItem) => DocItem) =>
    setSection(sid, (s) => ({ ...s, items: s.items.map((x) => (x.id === id ? change(x) : x)) }));

  /** The name (item 0) or a contact line (item 1 and on) of the header, made on the first edit when the resume has none. */
  const setHeaderText = (index: number, text: string) => {
    const items = [...(header?.items ?? [])];
    while (items.length <= index) items.push({ id: newItemId(), text: "" });
    items[index] = { ...items[index], text };
    if (header) onChange(sections.map((s) => (s === header ? { ...s, items } : s)));
    else onChange([{ id: newItemId(), heading: HEADER_HEADING, items }, ...sections]);
  };

  /** Every field of the sheet, in reading order, as `data-pe` keys. */
  const fieldKeys = () => [...(sheet.current?.querySelectorAll<HTMLElement>("[data-pe]") ?? [])].map((el) => el.dataset.pe!);
  const focusAfter = (key: string) => {
    const keys = fieldKeys();
    const next = keys[keys.indexOf(key) + 1];
    if (next) setFocusKey(next);
  };
  /** After a line goes, focus the field before its first one (the heading, for the first line of a section). */
  const focusBefore = (itemId: string) => {
    const keys = fieldKeys();
    const at = keys.findIndex((k) => k.startsWith(`${itemId}:`));
    if (at > 0) setFocusKey(keys[at - 1]);
  };
  const enterMovesOn = (key: string) => (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || composing(e)) return;
    e.preventDefault();
    focusAfter(key);
  };

  const addItem = (sid: string, kind: "" | DocItemKind, at?: number) => {
    const section = sections.find((s) => s.id === sid);
    if (!section || section.items.length >= MAX_DOC_ITEMS) return;
    const item: DocItem = { id: newItemId(), text: "", ...(kind ? { kind } : {}) };
    const items = [...section.items];
    items.splice(at ?? items.length, 0, item);
    setSection(sid, (s) => ({ ...s, items }));
    setFocusKey(`${item.id}:${hasLabel(kind || undefined) ? "label" : "text"}`);
  };
  const removeItem = (sid: string, id: string) => {
    focusBefore(id);
    setSection(sid, (s) => ({ ...s, items: s.items.filter((x) => x.id !== id) }));
  };
  const moveItem = (sid: string, k: number, by: -1 | 1) => {
    const id = sections.find((s) => s.id === sid)!.items[k].id;
    setSection(sid, (s) => {
      const items = [...s.items];
      [items[k], items[k + by]] = [items[k + by], items[k]];
      return { ...s, items };
    });
    // the moved line's button keeps focus, or its neighbour when it reached an end
    const to = k + by;
    const count = sections.find((s) => s.id === sid)!.items.length;
    setFocusKey(`${id}:${by === -1 ? (to > 0 ? "up" : "down") : to < count - 1 ? "down" : "up"}`);
  };

  /** Enter in a bullet or skill adds one below; Backspace in an empty one removes it. Shift+Enter is a newline. */
  const lineKeys = (sid: string, item: DocItem, k: number) => (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (composing(e)) return;
    if (e.key === "Enter" && !e.shiftKey && hasLabel(item.kind)) {
      e.preventDefault();
      addItem(sid, item.kind!, k + 1);
    } else if (e.key === "Backspace" && hasLabel(item.kind) && !item.text && !item.label) {
      e.preventDefault();
      removeItem(sid, item.id);
    }
  };

  const line = (s: DocSection, si: number, item: DocItem, k: number, legacy: boolean): ReactNode => {
    const where = s.heading || `section ${si + 1}`;
    const name = `${NOUN[legacy ? "" : item.kind ?? ""]} ${k + 1} of ${where}`;
    const kind = legacy ? undefined : item.kind;
    const textField = (multi: boolean) => {
      const props: FieldProps = {
        fkey: `${item.id}:text`, field: item.id, value: item.text, label: capital(name), placeholder: placeholderFor(s.heading, kind, "text", k), max: MAX_DOC_ITEM_CHARS,
        className: "pe-grow", onValue: (text) => setItem(s.id, item.id, (x) => ({ ...x, text })),
        onKeyDown: multi ? lineKeys(s.id, item, k) : enterMovesOn(`${item.id}:text`),
      };
      return multi ? <Multi {...props} /> : <Single {...props} />;
    };
    const labelField = () => {
      const ph = placeholderFor(s.heading, kind, "label");
      return (
        <>
          <Single
            fkey={`${item.id}:label`} value={item.label ?? ""} label={`Label of ${name}`} placeholder={ph} max={MAX_DOC_LABEL_CHARS} className="pe-label pe-b"
            size={Math.max((item.label || ph).length, 4)} onValue={(label) => setItem(s.id, item.id, (x) => ({ ...x, label }))}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !item.label && !item.text && !composing(e)) lineKeys(s.id, item, k)(e);
              else enterMovesOn(`${item.id}:label`)(e);
            }}
          />
          {item.label ? <span className="pe-colon pe-b" aria-hidden="true">:</span> : null}
        </>
      );
    };
    const controls = (
      <Controls
        id={item.id} name={name} first={k === 0} last={k === s.items.length - 1}
        onMove={(by) => moveItem(s.id, k, by)} onRemove={() => removeItem(s.id, item.id)}
      />
    );
    switch (kind) {
      case "org":
      case "school":
      case "title": {
        const title = kind === "title";
        const right = rightName(kind)!;
        const tone = title ? "pe-i" : "pe-b";
        return (
          <div key={item.id} className={`pe-line ${title ? "doc-title" : "doc-org"}`}>
            <div className="doc-row">
              <Single
                fkey={`${item.id}:text`} field={item.id} value={item.text} label={capital(name)} placeholder={placeholderFor(s.heading, kind, "text", k)} max={MAX_DOC_ITEM_CHARS}
                className={`pe-grow ${tone}`} onValue={(text) => setItem(s.id, item.id, (x) => ({ ...x, text }))} onKeyDown={enterMovesOn(`${item.id}:text`)}
              />
              <Single
                fkey={`${item.id}:right`} value={item.right ?? ""} label={`${right} of ${name}`} placeholder={placeholderFor(s.heading, kind, "right", k)}
                max={MAX_DOC_RIGHT_CHARS} className={`doc-right pe-right ${tone}`} onValue={(r) => setItem(s.id, item.id, (x) => ({ ...x, right: r }))}
                onKeyDown={enterMovesOn(`${item.id}:right`)}
              />
            </div>
            {controls}
          </div>
        );
      }
      case "skill":
        return (
          <div key={item.id} className="pe-line pe-p">
            <div className="pe-inline">{labelField()}{textField(true)}</div>
            {controls}
          </div>
        );
      case "bullet":
        return (
          <li key={item.id} className="pe-line">
            <div className="pe-inline">{labelField()}{textField(true)}</div>
            {controls}
          </li>
        );
      default:
        return legacy ? (
          <li key={item.id} className="pe-line">{textField(true)}{controls}</li>
        ) : (
          <div key={item.id} className="pe-line pe-p">{textField(true)}{controls}</div>
        );
    }
  };

  /** One section's lines in the same grouping as the read-only sheet: bullets in a shared list, a section of only plain lines a plain list. */
  const lines = (s: DocSection, si: number): ReactNode[] => {
    const legacy = s.items.length > 1 && s.items.every((i) => !i.kind);
    const out: ReactNode[] = [];
    let run: ReactNode[] = [];
    let runKey = "";
    const flush = () => {
      if (!run.length) return;
      out.push(<ul key={runKey} className={legacy ? undefined : "doc-bullets"}>{run}</ul>);
      run = [];
    };
    s.items.forEach((item, k) => {
      if (legacy || item.kind === "bullet") {
        if (!run.length) runKey = item.id;
        run.push(line(s, si, item, k, legacy));
      } else {
        flush();
        out.push(line(s, si, item, k, false));
      }
    });
    flush();
    return out;
  };

  const contact = header ? header.items.slice(1) : [];
  const contactFields = Math.max(1, contact.length);

  return (
    <div className="page-editor">
      <p className="doc-fit muted pe-status" role="status">{verdict ? pageVerdictText(verdict) : ""}</p>
      <article ref={sheet} className="doc-sheet classic page-edit" role="group" aria-label={label}>
        <h1 className="page doc-name">
          <Single
            fkey={header?.items[0] ? `${header.items[0].id}:text` : "name"} field={header?.items[0]?.id} value={header?.items[0]?.text ?? ""} label="Name" placeholder={namePlaceholder}
            max={MAX_DOC_ITEM_CHARS} className="pe-center" onValue={(t) => setHeaderText(0, t)} onKeyDown={enterMovesOn(header?.items[0] ? `${header.items[0].id}:text` : "name")}
          />
        </h1>
        <div className="doc-contact">
          {Array.from({ length: contactFields }, (_, n) => {
            const item = contact[n];
            const key = item ? `${item.id}:text` : `contact${n}`;
            return (
              <Single
                key={`contact${n}`} fkey={key} field={item?.id} value={item?.text ?? ""} label={n === 0 ? "Contact line" : `Contact line ${n + 1}`}
                placeholder={n === 0 ? PLACEHOLDERS.contact : ""} max={MAX_DOC_ITEM_CHARS} className="pe-center"
                onValue={(t) => setHeaderText(n + 1, t)} onKeyDown={enterMovesOn(key)}
              />
            );
          })}
        </div>
        {sections.map((s, si) => {
          if (s === header) return null;
          const where = s.heading || `section ${si + 1}`;
          const full = s.items.length >= MAX_DOC_ITEMS;
          return (
            <section key={s.id} className="doc-block">
              <h2>
                <Single
                  fkey={`${s.id}:heading`} field={s.id} value={s.heading} label={`Heading of section ${si + 1}`} placeholder="Section heading" max={MAX_DOC_HEADING_CHARS}
                  className="pe-heading" onValue={(heading) => setSection(s.id, (x) => ({ ...x, heading }))} onKeyDown={enterMovesOn(`${s.id}:heading`)}
                />
              </h2>
              {lines(s, si)}
              <div className="pe-add" role="group" aria-label={`Add to ${where}`}>
                {addOrder(s.items, s.heading).map((kind) => (
                  <button key={kind || "line"} type="button" className="pe-addbtn" disabled={full} aria-label={`Add ${ADD_NAME[kind]} to ${where}`} onClick={() => addItem(s.id, kind)}>
                    Add {ADD_NAME[kind]}
                  </button>
                ))}
                <button type="button" className="pe-addbtn pe-remove" aria-label={`Remove section ${where}`} onClick={() => onChange(sections.filter((x) => x.id !== s.id))}>
                  Remove section
                </button>
              </div>
            </section>
          );
        })}
      </article>
      <button
        type="button" className="quiet pe-add-section" disabled={sections.length >= MAX_DOC_SECTIONS}
        onClick={() => {
          const next: DocSection = { id: newItemId(), heading: "", items: [{ id: newItemId(), text: "" }] };
          onChange([...sections, next]);
          setFocusKey(`${next.id}:heading`);
        }}
      >
        Add section
      </button>
    </div>
  );
}

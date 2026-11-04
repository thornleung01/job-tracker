import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Suggestion } from "../sync/queries";
import "./combobox.css";

const PER_GROUP = 6;
const lower = (s: string) => s.toLowerCase();

interface ComboboxProps {
  id: string;
  value: string;
  onChange(value: string): void;
  /** called when a suggestion is picked, with its text */
  onChoose(text: string): void;
  suggestions: Suggestion[];
  placeholder?: string;
  listLabel?: string;
}

/**
 * A search field with suggestions: a combobox over the companies and roles that exist. Typing filters them and picking one
 * searches for it. Enter on plain text is left to the surrounding form. Everything is drawn as text, never as HTML.
 */
export function Combobox({ id, value, onChange, onChoose, suggestions, placeholder, listLabel = "Companies and roles you have" }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const q = value.trim();

  const items = useMemo(() => {
    const needle = lower(q);
    const pick = (kind: Suggestion["kind"]) =>
      suggestions.filter((s) => s.kind === kind && (!needle || lower(s.text).includes(needle)))
        .sort((a, b) => (lower(a.text).startsWith(needle) ? 0 : 1) - (lower(b.text).startsWith(needle) ? 0 : 1)).slice(0, PER_GROUP);
    return [...pick("Company"), ...pick("Role")];
  }, [suggestions, q]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const choose = (i: number) => {
    onChoose(items[i].text);
    close();
  };
  const move = (step: number) => {
    if (!open) {
      setOpen(true);
      if (!items.length) return;
      setActive(step > 0 ? 0 : items.length - 1);
      return;
    }
    if (!items.length) return;
    setActive((a) => (a + step + items.length) % items.length);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter" && open && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      close();
    }
  };

  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-opt-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, id]);

  const optionId = (i: number) => `${id}-opt-${i}`;
  let lastKind: string | null = null;
  return (
    <div className="combo-wrap">
      <input
        id={id} name="q" value={value} placeholder={placeholder} autoComplete="off"
        role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => {
          if (closeTimer.current) clearTimeout(closeTimer.current);
          setOpen(true);
        }}
        onBlur={() => {
          closeTimer.current = setTimeout(close, 120);
        }}
        onKeyDown={onKeyDown}
      />
      <ul id={`${id}-list`} className="combo-list" role="listbox" aria-label={listLabel} hidden={!open}>
        {!items.length ? (
          <li className="combo-empty" role="presentation">
            {suggestions.length ? `Nothing matches "${q}". Press Enter to search anyway.` : "No applications yet."}
          </li>
        ) : null}
        {items.map((it, i) => {
          const heading = it.kind !== lastKind;
          lastKind = it.kind;
          const count = `${it.n} application${it.n === 1 ? "" : "s"}`;
          const at = q ? lower(it.text).indexOf(lower(q)) : -1;
          return (
            <Fragment key={`${it.kind}-${it.text}`}>
              {heading ? <li className="combo-group" role="presentation" aria-hidden="true">{it.kind === "Company" ? "Companies" : "Roles"}</li> : null}
              <li
                id={optionId(i)} role="option" aria-selected={i === active} aria-label={`${it.text}, ${it.kind.toLowerCase()}, ${count}`}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the field until the choice is made
                  choose(i);
                }}
              >
                <span>
                  {at < 0 ? it.text : <>{it.text.slice(0, at)}<b>{it.text.slice(at, at + q.length)}</b>{it.text.slice(at + q.length)}</>}
                </span>
                <span className="n">{count}</span>
              </li>
            </Fragment>
          );
        })}
      </ul>
    </div>
  );
}

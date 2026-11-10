import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { BaselineCompare } from "../../documents/compare";
import "./baselinemarks.css";

interface Bar {
  id: string;
  status: "changed" | "new";
  top: number;
  height: number;
  left: number;
}

interface Props {
  compare: BaselineCompare;
  /** false: the editor with no marks (the Compare toggle is off) */
  on: boolean;
  /** the line the person is in (or null), so the list of changes can show its word diff */
  onActive?(id: string | null): void;
  /** the on-page editor */
  children: ReactNode;
}

const GAP_PX = 10;

/**
 * Margin bars beside the lines of the tailored copy that differ from the baseline: a solid bar for a changed line, a dashed one for a line
 * the baseline doesn't have (the shape says which, so the bar never relies on colour). The editor underneath is untouched: each bar is placed
 * from where the line's field is on screen, and the bars are hidden from screen readers, which get the same facts from the list of changes.
 */
export function BaselineMarks({ compare, on, onActive, children }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [active, setActive] = useState<string | null>(null);

  // Measured after every render (the editor re-renders on each keystroke); the state only changes when a bar moved.
  useLayoutEffect(() => {
    const root = wrap.current;
    if (!root || !on) {
      setBars((prev) => (prev.length ? [] : prev));
      return;
    }
    const measure = () => {
      const box = root.getBoundingClientRect();
      const sheet = root.querySelector<HTMLElement>(".doc-sheet");
      const left = sheet ? sheet.getBoundingClientRect().left - box.left - GAP_PX : 0;
      const next: Bar[] = [];
      for (const [id, line] of Object.entries(compare.lines)) {
        if (line.status === "same") continue;
        const field = [...root.querySelectorAll<HTMLElement>("[data-field]")].find((el) => el.dataset.field === id);
        const row = field?.closest<HTMLElement>(".pe-line, h2");
        if (!row) continue;
        const r = row.getBoundingClientRect();
        next.push({ id, status: line.status, top: Math.round(r.top - box.top), height: Math.round(r.height), left: Math.round(left) });
      }
      setBars((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  });

  const focused = (id: string | null) => {
    setActive(id);
    onActive?.(id);
  };
  const lineOf = (target: EventTarget) => (target instanceof Element ? target.closest<HTMLElement>("[data-field]")?.dataset.field ?? null : null);

  return (
    <div
      ref={wrap} className={`bm-wrap${on ? " on" : ""}`}
      onFocus={(e) => focused(lineOf(e.target))}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focused(null); }}
    >
      {on ? bars.map((b) => (
        <span key={b.id} className={`bm-bar ${b.status}${b.id === active ? " active" : ""}`} data-line={b.id} data-status={b.status} aria-hidden="true"
          style={{ top: b.top, height: b.height, left: b.left }} />
      )) : null}
      {children}
    </div>
  );
}

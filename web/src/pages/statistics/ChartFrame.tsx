import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { usePhone } from "../../app/usePhone";

/** What a chart draws on each mark so the frame can show its tooltip, move between marks with the arrow keys and read it aloud. */
interface MarkProps {
  "data-key": string;
  role: "img";
  tabIndex: number;
  "aria-label": string;
  onMouseMove(e: MouseEvent): void;
  onMouseLeave(): void;
  onFocus(e: FocusEvent<Element>): void;
  onBlur(): void;
  onClick(e: MouseEvent): void;
  onKeyDown(e: KeyboardEvent): void;
}
/** Spread the result on a transparent shape that is bigger than the mark: `<rect {...bind("w:1", <>tip</>, "Week of Nov 2: 3")} />`. */
type BindMark = (key: string, tip: ReactNode, label: string) => MarkProps;

interface Tip {
  key: string;
  x: number;
  y: number;
  content: ReactNode;
}

interface Props {
  title: string;
  /** one line of plain text under the title: what the chart says, in words */
  note?: ReactNode;
  /** every mark's key in reading order: the frame gives the first one the tab stop and moves along them with the arrow keys */
  keys: readonly string[];
  /** the table that holds the same numbers, shown under "Table view" */
  table: ReactNode;
  /** goes under the chart, above the table view: a legend or a caption */
  footer?: ReactNode;
  /**
   * The chart's drawn width. Charts draw in viewBox units, so one that is scaled down to a phone shrinks its text with it. With this the frame
   * measures the card and hands the chart that many units (never more than `max`), so 12 units of text are 12px. `fallback` is the width
   * before anything is measured (and where nothing can be, as in tests).
   */
  size?: { fallback: number; max: number };
  /** draws the chart. Marks get their tooltip, focus and keyboard behaviour from `bind`; `width` is the drawn width in viewBox units. */
  children(bind: BindMark, width: number): ReactNode;
}

/** Narrower than this a chart stops getting narrower: it shrinks a little instead. */
const MIN_CHART_WIDTH = 260;

/**
 * The card every Statistics chart sits in: a heading, the chart, a tooltip that follows the pointer (a tap pins it on a phone), arrow
 * keys that move between marks, and a "Table view" with the same numbers. The chart itself is each component's own SVG.
 */
export function ChartFrame({ title, note, keys, table, footer, size, children }: Props) {
  const id = useId();
  const phone = usePhone();
  const phoneRef = useRef(phone);
  useLayoutEffect(() => {
    phoneRef.current = phone;
  });
  const [tip, setTip] = useState<Tip | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const pinned = useRef<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(0);
  useLayoutEffect(() => {
    const box = wrapRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const read = () => setMeasured(Math.round(box.clientWidth));
    read();
    const watch = new ResizeObserver(read);
    watch.observe(box);
    return () => watch.disconnect();
  }, []);
  const width = size ? (measured > 0 ? Math.max(MIN_CHART_WIDTH, Math.min(measured, size.max)) : size.fallback) : 0;
  const [tableOpen, setTableOpen] = useState(phone); // on a narrow screen the table is the readable version of the chart

  // Touch screens have no hover: tapping anywhere outside a mark closes the pinned tooltip.
  useEffect(() => {
    const away = (e: globalThis.MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.("[data-key]")) {
        pinned.current = null;
        setTip(null);
      }
    };
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  }, []);

  useLayoutEffect(() => {
    const el = tipRef.current;
    const box = wrapRef.current;
    if (!tip || !el || !box) return;
    const r = box.getBoundingClientRect();
    let left = tip.x - r.left + 14;
    if (left + el.offsetWidth > r.width) left = tip.x - r.left - el.offsetWidth - 14;
    el.style.left = `${Math.max(4, left)}px`;
    el.style.top = `${tip.y - r.top + 14}px`;
  }, [tip]);

  const roving = keys.includes(active ?? "") ? active : keys[0];
  const bind: BindMark = (key, content, label) => {
      const at = keys.indexOf(key);
      const move = (to: number) => {
        const next = keys[Math.max(0, Math.min(keys.length - 1, to))];
        [...(wrapRef.current?.querySelectorAll<SVGElement>("[data-key]") ?? [])].find((el) => el.getAttribute("data-key") === next)?.focus();
      };
      return {
        "data-key": key,
        role: "img",
        tabIndex: key === roving ? 0 : -1,
        "aria-label": label,
        onMouseMove: (e) => {
          if (!phoneRef.current) setTip({ key, x: e.clientX, y: e.clientY, content });
        },
        onMouseLeave: () => {
          if (!phoneRef.current) setTip(null);
        },
        onFocus: (e) => {
          setActive(key);
          const r = e.currentTarget.getBoundingClientRect();
          setTip({ key, x: r.left + r.width / 2, y: r.top + r.height / 2, content });
        },
        onBlur: () => {
          pinned.current = null;
          setTip(null);
        },
        // On a phone a tap pins the tooltip; tapping the same mark again closes it.
        onClick: (e) => {
          if (!phoneRef.current) return;
          if (pinned.current === key) {
            pinned.current = null;
            setTip(null);
          } else {
            pinned.current = key;
            setTip({ key, x: e.clientX, y: e.clientY, content });
          }
        },
        onKeyDown: (e) => {
          const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? at + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? keys.length - 1 : null;
          if (to === null) return;
          e.preventDefault();
          move(to);
        },
      };
  };

  return (
    <section className="card viz-root" aria-labelledby={id}>
      <h2 className="section" id={id}>{title}</h2>
      {note ? <p className="chart-note">{note}</p> : null}
      <div className="chart-wrap" ref={wrapRef}>
        {children(bind, width)}
        <div ref={tipRef} className="tip" hidden={!tip}>
          {tip?.content}
        </div>
      </div>
      {footer}
      <details className="chart-table" open={tableOpen} onToggle={(e) => setTableOpen(e.currentTarget.open)}>
        <summary className="disclosure">
          <span className="chev" aria-hidden="true"></span>Table view
        </summary>
        {table}
      </details>
    </section>
  );
}

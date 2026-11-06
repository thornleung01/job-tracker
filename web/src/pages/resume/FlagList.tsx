// "Check these lines": the lines an AI conversion wasn't sure about, shown above the editor in the review.
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { DocSection } from "../../db/schema";
import type { ConvertFlag } from "../../sync/convert";

const flagKey = (f: ConvertFlag) => `${f.itemId}:${f.kind}`;

const textsOf = (sections: DocSection[]) => new Map(sections.flatMap((s) => s.items).map((i) => [i.id, i.text]));

/** Each flag can be jumped to in the editor, or dismissed once it has been checked. A line that was edited or deleted in the editor (`sections`, compared with `converted`, what the AI gave) has been looked at, so it drops out of the list. */
export function FlagList({ flags, converted, sections, root, heading }: {
  flags: ConvertFlag[]; converted: DocSection[]; sections: DocSection[]; root: RefObject<HTMLElement | null>; heading: RefObject<HTMLElement | null>;
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const idBase = useId();
  const list = useRef<HTMLUListElement>(null);
  const next = useRef<number | null>(null);
  const lines = textsOf(sections);
  const original = textsOf(converted);
  const shown = flags.filter((f) => lines.has(f.itemId) && lines.get(f.itemId) === original.get(f.itemId) && !dismissed.has(flagKey(f)));

  // The Dismiss that was pressed is gone: focus goes to the next one, or to the card heading when none are left.
  useEffect(() => {
    if (next.current === null) return;
    const buttons = list.current?.querySelectorAll<HTMLElement>("button[data-dismiss]");
    const target = buttons?.length ? buttons[Math.min(next.current, buttons.length - 1)] : heading.current;
    next.current = null;
    target?.focus();
  }, [dismissed, heading]);

  if (!shown.length) return null;
  const go = (id: string) => root.current?.querySelector<HTMLElement>(`[data-field="${id}"]`)?.focus();
  return (
    <div className="convert-flags">
      <h3 className="convert-flags-title">Check these lines</h3>
      <ul ref={list}>
        {shown.map((f, i) => (
          <li key={flagKey(f)}>
            <div className="convert-flag-text">
              <p className="convert-flag-note">{f.note}</p>
              <p className="muted small convert-flag-line" id={`${idBase}-${i}`}>{lines.get(f.itemId)}</p>
            </div>
            <div className="row convert-flag-actions">
              <button type="button" aria-describedby={`${idBase}-${i}`} onClick={() => go(f.itemId)}>Go to line</button>
              <button type="button" data-dismiss aria-describedby={`${idBase}-${i}`} onClick={() => { next.current = i; setDismissed(new Set(dismissed).add(flagKey(f))); }}>Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

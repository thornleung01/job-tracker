import { useEffect, useRef, useState, type RefObject } from "react";

export interface Selection {
  /** the selected applications that are in the list now, in list order */
  ids: number[];
  has(id: number): boolean;
  toggle(id: number): void;
  /** selects every row in the list, or none */
  setAll(on: boolean): void;
  /** how much of the list is selected, for the header checkbox */
  state: "none" | "some" | "all";
  clear(): void;
  /** the header checkbox, so focus can go back to it when the bar closes */
  allBox: RefObject<HTMLInputElement | null>;
}

/**
 * Which applications are ticked in the list. It lives in the page's state only, not the address. Anything no longer in the list
 * drops out, and the whole selection is cleared when `resetKey` changes (the filters).
 */
export function useSelection(rowIds: readonly number[] | undefined, resetKey: string): Selection {
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const allBox = useRef<HTMLInputElement | null>(null);
  useEffect(() => setPicked(new Set()), [resetKey]);

  const rows = rowIds ?? [];
  const ids = rows.filter((id) => picked.has(id));
  const state = ids.length === 0 ? "none" : ids.length === rows.length ? "all" : "some";
  return {
    ids,
    has: (id) => picked.has(id),
    toggle: (id) =>
      setPicked((p) => {
        const next = new Set(p);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    setAll: (on) => setPicked(on ? new Set(rows) : new Set()),
    state,
    clear: () => setPicked(new Set()),
    allBox,
  };
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Stage } from "../../db/stages";
import { BULK_MAX } from "../../sync/bulk";

/** What the selection needs to know about each row in the list: its id, and its stage and resume as they stand, for the Undo after a bulk stage or resume change. */
export interface SelectableRow {
  id: number;
  stage: Stage;
  stageAt: string | null;
  locked: boolean;
  /** the resume version sent; absent when none is set */
  resumeId?: number;
}

export interface Selection {
  /** the selected applications that are in the list now, in list order */
  ids: number[];
  /** the same applications with their stage as the list shows it */
  selected: SelectableRow[];
  has(id: number): boolean;
  /** ticks or unticks one row. Ticking is refused at BULK_MAX, the most one action takes. */
  toggle(id: number): void;
  /** selects the first BULK_MAX rows in the list, or none */
  setAll(on: boolean): void;
  /** how much of the list is selected, for the header checkbox */
  state: "none" | "some" | "all";
  /** true when more rows are in the list than BULK_MAX and the selection has stopped at BULK_MAX */
  capped: boolean;
  clear(): void;
  /** the header checkbox, so focus can go back to it when the bar closes */
  allBox: RefObject<HTMLInputElement | null>;
  /** the key the selection was last reset for, so what hangs off the selection (a result line) can reset with it */
  resetKey: string;
}

const NONE: ReadonlySet<number> = new Set();
const NO_ROWS: readonly SelectableRow[] = [];

/**
 * Which applications are ticked in the list. It lives in the page's state only, not the address. Anything no longer in the list
 * drops out, and the whole selection is cleared when `resetKey` changes (the filters).
 * The returned object is memoised and toggle, setAll and clear never change, so a memoised row can use them.
 */
export function useSelection(rows: readonly SelectableRow[] | undefined, resetKey: string): Selection {
  const [picked, setPicked] = useState<ReadonlySet<number>>(NONE);
  const allBox = useRef<HTMLInputElement | null>(null);
  const list = rows ?? NO_ROWS;

  // The latest list, for setAll, which has to stay the same function from one render to the next.
  const latest = useRef(list);
  useLayoutEffect(() => {
    latest.current = list;
  });

  // New filters, new selection. Already empty means no new Set, so no extra render.
  useEffect(() => setPicked((p) => (p.size ? NONE : p)), [resetKey]);
  // A row that left the list (a filter, or deleted from outside) mustn't come back ticked if it returns. Not while still loading.
  useEffect(() => {
    if (!rows) return;
    const here = new Set(rows.map((r) => r.id));
    setPicked((p) => {
      const kept = [...p].filter((id) => here.has(id));
      return kept.length === p.size ? p : kept.length ? new Set(kept) : NONE;
    });
  }, [rows]);

  const toggle = useCallback((id: number) => {
    setPicked((p) => {
      if (p.has(id)) {
        const next = new Set(p);
        next.delete(id);
        return next.size ? next : NONE;
      }
      return p.size >= BULK_MAX ? p : new Set(p).add(id);
    });
  }, []);
  const setAll = useCallback((on: boolean) => setPicked(on ? new Set(latest.current.slice(0, BULK_MAX).map((r) => r.id)) : NONE), []);
  const clear = useCallback(() => setPicked(NONE), []);
  const has = useCallback((id: number) => picked.has(id), [picked]);

  // Computed from the list as well as the set, so the count is right on the very render a row leaves.
  const selected = useMemo(() => list.filter((r) => picked.has(r.id)), [list, picked]);
  const ids = useMemo(() => selected.map((r) => r.id), [selected]);
  const state = ids.length === 0 ? "none" : ids.length === list.length ? "all" : "some";
  const capped = list.length > BULK_MAX && ids.length >= BULK_MAX;

  return useMemo(
    () => ({ ids, selected, has, toggle, setAll, state, capped, clear, allBox, resetKey }),
    [ids, selected, has, toggle, setAll, state, capped, clear, resetKey],
  );
}

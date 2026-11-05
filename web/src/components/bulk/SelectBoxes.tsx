import { useLayoutEffect } from "react";
import type { Selection } from "./useSelection";
import "./bulk.css";

/**
 * The checkbox at the start of a row. The label around it makes the whole cell a target, and a click on it never opens the row.
 * It takes plain values and a stable callback, not the whole selection, so a memoised row stays memoised.
 */
export function RowSelect({ id, company, checked, onToggle }: { id: number; company: string; checked: boolean; onToggle: (id: number) => void }) {
  return (
    <label className="bulk-pick">
      <input type="checkbox" aria-label={`Select ${company}`} checked={checked} onChange={() => onToggle(id)} />
    </label>
  );
}

/** The checkbox in the header: selects every row in the list (the first 500 when there are more), and shows a dash when only some are selected. */
export function SelectAll({ selection, disabled }: { selection: Selection; disabled?: boolean }) {
  const { allBox, state, capped } = selection;
  // The dash is a property, not an attribute, and is set before paint so it never flashes the wrong way.
  useLayoutEffect(() => {
    if (allBox.current) allBox.current.indeterminate = state === "some";
  }, [allBox, state]);
  return (
    <label className="bulk-pick">
      <input ref={allBox} type="checkbox" aria-label="Select all" disabled={disabled} checked={state === "all"} onChange={() => selection.setAll(state === "none" || (state === "some" && !capped))} />
    </label>
  );
}

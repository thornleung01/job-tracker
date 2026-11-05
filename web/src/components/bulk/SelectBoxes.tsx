import { useEffect } from "react";
import type { Selection } from "./useSelection";
import "./bulk.css";

/** The checkbox at the start of a row. The label around it makes the whole cell a target, and a click on it never opens the row. */
export function RowSelect({ selection, id, company }: { selection: Selection; id: number; company: string }) {
  return (
    <label className="bulk-pick">
      <input type="checkbox" aria-label={`Select ${company}`} checked={selection.has(id)} onChange={() => selection.toggle(id)} />
    </label>
  );
}

/** The checkbox in the header: selects every row in the list, and shows a dash when only some are selected. */
export function SelectAll({ selection, disabled }: { selection: Selection; disabled?: boolean }) {
  const { allBox, state } = selection;
  useEffect(() => {
    if (allBox.current) allBox.current.indeterminate = state === "some";
  }, [allBox, state]);
  return (
    <label className="bulk-pick">
      <input ref={allBox} type="checkbox" aria-label="Select all" disabled={disabled} checked={state === "all"} onChange={() => selection.setAll(state !== "all")} />
    </label>
  );
}

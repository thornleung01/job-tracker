import { useEffect, useRef, type Ref } from "react";
import type { ActionRunner } from "../useAction";

/** The id of the question, for the Delete button that opens it to point at. */
export const BULK_CONFIRM_ID = "bulk-delete-confirm";

interface Props {
  /** what is being deleted, like "2 applications" */
  what: string;
  act: ActionRunner;
  onDelete(): void;
  onCancel(): void;
  /** the Delete button, so focus can come back to it when a delete fails */
  deleteRef: Ref<HTMLButtonElement>;
}

/** The question in place before a bulk delete. Focus starts on Cancel, so a stray Enter never deletes anything. */
export function BulkDeleteConfirm({ what, act, onDelete, onCancel, deleteRef }: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div className="bulk-confirm" role="group" id={BULK_CONFIRM_ID} aria-labelledby="h-bulk-delete">
      <p id="h-bulk-delete" className="bulk-confirm-q">Delete {what}?</p>
      <p className="help">Their emails, notes and steps are removed. Your mailbox isn't touched.</p>
      <div className="row">
        <button type="button" className="danger" ref={deleteRef} onClick={onDelete} {...act.button("delete")}>Delete {what} and their emails</button>
        <button type="button" ref={cancel} onClick={onCancel} disabled={act.busy !== null}>Cancel</button>
      </div>
    </div>
  );
}

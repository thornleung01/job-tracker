import type { Ref } from "react";
import { InlineConfirm } from "../InlineConfirm";
import { TRASH_DAYS } from "../../sync/trash";
import type { ActionRunner } from "../useAction";

/** The id of the question, for the Delete button that opens it to point at. */
export const BULK_CONFIRM_ID = "bulk-delete-confirm";

interface Props {
  /** what is being deleted, like "2 applications" */
  what: string;
  act: ActionRunner;
  onDelete(): void;
  onCancel(): void;
  /** the Delete button that opened the question, so focus goes back to it on cancel */
  opener: HTMLElement | null;
  /** the confirm button, so focus can come back to it when a delete fails */
  deleteRef: Ref<HTMLButtonElement>;
}

/** The question in place before a bulk delete. */
export function BulkDeleteConfirm({ what, act, onDelete, onCancel, opener, deleteRef }: Props) {
  return (
    <InlineConfirm
      id={BULK_CONFIRM_ID}
      title={`Delete ${what}?`}
      help={`You can restore ${what === "1 application" ? "it" : "them"} for ${TRASH_DAYS} days.`}
      confirmLabel={`Delete ${what}`}
      onConfirm={onDelete}
      onCancel={onCancel}
      act={act}
      actionKey="delete"
      opener={opener}
      confirmRef={deleteRef}
    />
  );
}

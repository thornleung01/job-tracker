// The line shown for a few seconds after you delete an application, with a Restore button. It is not tied to a page: deleting
// from the detail page sends you to the list, and deleting from a list row closes the row, so a page's own state would lose it.
// Memory only, so a reload drops it (the application is still in Recently deleted).
import { useSyncExternalStore } from "react";
import { TRASH_DAYS } from "../../sync/trash";
import { UNDO_MS } from "../undo";

export interface DeletedNoticeState {
  text: string;
  /** what Restore brings back; empty when the line is only a confirmation */
  ids: number[];
  /** what was deleted, for the confirmation after Restore ("Acme", or "2 applications") */
  name: string;
  /** "err" for a problem: it is read out at once and stays until dismissed, instead of going after a few seconds */
  tone?: "info" | "err";
}

let current: DeletedNoticeState | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: DeletedNoticeState | null): void {
  clearTimeout(timer);
  current = next;
  if (next && next.tone !== "err") timer = setTimeout(() => set(null), UNDO_MS);
  for (const l of [...listeners]) l();
}

/** "Deleted Acme. It stays in Recently deleted for 30 days." with a Restore button for the next few seconds. */
export function announceDeleted(name: string, ids: number[]): void {
  set({ text: `Deleted ${name}. It stays in Recently deleted for ${TRASH_DAYS} days.`, ids, name });
}

/** A line with no button, like "Restored Acme." */
export function announce(text: string, tone: "info" | "err" = "info"): void {
  set({ text, ids: [], name: "", tone });
}

export function dismissNotice(): void {
  set(null);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function useDeletedNotice(): DeletedNoticeState | null {
  return useSyncExternalStore(subscribe, () => current);
}

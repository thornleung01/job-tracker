// A page with unsaved work can ask to be told before the person leaves it. One guard at a time (the page that is open): it says whether there is
// unsaved work and what to do when a move away was stopped. The Shell's links ask through blockLeave(); Back, Forward and an edited address
// are caught here on hashchange, put back where they were and handed to the same onBlocked. Moves that stay on the same page (a changed
// query) are never stopped. No React in this file.
//
// Limit: a stopped Back or Forward has already moved the browser's history by one entry, and the address is put back with replaceState, so
// that entry now shows the page's address too. Leaving for real afterwards works; the history just has one repeated entry.
import { matchRoute } from "./router";

export interface LeaveGuard {
  /** whether there is unsaved work right now */
  isDirty(): boolean;
  /** a move to `to` (a hash such as "#/people") was stopped: ask the person, then navigate on their say-so */
  onBlocked(to: string): void;
}

let guard: LeaveGuard | null = null;
let here = "";

const samePage = (a: string, b: string): boolean => matchRoute(a).path === matchRoute(b).path;

function onHashChange(): void {
  const next = window.location.hash;
  if (!guard || !guard.isDirty() || samePage(next, here)) {
    here = next;
    return;
  }
  // replaceState does not fire hashchange, so nothing else sees the address that was refused
  window.history.replaceState(null, "", window.location.pathname + window.location.search + here);
  guard.onBlocked(next);
}

/** Starts guarding; returns the function that stops. A later guard replaces an earlier one, and stopping an old one leaves the new one alone. */
export function registerLeaveGuard(next: LeaveGuard): () => void {
  guard = next;
  here = window.location.hash;
  window.addEventListener("hashchange", onHashChange);
  return () => {
    if (guard !== next) return;
    guard = null;
    window.removeEventListener("hashchange", onHashChange);
  };
}

/** For a link or a button that is about to move to `to` (a hash): true when it was stopped and the guard has been told. */
export function blockLeave(to: string): boolean {
  if (!guard || !guard.isDirty() || samePage(to, here)) return false;
  guard.onBlocked(to);
  return true;
}

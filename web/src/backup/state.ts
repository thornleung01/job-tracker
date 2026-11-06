// The backup bookkeeping for one account database: when it was last backed up and when the nudge was last snoozed.
//
// Kept in localStorage under a per-database key (the same pattern as the saved look in app/appearance.tsx), not in the
// database's settings table, on purpose:
//  - the JSON export dumps every settings row, so a row here would put "last backup: <earlier date>" inside the very
//    backup it describes, and importing it would bring back a date that is wrong for the new copy;
//  - settings also counts as data (isDatabaseEmpty, and the demo-data confirm), so a bookkeeping row would make an
//    emptied database look used;
//  - it is about this browser's relationship with the person's files, not about their applications.
// It holds two times and no personal data. When the browser clears the site's storage, the database goes with it.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { NO_BACKUP_STATE, stampNow, type BackupState } from "./schedule";

const keyFor = (dbName: string) => `jobtracker:backup:${dbName}`;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** A time that can be stored back: a string that parses as a date. Anything else (a hand-edited value) counts as unset. */
function validTime(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

export function parseBackupState(raw: string | null): BackupState {
  if (!raw) return NO_BACKUP_STATE;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    return { lastBackupAt: validTime(v?.lastBackupAt), snoozedAt: validTime(v?.snoozedAt) };
  } catch {
    return NO_BACKUP_STATE;
  }
}

function readRaw(dbName: string): string | null {
  try {
    return localStorage.getItem(keyFor(dbName));
  } catch {
    return null;
  }
}

export function readBackupState(dbName: string): BackupState {
  return parseBackupState(readRaw(dbName));
}

function write(dbName: string, state: BackupState): void {
  try {
    if (state.lastBackupAt === null && state.snoozedAt === null) localStorage.removeItem(keyFor(dbName));
    else localStorage.setItem(keyFor(dbName), JSON.stringify(state));
  } catch {
    // storage is full or blocked: the nudge just comes back next visit
  }
  emit();
}

/** A full backup was saved now. The snooze is cleared: it was about the backup that now exists. */
export function recordBackup(dbName: string, now: Date = new Date()): void {
  write(dbName, { lastBackupAt: stampNow(now), snoozedAt: null });
}

/** "Remind me in a week". */
export function snoozeNudge(dbName: string, now: Date = new Date()): void {
  write(dbName, { ...readBackupState(dbName), snoozedAt: stampNow(now) });
}

/** Forgets both times ("Delete all my data"). */
export function clearBackupState(dbName: string): void {
  write(dbName, NO_BACKUP_STATE);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // another tab on the same account changes the same key
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** The stored times for this database, kept current when they change here or in another tab. */
export function useBackupState(dbName: string): BackupState {
  const raw = useSyncExternalStore(subscribe, useCallback(() => readRaw(dbName), [dbName]));
  return useMemo(() => parseBackupState(raw), [raw]);
}

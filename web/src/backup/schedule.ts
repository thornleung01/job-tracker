// When to nudge about a backup. Pure rules over stored times and a clock, so they can be tested with fake dates in any
// time zone. Days are calendar days in the viewer's zone (db/time.ts idleDaysSince), so "12 days ago" always means the
// date is 12 days back, whatever the hour.
import { idleDaysSince, iso } from "../db/time";
import { plural } from "../sync/text";

/** A backup older than this many days is stale: the nudge shows once the last one is more than two weeks old. */
export const BACKUP_STALE_DAYS = 14;
/** "Remind me in a week" hides the nudge for this many calendar days. */
export const SNOOZE_DAYS = 7;

/** What is remembered about backups for one account database. Both are ISO instants, or null. */
export interface BackupState {
  lastBackupAt: string | null;
  snoozedAt: string | null;
}

export const NO_BACKUP_STATE: BackupState = { lastBackupAt: null, snoozedAt: null };

/** The time to store for "now". An instant at exactly 12:00:00Z would be read as a picked day (db/time.ts), so it moves one second. */
export function stampNow(now: Date = new Date()): string {
  const stamp = iso(now);
  return stamp.endsWith("T12:00:00Z") ? iso(now.getTime() + 1000) : stamp;
}

/** True when there is no backup, or the last one is more than BACKUP_STALE_DAYS days old. */
export function isBackupStale(lastBackupAt: string | null, now: Date = new Date(), timeZone?: string): boolean {
  const days = idleDaysSince(lastBackupAt, now, timeZone);
  return days === null || days > BACKUP_STALE_DAYS;
}

/** True for SNOOZE_DAYS calendar days after "Remind me in a week" was pressed. */
export function isSnoozed(snoozedAt: string | null, now: Date = new Date(), timeZone?: string): boolean {
  const days = idleDaysSince(snoozedAt, now, timeZone);
  return days !== null && days < SNOOZE_DAYS;
}

export interface NudgeInput {
  applications: number;
  state: BackupState;
  syncing: boolean;
  now?: Date;
  timeZone?: string;
}

/** Whether the backup nudge shows: there is something to lose, no sync is running, the backup is stale and it hasn't been snoozed. */
export function nudgeDue({ applications, state, syncing, now = new Date(), timeZone }: NudgeInput): boolean {
  if (applications < 1 || syncing) return false;
  return isBackupStale(state.lastBackupAt, now, timeZone) && !isSnoozed(state.snoozedAt, now, timeZone);
}

/** "never", "today", "yesterday" or "12 days ago". */
export function describeLastBackup(lastBackupAt: string | null, now: Date = new Date(), timeZone?: string): string {
  const days = idleDaysSince(lastBackupAt, now, timeZone);
  if (days === null) return "never";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${plural(days, "day")} ago`;
}

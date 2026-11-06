import type { JobTrackerDB } from "../db/schema";
import { useQuery } from "../app/useQuery";
import { describeLastBackup, nudgeDue } from "./schedule";
import { snoozeNudge, useBackupState } from "./state";
import { goToYourData } from "./goToYourData";
import { useSyncing } from "./useSyncing";
import "./backup.css";

interface Props {
  db: JobTrackerDB;
  /** the clock, for tests */
  now?: () => Date;
}

/**
 * A quiet reminder at the top of the Applications page: the applications live only in this browser and there is no
 * recent backup. It never shows in an empty database or while a sync runs, and "Remind me in a week" lasts across reloads.
 * It is a plain row, not a dialog, and nothing waits on it.
 */
export function BackupNudge({ db, now = () => new Date() }: Props) {
  // Counts every application, deleted ones included, on purpose: this is about not losing data, and an application in
  // Recently deleted is still in the database and in the backup file, and can be restored, so it is worth a backup.
  const applications = useQuery(() => db.applications.count(), [db]);
  const state = useBackupState(db.name);
  const syncing = useSyncing();
  const when = now();
  if (applications === undefined || !nudgeDue({ applications, state, syncing, now: when })) return null;

  function snooze() {
    snoozeNudge(db.name, now());
    // The row is about to go; keep keyboard focus on the page instead of dropping it to the top of the document.
    document.getElementById("main")?.focus();
  }

  return (
    <section className="backup-nudge" aria-label="Backup reminder">
      <span className="backup-nudge-text">
        Your applications only live in this browser. Last backup: {describeLastBackup(state.lastBackupAt, when)}.
      </span>
      <a className="backup-nudge-action" href="#/settings" onClick={(e) => { e.preventDefault(); goToYourData(); }}>Export a backup</a>
      <button type="button" className="muted" onClick={snooze}>Remind me in a week</button>
    </section>
  );
}

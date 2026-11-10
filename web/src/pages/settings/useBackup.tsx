// The backup actions behind the Data tab's Back up card and the Setup tab's Backup row: export a copy, choose a backup file,
// back up to it, stop using it. One hook so both places do exactly the same thing and say the same sentences.
import { useCallback, useEffect, useRef, useState } from "react";
import { backupContent } from "../../backup/content";
import type { BackupDeps } from "../../backup/deps";
import { backUpToFile, backupFileName, chooseBackupFile, forgetBackupFile, isFileBackupSupported, type BackupOptions } from "../../backup/fileBackup";
import { recordBackup } from "../../backup/state";
import type { StorageStatus } from "../../backup/storage";
import { InlineConfirm } from "../../components/InlineConfirm";
import type { ActionRunner } from "../../components/useAction";
import type { JobTrackerDB } from "../../db/schema";
import { exportAll, exportAllAsJson } from "../../portability";
import { plural } from "../../sync/text";
import { exportFilename } from "./actions";
import type { SettingsDeps } from "./deps";
import type { Reporter } from "./notice";

export function useBackup(db: JobTrackerDB, backup: BackupDeps, deps: Pick<SettingsDeps, "download">, report: Reporter, act: ActionRunner) {
  const { say } = report;
  const fileBackup = isFileBackupSupported(backup.file);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  /** the file holds more applications than this backup: nothing is written until the person agrees */
  const [confirmSmaller, setConfirmSmaller] = useState<{ name: string; inFile: number; inBackup: number; opener: HTMLElement | null } | null>(null);
  const backUpButton = useRef<HTMLButtonElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);

  // Reads the storage status again after something changed it (an import, deleting everything).
  const refreshStorage = useCallback(() => {
    void backup.storage().then(setStorage, () => undefined);
  }, [backup]);
  useEffect(() => {
    let current = true;
    void backup.storage().then((status) => { if (current) setStorage(status); }, () => undefined);
    return () => { current = false; };
  }, [backup]);
  useEffect(() => {
    if (!fileBackup) return;
    let current = true;
    void backupFileName(db.name, backup.file).then((name) => { if (current) setFileName(name); });
    return () => { current = false; };
  }, [db, backup, fileBackup]);

  async function exportData() {
    try {
      deps.download(exportFilename(), await exportAllAsJson(db));
      // Only this export is a full backup: the spreadsheet below has no emails or notes and can't be imported.
      recordBackup(db.name);
      say("ok", "Your data was exported.");
    } catch (e) {
      console.error(e);
      say("err", "Couldn't export your data. Try again.");
    }
  }

  /**
   * Writes the backup file. Nothing is written for an empty database, and a backup with fewer applications than the file
   * holds waits for a yes (see backup/fileBackup.ts), so a good backup is never replaced by a worse one by accident.
   */
  async function writeBackup(options?: BackupOptions, opener: HTMLElement | null = null) {
    const result = await backUpToFile(db.name, async () => backupContent(await exportAll(db)), backup.file, options);
    switch (result.status) {
      case "written":
        recordBackup(db.name);
        say("ok", `Backed up to ${result.name}.`);
        break;
      case "no-file":
        setFileName(null);
        say("err", "No backup file is chosen. Choose one first.");
        break;
      case "permission-denied":
        say("err", `Job Tracker needs your permission to write to ${result.name}.`);
        break;
      case "nothing-to-back-up":
        say("err", `There's nothing to back up yet, so ${result.name} was left as it is.`);
        break;
      case "would-shrink":
        report.clear();
        setConfirmSmaller({ name: result.name, inFile: result.inFile, inBackup: result.inBackup, opener });
        break;
      case "export-failed":
        say("err", "Couldn't read your data to back it up. Try again.");
        break;
      default:
        say("err", `Couldn't write to ${result.name}. Choose the file again.`);
    }
  }

  const backUpNow = () => act.run("backup", () => writeBackup(undefined, backUpButton.current));

  const chooseTarget = () =>
    act.run("choose", async () => {
      try {
        const name = await chooseBackupFile(db.name, exportFilename(), backup.file);
        if (name === null) return;
        setFileName(name);
      } catch (e) {
        console.error(e);
        say("err", "Couldn't choose a file. Try again.");
        return;
      }
      await writeBackup(undefined, chooseButton.current);
    });

  const replaceBackup = () =>
    act.run("replace-backup", async () => {
      try {
        await writeBackup({ replaceLarger: true });
      } finally {
        setConfirmSmaller(null);
      }
    });

  async function stopUsingFile() {
    try {
      await forgetBackupFile(db.name, backup.file);
      setFileName(null);
      say("ok", "Job Tracker will no longer write to that file.");
    } catch (e) {
      console.error(e);
      say("err", "Couldn't stop using the file. Try again.");
    }
  }

  /** The question that waits under the buttons when a backup would hold fewer applications than the file. */
  const smallerConfirm = confirmSmaller ? (
    <InlineConfirm
      title={`Replace the backup in ${confirmSmaller.name} with one that has fewer applications?`}
      help={`The file has ${plural(confirmSmaller.inFile, "application")}. This backup has ${confirmSmaller.inBackup}. This can't be undone.`}
      confirmLabel="Replace the backup"
      act={act}
      actionKey="replace-backup"
      opener={confirmSmaller.opener}
      onConfirm={() => void replaceBackup()}
      onCancel={() => setConfirmSmaller(null)}
    />
  ) : null;

  return { fileBackup, storage, fileName, setFileName, refreshStorage, backUpButton, chooseButton, exportData, backUpNow, chooseTarget, stopUsingFile, smallerConfirm };
}

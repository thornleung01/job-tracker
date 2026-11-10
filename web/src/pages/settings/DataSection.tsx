// The Data section: Back up (export JSON or CSV, the backup file), Restore (import), the Recently deleted card (handed in as
// children), a small Demo data line in a local build, and a separate danger area that deletes everything.
// Each of the actions that replace the data asks first, in place, with the shared InlineConfirm.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { realBackupDeps } from "../../backup/deps";
import { backupContent } from "../../backup/content";
import { backUpToFile, backupFileName, chooseBackupFile, forgetBackupFile, isFileBackupSupported, type BackupOptions } from "../../backup/fileBackup";
import { clearBackupState, recordBackup } from "../../backup/state";
import { describeStorage, type StorageStatus } from "../../backup/storage";
import "../../backup/backup.css";
import { InlineConfirm } from "../../components/InlineConfirm";
import { useAction } from "../../components/useAction";
import type { JobTrackerDB } from "../../db/schema";
import { hasData, loadDemoData } from "../../demo/loadDemo";
import { clearAll, exportAll, exportAllAsJson, ImportError } from "../../portability";
import { csvFilename } from "../../portability/csv";
import { describeImport, exportFilename, parseImportText, readFileText, runImport, type ParsedImport } from "./actions";
import type { SettingsDeps } from "./deps";
import { exportApplicationsCsv } from "./exportCsv";
import type { Reporter } from "./notice";
import { plural } from "../../sync/text";

interface Props {
  db: JobTrackerDB;
  /** only a local build offers the demo data */
  isLocal: boolean;
  deps: Pick<SettingsDeps, "download" | "downloadCsv" | "backup" | "ai">;
  report: Reporter;
  /** called after the AI key is forgotten, so the AI card shows "no key" */
  onKeyForgotten?: () => void;
  /** shown between Restore and the demo line: the Recently deleted card */
  children?: ReactNode;
}

/** The most import problems listed one by one before "And n more problems." */
const PROBLEMS_SHOWN = 8;

/** The real browser APIs, used when a caller hands in no fakes. */
const realBackup = realBackupDeps();

export function DataSection({ db, isLocal, deps, report, onKeyForgotten, children }: Props) {
  const { say } = report;
  const act = useAction();
  const [pendingImport, setPendingImport] = useState<{ name: string; parsed: ParsedImport } | null>(null);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** the file holds more applications than this backup: nothing is written until the person agrees */
  const [confirmSmaller, setConfirmSmaller] = useState<{ name: string; inFile: number; inBackup: number; opener: HTMLElement | null } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const backUpButton = useRef<HTMLButtonElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const demoButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);

  const backup = deps.backup ?? realBackup;
  const fileBackup = isFileBackupSupported(backup.file);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

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

  async function exportCsv() {
    try {
      deps.downloadCsv(csvFilename(), await exportApplicationsCsv(db));
      say("ok", "Your applications were exported.");
    } catch (e) {
      console.error(e);
      say("err", "Couldn't export your applications. Try again.");
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

  function importFailed(e: unknown) {
    if (e instanceof ImportError) {
      const more = e.problems.length - PROBLEMS_SHOWN;
      say("err", "This file can't be imported.", ...e.problems.slice(0, PROBLEMS_SHOWN), ...(more > 0 ? [`And ${more} more problems.`] : []));
    } else say("err", "Couldn't import this file. Try again.");
  }

  async function chooseFile(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    report.clear();
    try {
      setPendingImport({ name: file.name, parsed: parseImportText(await readFileText(file)) });
    } catch (e) {
      setPendingImport(null);
      importFailed(e);
    }
  }

  // Each of these catches its own errors and says what went wrong, so act.run only has to hold the buttons while it works.
  const confirmImport = () =>
    act.run("import", async () => {
      if (!pendingImport) return;
      try {
        say("ok", describeImport(await runImport(db, pendingImport.parsed)));
        refreshStorage();
      } catch (e) {
        importFailed(e);
      } finally {
        setPendingImport(null);
      }
    });

  const loadDemo = () =>
    act.run("demo", async () => {
      try {
        say("ok", describeImport(await loadDemoData(db)));
      } catch (e) {
        console.error(e);
        say("err", "Couldn't load the demo data. Try again.");
      } finally {
        setConfirmDemo(false);
      }
    });

  async function startDemo() {
    report.clear();
    if (await hasData(db)) setConfirmDemo(true);
    else await loadDemo();
  }

  const deleteEverything = () =>
    act.run("delete", async () => {
      try {
        await clearAll(db);
        // The locked AI key belongs to the data that is gone too.
        deps.ai.vault.forget(db.name);
        onKeyForgotten?.();
        // The reminder times and the chosen file belong to the data that is gone. The file itself is left where it is.
        clearBackupState(db.name);
        await forgetBackupFile(db.name, backup.file).catch(() => undefined);
        setFileName(null);
        refreshStorage();
        say("ok", "All your data was deleted from this device.");
      } catch (e) {
        console.error(e);
        say("err", "Couldn't delete your data. Try again.");
      } finally {
        setConfirmDelete(false);
      }
    });

  return (
    <>
      <section className="card" id="data" aria-labelledby="h-data">
        <h2 className="sec" id="h-data" tabIndex={-1}>Back up</h2>
        <p className="help">Everything is stored in this browser. Export a copy to keep it safe or move it.</p>
        {storage && describeStorage(storage).length > 0 && (
          <div className="help backup-status" id="storage-status">{describeStorage(storage).map((line) => <p key={line} className="line">{line}</p>)}</div>
        )}
        <div className="row field-block">
          <button onClick={() => void exportData()}>Export data</button>
          <button onClick={() => void exportCsv()}>Export CSV</button>
        </div>
        {fileBackup && (
          <div className="row backup-file">
            {fileName && <p className="help" id="backup-file-name">Backup file: {fileName}</p>}
            {fileName && <button ref={backUpButton} {...act.button("backup")} onClick={() => void backUpNow()}>Back up now</button>}
            <button ref={chooseButton} {...act.button("choose")} onClick={() => void chooseTarget()}>{fileName ? "Choose a different file" : "Choose a backup file"}</button>
            {fileName && <button onClick={() => void stopUsingFile()}>Stop using this file</button>}
          </div>
        )}
        {confirmSmaller && (
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
        )}
      </section>
      <section className="card" id="restore" aria-labelledby="h-restore">
        <h2 className="sec" id="h-restore" tabIndex={-1}>Restore</h2>
        <p className="help">Replace everything in this browser with a copy you exported.</p>
        <label className="btn file-pick">
          Import data
          <input ref={fileInput} type="file" accept=".json,application/json" className="sr" onChange={(e) => void chooseFile(e.target.files?.[0])} />
        </label>
        {pendingImport && (
          <InlineConfirm
            title={`Replace everything in this browser with ${pendingImport.name}${pendingImport.parsed.kind === "python" ? " (from the local edition)" : ""}?`}
            help="This can't be undone."
            confirmLabel="Replace my data"
            act={act}
            actionKey="import"
            opener={fileInput.current}
            onConfirm={() => void confirmImport()}
            onCancel={() => setPendingImport(null)}
          />
        )}
      </section>
      {children}
      {isLocal && (
        <div className="demo-line">
          <span className="help">Demo data</span>
          <button ref={demoButton} className="small" disabled={act.busy !== null} onClick={() => void startDemo()}>Load demo data</button>
        </div>
      )}
      {confirmDemo && (
        <InlineConfirm
          title="Replace everything in this browser with the demo data?"
          help="This can't be undone."
          confirmLabel="Replace my data"
          act={act}
          actionKey="demo"
          opener={demoButton.current}
          onConfirm={() => void loadDemo()}
          onCancel={() => setConfirmDemo(false)}
        />
      )}
      <section className="card" id="danger" aria-labelledby="h-danger">
        <h2 className="sec" id="h-danger" tabIndex={-1}>Delete everything</h2>
        <p className="help">Removes your applications, emails and settings from this device. Back up first if you may want them again.</p>
        <button ref={deleteButton} className="danger" onClick={() => setConfirmDelete(true)}>Delete all my data</button>
        {confirmDelete && (
          <InlineConfirm
            title="Delete your applications, emails and settings from this device?"
            help="This can't be undone."
            confirmLabel="Delete everything"
            act={act}
            actionKey="delete"
            opener={deleteButton.current}
            onConfirm={() => void deleteEverything()}
            onCancel={() => setConfirmDelete(false)}
          />
        )}
      </section>
    </>
  );
}

// "Your data": export a copy (JSON or CSV), import one, load the demo data in a local build, and delete everything.
// Each of the three actions that replace the data asks first, in place, with the shared InlineConfirm.
import { useRef, useState } from "react";
import { InlineConfirm } from "../../components/InlineConfirm";
import { useAction } from "../../components/useAction";
import type { JobTrackerDB } from "../../db/schema";
import { hasData, loadDemoData } from "../../demo/loadDemo";
import { clearAll, exportAllAsJson, ImportError } from "../../portability";
import { csvFilename } from "../../portability/csv";
import { describeImport, exportFilename, parseImportText, readFileText, runImport, type ParsedImport } from "./actions";
import type { SettingsDeps } from "./deps";
import { exportApplicationsCsv } from "./exportCsv";
import type { Reporter } from "./notice";

interface Props {
  db: JobTrackerDB;
  /** only a local build offers the demo data */
  isLocal: boolean;
  deps: Pick<SettingsDeps, "download" | "downloadCsv">;
  report: Reporter;
}

/** The most import problems listed one by one before "And n more problems." */
const PROBLEMS_SHOWN = 8;

export function DataSection({ db, isLocal, deps, report }: Props) {
  const { say } = report;
  const act = useAction();
  const [pendingImport, setPendingImport] = useState<{ name: string; parsed: ParsedImport } | null>(null);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const demoButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);

  async function exportData() {
    try {
      deps.download(exportFilename(), await exportAllAsJson(db));
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
        say("ok", "All your data was deleted from this device.");
      } catch (e) {
        console.error(e);
        say("err", "Couldn't delete your data. Try again.");
      } finally {
        setConfirmDelete(false);
      }
    });

  return (
    <section className="card" id="data" aria-labelledby="h-data">
      <h2 className="sec" id="h-data" tabIndex={-1}>Your data</h2>
      <p className="help">Everything is stored in this browser. Export a copy to keep it safe or move it.</p>
      <div className="row field-block">
        <button onClick={() => void exportData()}>Export data</button>
        <button onClick={() => void exportCsv()}>Export CSV</button>
        <label className="btn file-pick">
          Import data
          <input ref={fileInput} type="file" accept=".json,application/json" className="sr" onChange={(e) => void chooseFile(e.target.files?.[0])} />
        </label>
        {isLocal && <button ref={demoButton} disabled={act.busy !== null} onClick={() => void startDemo()}>Load demo data</button>}
        <button ref={deleteButton} className="danger" onClick={() => setConfirmDelete(true)}>Delete all my data</button>
      </div>
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
  );
}

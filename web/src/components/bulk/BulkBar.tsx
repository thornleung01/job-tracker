import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import type { JobTrackerDB } from "../../db/schema";
import { STAGES, isStage, type Stage } from "../../db/stages";
import { bulkDelete, bulkRestore, bulkRestoreResumes, bulkRestoreStages, bulkSetResume, bulkSetStage, type ResumeBefore } from "../../sync/bulk";
import { TRASH_DAYS } from "../../sync/trash";
import { Notice } from "../Notice";
import { UNDO_MS } from "../undo";
import { useAction } from "../useAction";
import { BULK_CONFIRM_ID, BulkDeleteConfirm } from "./BulkDeleteConfirm";
import type { Selection } from "./useSelection";
import "./bulk.css";

/** A resume version you can pick in the bar. */
export interface ResumeChoice {
  id: number;
  title: string;
}

/** Puts back what a bulk change did; resolves to how many it put back. */
type UndoFn = () => Promise<number>;

const applicationsLabel = (count: number) => `${count} application${count === 1 ? "" : "s"}`;

/**
 * What you can do to the ticked applications, shown between the filter card and the list while at least one is ticked: set their
 * stage (which locks them, like the stage dropdown), set the resume sent (when there are resume versions to choose from) or delete them (to Recently deleted, with their
 * emails kept), after a question in place. Afterwards the selection is cleared and one line says what happened, with a few seconds to Undo a stage change or
 * Restore what was deleted.
 */
export function BulkBar({ db, selection, resumes = [] }: { db: JobTrackerDB; selection: Selection; resumes?: readonly ResumeChoice[] }) {
  const act = useAction();
  const selectedCount = selection.ids.length;
  const [stage, setStage] = useState<"" | Stage>("");
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState("");
  /** "" is nothing chosen, "none" clears the resume, else a version's id */
  const [resume, setResume] = useState("");
  const [undo, setUndo] = useState<UndoFn | null>(null);
  /** the applications a delete just sent to Recently deleted, for the Restore beside the result */
  const [restoreIds, setRestoreIds] = useState<number[] | null>(null);
  /** the button to focus once a failed action has finished, so a retry is one key away */
  const [refocus, setRefocus] = useState<"stage" | "resume" | "delete" | null>(null);
  const stageButton = useRef<HTMLButtonElement>(null);
  const resumeButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const confirmDeleteButton = useRef<HTMLButtonElement>(null);
  const doneBox = useRef<HTMLDivElement>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const dismissResult = useCallback(() => {
    clearTimeout(undoTimer.current);
    setDone("");
    setUndo(null);
    setRestoreIds(null);
  }, []);
  const showResult = (text: string, undoWith: UndoFn | null = null, restoreWith: number[] | null = null) => {
    clearTimeout(undoTimer.current);
    setDone(text);
    setUndo(() => undoWith);   // wrapped, or React would call it as an updater
    setRestoreIds(restoreWith);
    if (undoWith || restoreWith) undoTimer.current = setTimeout(() => { setUndo(null); setRestoreIds(null); }, UNDO_MS);
  };

  // A result belongs to the selection that made it, so ticking something new wipes it, and so do new filters.
  useEffect(() => {
    if (selectedCount) dismissResult();
  }, [selectedCount, dismissResult]);
  useEffect(dismissResult, [selection.resetKey, dismissResult]);
  // A question about a selection that no longer exists goes with it.
  useEffect(() => {
    if (!selectedCount) setConfirming(false);
  }, [selectedCount]);
  // The bar is gone once the selection is, so the result takes the focus.
  useEffect(() => {
    if (done) doneBox.current?.querySelector<HTMLElement>(".notice")?.focus();
  }, [done]);
  // After a failure the button that started it is enabled again, so focus goes back there.
  useEffect(() => {
    if (!refocus || act.busy !== null) return;
    (refocus === "stage" ? stageButton : refocus === "resume" ? resumeButton : confirmDeleteButton).current?.focus();
    setRefocus(null);
  }, [refocus, act.busy]);

  const pick = (e: ChangeEvent<HTMLSelectElement>) => setStage(isStage(e.target.value) ? e.target.value : "");

  const setStageOnAll = () => {
    if (!stage) return;
    const chosen = stage;
    const ids = selection.ids;
    const before = selection.selected.map(({ id, stage: was, stageAt, locked }) => ({ id, stage: was, stageAt, locked }));
    void act
      .run("stage", async () => {
        const changed = await bulkSetStage(db, ids, chosen);
        selection.clear();
        setStage("");
        showResult(`${applicationsLabel(changed)} set to ${chosen}.`, changed ? () => bulkRestoreStages(db, before) : null);
      })
      .then((ok) => ok || setRefocus("stage"));
  };
  const setResumeOnAll = () => {
    if (!resume) return;
    const chosen = resume === "none" ? null : Number(resume);
    const title = resumes.find((r) => r.id === chosen)?.title;
    const ids = selection.ids;
    const before: ResumeBefore[] = selection.selected.map(({ id, resumeId }) => ({ id, resumeId: resumeId ?? null }));
    void act
      .run("resume", async () => {
        const changed = await bulkSetResume(db, ids, chosen);
        selection.clear();
        setResume("");
        showResult(
          chosen === null ? `Cleared the resume on ${applicationsLabel(changed)}.` : `${applicationsLabel(changed)} set to ${title ?? "that resume"}.`,
          changed ? () => bulkRestoreResumes(db, before) : null,
        );
      })
      .then((ok) => ok || setRefocus("resume"));
  };
  const deleteAll = () => {
    const ids = selection.ids;
    void act
      .run("delete", async () => {
        const deleted = await bulkDelete(db, ids);
        setConfirming(false);
        selection.clear();
        showResult(
          `Deleted ${applicationsLabel(deleted)}. ${deleted === 1 ? "It stays" : "They stay"} in Recently deleted for ${TRASH_DAYS} days.`,
          null, deleted ? ids : null,
        );
      })
      .then((ok) => ok || setRefocus("delete"));
  };
  const undoChange = () => {
    if (!undo) return;
    const putBack = undo;
    dismissResult();
    void act.run("undo", async () => {
      const restored = await putBack();
      showResult(restored ? `Put ${applicationsLabel(restored)} back.` : "Nothing to put back.");
    });
  };
  const restoreDeleted = () => {
    if (!restoreIds) return;
    const wanted = restoreIds;
    dismissResult();
    void act.run("restore", async () => {
      const back = await bulkRestore(db, wanted);
      showResult(back ? `Restored ${applicationsLabel(back)}.` : "Nothing to restore.");
    });
  };
  const clear = () => {
    act.clear();
    selection.clear();
    selection.allBox.current?.focus();
  };

  return (
    <>
      {!selectedCount && (done || act.error) ? (
        <div ref={doneBox} className="bulk-done">
          {act.error ? <Notice tone="err">{act.error}</Notice> : <Notice>{done}</Notice>}
          {undo ? <button type="button" className="bulk-undo small" onClick={undoChange} disabled={act.busy !== null}>Undo</button> : null}
          {restoreIds ? <button type="button" className="bulk-undo small" onClick={restoreDeleted} disabled={act.busy !== null}>Restore</button> : null}
        </div>
      ) : null}
      {selectedCount ? (
        <section className="card bulk-bar" aria-label="Selected applications">
          {act.error ? <Notice tone="err">{act.error}</Notice> : null}
          <div className="row">
            <span className="bulk-count" role="status">{selectedCount} selected{selection.capped ? ", the most you can change at once" : ""}</span>
            <select aria-label="Stage for selected applications" value={stage} onChange={pick}>
              <option value="">Choose a stage</option>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" ref={stageButton} onClick={setStageOnAll} {...act.button("stage")} disabled={!stage || act.busy !== null}>Set stage</button>
            {resumes.length ? (
              <>
                <select aria-label="Resume for selected applications" value={resume} onChange={(e) => setResume(e.target.value)}>
                  <option value="">Choose a resume</option>
                  {resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                  <option value="none">No resume</option>
                </select>
                <button type="button" ref={resumeButton} onClick={setResumeOnAll} {...act.button("resume")} disabled={!resume || act.busy !== null}>Set resume</button>
              </>
            ) : null}
            <button type="button" className="danger" ref={deleteButton} aria-expanded={confirming} aria-controls={confirming ? BULK_CONFIRM_ID : undefined}
                    onClick={() => setConfirming(true)} {...act.button("delete-ask")}>Delete</button>
            <button type="button" onClick={clear} disabled={act.busy !== null}>Clear selection</button>
          </div>
          {confirming ? (
            <BulkDeleteConfirm what={applicationsLabel(selectedCount)} act={act} onDelete={deleteAll} onCancel={() => setConfirming(false)} opener={deleteButton.current} deleteRef={confirmDeleteButton} />
          ) : null}
        </section>
      ) : null}
    </>
  );
}

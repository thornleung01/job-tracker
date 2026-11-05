import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { JobTrackerDB } from "../../db/schema";
import { STAGES, isStage, type Stage } from "../../db/stages";
import { bulkDelete, bulkRestoreStages, bulkSetStage, type StageBefore } from "../../sync/bulk";
import { Notice } from "../Notice";
import { useAction } from "../useAction";
import { BULK_CONFIRM_ID, BulkDeleteConfirm } from "./BulkDeleteConfirm";
import type { Selection } from "./useSelection";
import "./bulk.css";

const applicationsLabel = (count: number) => `${count} application${count === 1 ? "" : "s"}`;

/** How long Undo stays on screen after a bulk stage change, as in the list's own stage dropdown. */
const UNDO_MS = 8000;

/**
 * What you can do to the ticked applications, shown between the filter card and the list while at least one is ticked: set their
 * stage (which locks them, like the stage dropdown) or delete them and their emails, after a question in place. Afterwards the
 * selection is cleared and one line says what happened, with a few seconds to Undo a stage change.
 */
export function BulkBar({ db, selection }: { db: JobTrackerDB; selection: Selection }) {
  const act = useAction();
  const selectedCount = selection.ids.length;
  const [stage, setStage] = useState<"" | Stage>("");
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState("");
  const [undo, setUndo] = useState<StageBefore[] | null>(null);
  /** the button to focus once a failed action has finished, so a retry is one key away */
  const [refocus, setRefocus] = useState<"stage" | "delete" | null>(null);
  const stageButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const confirmDeleteButton = useRef<HTMLButtonElement>(null);
  const doneBox = useRef<HTMLDivElement>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const dismissResult = useCallback(() => {
    clearTimeout(undoTimer.current);
    setDone("");
    setUndo(null);
  }, []);
  const showResult = (text: string, undoWith: StageBefore[] | null = null) => {
    clearTimeout(undoTimer.current);
    setDone(text);
    setUndo(undoWith);
    if (undoWith) undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
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
    (refocus === "stage" ? stageButton : confirmDeleteButton).current?.focus();
    setRefocus(null);
  }, [refocus, act.busy]);

  const closeConfirm = () => {
    setConfirming(false);
    deleteButton.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    // Escape can't call off a delete that is already running.
    if (e.key !== "Escape" || !confirming || act.busy !== null) return;
    e.preventDefault();
    closeConfirm();
  };
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
        showResult(`${applicationsLabel(changed)} set to ${chosen}.`, changed ? before : null);
      })
      .then((ok) => ok || setRefocus("stage"));
  };
  const deleteAll = () => {
    const ids = selection.ids;
    void act
      .run("delete", async () => {
        const deleted = await bulkDelete(db, ids);
        setConfirming(false);
        selection.clear();
        showResult(`Deleted ${applicationsLabel(deleted)}.`);
      })
      .then((ok) => ok || setRefocus("delete"));
  };
  const undoStage = () => {
    if (!undo) return;
    const was = undo;
    dismissResult();
    void act.run("undo", async () => {
      const restored = await bulkRestoreStages(db, was);
      showResult(restored ? `Put ${applicationsLabel(restored)} back.` : "Nothing to put back.");
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
          {undo ? <button type="button" className="bulk-undo small" onClick={undoStage} disabled={act.busy !== null}>Undo</button> : null}
        </div>
      ) : null}
      {selectedCount ? (
        <section className="card bulk-bar" aria-label="Selected applications" onKeyDown={onKey}>
          {act.error ? <Notice tone="err">{act.error}</Notice> : null}
          <div className="row">
            <span className="bulk-count" role="status">{selectedCount} selected{selection.capped ? ", the most you can change at once" : ""}</span>
            <select aria-label="Stage for selected applications" value={stage} onChange={pick}>
              <option value="">Choose a stage</option>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" ref={stageButton} onClick={setStageOnAll} {...act.button("stage")} disabled={!stage || act.busy !== null}>Set stage</button>
            <button type="button" className="danger" ref={deleteButton} aria-expanded={confirming} aria-controls={confirming ? BULK_CONFIRM_ID : undefined}
                    onClick={() => setConfirming(true)} {...act.button("delete-ask")}>Delete</button>
            <button type="button" onClick={clear} disabled={act.busy !== null}>Clear selection</button>
          </div>
          {confirming ? (
            <BulkDeleteConfirm what={applicationsLabel(selectedCount)} act={act} onDelete={deleteAll} onCancel={closeConfirm} deleteRef={confirmDeleteButton} />
          ) : null}
        </section>
      ) : null}
    </>
  );
}

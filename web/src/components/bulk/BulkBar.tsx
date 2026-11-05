import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { JobTrackerDB } from "../../db/schema";
import { STAGES, isStage, type Stage } from "../../db/stages";
import { bulkDelete, bulkSetStage } from "../../sync/bulk";
import { Notice } from "../Notice";
import { useAction } from "../useAction";
import type { Selection } from "./useSelection";
import "./bulk.css";

const apps = (n: number) => `${n} application${n === 1 ? "" : "s"}`;

/**
 * What you can do to the ticked applications, shown between the filter card and the list while at least one is ticked: set their
 * stage (which locks them, like the stage dropdown) or delete them and their emails, after a question in place. Afterwards the
 * selection is cleared and one line says what happened.
 */
export function BulkBar({ db, selection }: { db: JobTrackerDB; selection: Selection }) {
  const act = useAction();
  const n = selection.ids.length;
  const [stage, setStage] = useState<"" | Stage>("");
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState("");
  const confirmBox = useRef<HTMLDivElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const doneBox = useRef<HTMLDivElement>(null);

  // A new selection starts clean: the last result goes, and so does a question about a selection that no longer exists.
  useEffect(() => {
    if (n) setDone("");
    else setConfirming(false);
  }, [n]);
  useEffect(() => {
    if (confirming) confirmBox.current?.querySelector<HTMLElement>("button")?.focus();
  }, [confirming]);
  // The bar is gone once the selection is, so the result takes the focus.
  useEffect(() => {
    if (done) doneBox.current?.querySelector<HTMLElement>(".notice")?.focus();
  }, [done]);

  const closeConfirm = () => {
    setConfirming(false);
    deleteButton.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !confirming) return;
    e.preventDefault();
    closeConfirm();
  };
  const pick = (e: ChangeEvent<HTMLSelectElement>) => setStage(isStage(e.target.value) ? e.target.value : "");

  const setStageOnAll = () => {
    if (!isStage(stage)) return;
    const ids = selection.ids;
    void act.run("stage", async () => {
      const changed = await bulkSetStage(db, ids, stage);
      selection.clear();
      setStage("");
      setDone(`${apps(changed)} set to ${stage}.`);
    });
  };
  const deleteAll = () => {
    const ids = selection.ids;
    void act.run("delete", async () => {
      const deleted = await bulkDelete(db, ids);
      setConfirming(false);
      selection.clear();
      setDone(`Deleted ${apps(deleted)}.`);
    });
  };
  const clear = () => {
    act.clear();
    selection.clear();
    selection.allBox.current?.focus();
  };

  return (
    <>
      {done && !n ? <div ref={doneBox}><Notice>{done}</Notice></div> : null}
      {n ? (
        <section className="card bulk-bar" aria-label="Selected applications" onKeyDown={onKey}>
          {act.error ? <Notice tone="err">{act.error}</Notice> : null}
          <div className="row bulk-row">
            <span className="bulk-count" role="status">{n} selected</span>
            <select aria-label="Stage for selected applications" value={stage} onChange={pick}>
              <option value="">Choose a stage</option>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" onClick={setStageOnAll} {...act.button("stage")} disabled={!stage || act.busy !== null}>Set stage</button>
            <button type="button" className="danger" ref={deleteButton} aria-expanded={confirming} onClick={() => setConfirming(true)} {...act.button("delete-ask")}>Delete</button>
            <button type="button" onClick={clear} disabled={act.busy !== null}>Clear selection</button>
          </div>
          {confirming ? (
            <div className="bulk-confirm" role="group" aria-labelledby="h-bulk-delete" ref={confirmBox}>
              <p id="h-bulk-delete" className="bulk-confirm-q">Delete {apps(n)}?</p>
              <p className="help">Their emails, notes and steps are removed. Your mailbox isn't touched.</p>
              <div className="row">
                <button type="button" className="danger" onClick={deleteAll} {...act.button("delete")}>Delete {apps(n)} and their emails</button>
                <button type="button" onClick={closeConfirm} disabled={act.busy !== null}>Cancel</button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

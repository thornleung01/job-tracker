import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { JobTrackerDB } from "../../db/schema";
import { STAGES, isStage, type Stage } from "../../db/stages";
import { restoreStage, setStage } from "../../sync/actions";
import { stageClass } from "../StageBadge";
import { useAction } from "../useAction";
import "./quickedit.css";

interface Props {
  db: JobTrackerDB;
  appId: number;
  company: string;
  stage: Stage;
  stageAt: string | null;
  locked: boolean;
}

interface Before {
  stage: Stage;
  stageAt: string | null;
  locked: boolean;
}

/** How long Undo stays on screen after a change. */
const UNDO_MS = 8000;

/**
 * The stage in the list, as a dropdown. Choosing one sets it by hand and locks it, so mail stops moving it. A scroll or a stray
 * key can change a select, so a change offers Undo for a few seconds, which puts back the stage and whether it was locked.
 */
export function QuickStage({ db, appId, company, stage, stageAt, locked }: Props) {
  const act = useAction();
  const [before, setBefore] = useState<Before | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const offerUndo = (b: Before) => {
    clearTimeout(timer.current);
    setBefore(b);
    timer.current = setTimeout(() => setBefore(null), UNDO_MS);
  };
  const change = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    if (!isStage(next) || next === stage) return;
    const was: Before = { stage, stageAt, locked };
    void act.run("stage", () => setStage(db, appId, next)).then((ok) => ok && offerUndo(was));
  };
  const undo = () => {
    if (!before) return;
    const was = before;
    clearTimeout(timer.current);
    setBefore(null);
    void act.run("undo", () => restoreStage(db, appId, was));
  };
  return (
    <>
      <span className={`badge ${stageClass(stage)} quick-stage`}>
        <select value={stage} onChange={change} aria-label={`Stage for ${company}`}>
          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </span>
      {before ? <> <button type="button" className="quick-undo small" onClick={undo}>Undo</button></> : locked ? <> <span className="small muted">set by you</span></> : null}
      {act.error ? <span className="quick-error small" role="alert">{act.error}</span> : null}
    </>
  );
}

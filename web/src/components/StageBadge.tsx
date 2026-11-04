import type { Stage } from "../db/stages";

/** The CSS class a stage's colour hangs on: "Heard back" becomes "Heard-back". */
export const stageClass = (stage: string): string => stage.replace(/ /g, "-");

/** The stage word. Its colour dot is drawn in CSS (base.css), so the text is only the stage and the class names stay "badge Heard-back". */
export function StageBadge({ stage }: { stage: Stage }) {
  return <span className={`badge ${stageClass(stage)}`}>{stage}</span>;
}

/** A stage badge, with a quiet note when you set the stage by hand. */
export function StageCell({ stage, locked }: { stage: Stage; locked: boolean }) {
  return (
    <>
      <StageBadge stage={stage} />
      {locked ? <> <span className="small muted">set by you</span></> : null}
    </>
  );
}

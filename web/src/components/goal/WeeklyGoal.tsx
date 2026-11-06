import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery } from "../../app/useQuery";
import type { JobTrackerDB } from "../../db/schema";
import { WEEKLY_GOAL_MAX } from "../../db/limits";
import { clearGoal, loadWeeklyProgress, setGoal } from "../../sync/goal";
import { plural } from "../../sync/text";
import { Notice } from "../Notice";
import { useAction } from "../useAction";
import "./goal.css";

/**
 * "This week: 3 of 5 applications" with a thin bar, above the list. With no goal set it is only a quiet "Set a weekly goal" button.
 * The goal and the count read the whole database, not the filtered list, and both live in this account's database.
 * The one button is the same element whether a goal is set or not (only its words change), so focus stays on it when the goal
 * arrives or goes after a save or a removal.
 */
export function WeeklyGoal({ db }: { db: JobTrackerDB }) {
  // null is "no goal"; undefined is still loading
  const progress = useQuery(() => loadWeeklyProgress(db), [db]);
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const opener = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const lineId = useId();
  // The field takes focus when the form opens, and the button (Set or Change, whichever shows then) gets it back when it closes.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) field.current?.focus();
    else if (wasEditing.current) opener.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  if (progress === undefined) return null;
  const goal = progress?.goal ?? null;

  const open = () => {
    act.clear();
    setDraft(goal ? String(goal) : "");
    setEditing(true);
  };
  const close = () => {
    act.clear();
    setEditing(false);
  };
  // The form closes with the result left in the status line below: the button that gets focus doesn't say what happened.
  const save = (e: FormEvent) => {
    e.preventDefault();
    void act.run("goal", async () => ((await setGoal(db, draft)) === null ? "Weekly goal removed." : "Weekly goal saved.")).then((ok) => ok && setEditing(false));
  };
  const remove = () => {
    void act.run("goal", async () => {
      await clearGoal(db);
      return "Weekly goal removed.";
    }).then((ok) => ok && setEditing(false));
  };

  return (
    <section className={editing ? "weekly-goal is-editing" : "weekly-goal"} aria-label="Weekly goal">
      {progress && !editing ? (
        <p className="weekly-goal-line small">
          <span id={lineId}>This week: {progress.count} of {plural(progress.goal, "application")}</span>
          {progress.done ? <span className="muted"> Goal reached.</span> : null}
        </p>
      ) : null}
      {!editing ? <button type="button" className="quiet weekly-goal-edit" ref={opener} onClick={open}>{progress ? "Change goal" : "Set a weekly goal"}</button> : null}
      {progress && !editing ? (
        <div className="weekly-goal-bar" role="progressbar" aria-labelledby={lineId} aria-valuemin={0} aria-valuemax={progress.goal} aria-valuenow={Math.min(progress.count, progress.goal)}
             aria-valuetext={`${progress.count} of ${plural(progress.goal, "application")} this week`}>
          <div className="weekly-goal-fill" style={{ width: `${progress.percent}%` }} />
        </div>
      ) : null}
      {editing ? (
        <form className="weekly-goal-form" onSubmit={save} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }}>
          <div className="fgroup">
            <label htmlFor={inputId}>Applications per week (1 to {WEEKLY_GOAL_MAX})</label>
            <input id={inputId} ref={field} name="weekly_goal" type="number" inputMode="numeric" min={1} max={WEEKLY_GOAL_MAX} step={1} value={draft} onChange={(e) => setDraft(e.target.value)} />
          </div>
          <button type="submit" className="primary" {...act.button("goal")}>Save goal</button>
          {goal ? <button type="button" onClick={remove} disabled={act.busy !== null}>Remove goal</button> : null}
          <button type="button" onClick={close} disabled={act.busy !== null}>Cancel</button>
        </form>
      ) : null}
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      <span className="sr" role="status">{act.status ?? ""}</span>
    </section>
  );
}

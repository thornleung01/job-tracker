import { Check } from "lucide-react";

export type StepId = "resume" | "job" | "review" | "add";
export type StepState = "done" | "current" | "waiting";

export const STEP_NAMES: Record<StepId, string> = {
  resume: "Your resume",
  job: "The job",
  review: "Review",
  add: "Add to applications",
};
export const STEP_ORDER: readonly StepId[] = ["resume", "job", "review", "add"];

const SAID: Record<StepState, string> = { done: "done", current: "current step", waiting: "not started" };

/** The four steps in a row. Each says whether it is done (a tick), the current one (a filled number) or still to come (an outlined number), in words too. */
export function StepStrip({ states }: { states: Record<StepId, StepState> }) {
  return (
    <ol className="steps-strip" aria-label="Steps">
      {STEP_ORDER.map((id, i) => {
        const state = states[id];
        return (
          <li key={id} className={`steps-item is-${state}`} aria-current={state === "current" ? "step" : undefined}>
            <span className="steps-mark" aria-hidden="true">{state === "done" ? <Check size={16} strokeWidth={3} /> : i + 1}</span>
            <span className="steps-name">{STEP_NAMES[id]}</span>
            <span className="sr">, {SAID[state]}</span>
          </li>
        );
      })}
    </ol>
  );
}

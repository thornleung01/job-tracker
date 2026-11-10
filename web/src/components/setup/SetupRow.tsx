// One step in the Setup list: a tick or an empty circle with its words ("Connected", "Not yet", "Skipped"), what the step
// unlocks in one line, and whatever the step needs right there (its buttons and forms). State is never colour alone: the
// mark changes shape and the words change too.
import { Check, Minus } from "lucide-react";
import type { ReactNode } from "react";
import type { StepState } from "../../sync/setupStatus";
import "./setuprow.css";

interface Props {
  /** an id for the row's heading, so the row is a labelled group */
  id: string;
  title: string;
  state: StepState["state"];
  /** the word beside the title: "Connected", "Not yet", "Skipped" */
  word: string;
  /** one line on what the step unlocks */
  unlocks: string;
  children?: ReactNode;
}

export function SetupRow({ id, title, state, word, unlocks, children }: Props) {
  return (
    <li className={`setup-row ${state}`} aria-labelledby={id}>
      <span className="setup-mark" aria-hidden="true">
        {state === "done" && <Check size={16} strokeWidth={3} />}
        {state === "skipped" && <Minus size={16} strokeWidth={3} />}
      </span>
      <div className="setup-body">
        <div className="setup-head">
          <h3 id={id} tabIndex={-1}>{title}</h3>
          <span className="setup-word">{word}</span>
        </div>
        <p className="help">{unlocks}</p>
        {children}
      </div>
    </li>
  );
}

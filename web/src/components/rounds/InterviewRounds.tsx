import { useState, type FormEvent } from "react";
import type { JobTrackerDB } from "../../db/schema";
import { MAX_ROUNDS, type Rounds } from "../../sync/rounds";
import { setInterviewRounds } from "../../sync/actions";
import { useAction } from "../useAction";
import { useReturnFocus } from "../quickedit/useReturnFocus";
import "./rounds.css";

interface Props {
  db: JobTrackerDB;
  appId: number;
  rounds: Rounds | null;
}

const SOURCE_NOTE = {
  yours: "set by you",
  logged: "from your logged steps",
  estimated: "estimated from your emails",
} as const;

/** The interview rounds line on the detail page: the count, where it came from, and a way to correct it. */
export function InterviewRounds({ db, appId, rounds }: Props) {
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const back = useReturnFocus<HTMLButtonElement>(editing);
  const close = () => {
    back.request();
    setEditing(false);
  };

  const begin = () => {
    act.clear();
    setValue(String(rounds?.count ?? 0));
    setEditing(true);
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    void act.run("rounds", () => setInterviewRounds(db, appId, Number(value))).then((ok) => ok && close());
  };
  const switchToEstimate = () => {
    void act.run("rounds-auto", () => setInterviewRounds(db, appId, null)).then((ok) => ok && close());
  };

  if (editing) {
    return (
      <form className="rounds-form" onSubmit={save}>
        <label className="small" htmlFor={`rounds-${appId}`}>Interview rounds</label>
        <input id={`rounds-${appId}`} type="number" inputMode="numeric" min={0} max={MAX_ROUNDS} step={1} value={value} required autoFocus
               onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") close(); }} />
        <button type="submit" className="small primary" {...act.button("rounds")}>Save rounds</button>
        {rounds?.source === "yours" ? <button type="button" className="small" onClick={switchToEstimate} {...act.button("rounds-auto")}>Use estimate</button> : null}
        <button type="button" className="small" onClick={close}>Cancel</button>
        {act.error ? <span className="small rounds-error" role="alert">{act.error}</span> : null}
      </form>
    );
  }
  return (
    <span className="rounds">
      <span className="small">{rounds ? <>Interview rounds <b>{rounds.count}</b></> : "Interview rounds not counted yet"}</span>
      {rounds ? <span className="small muted"> {"·"} {SOURCE_NOTE[rounds.source]}</span> : null}
      {" "}
      <button type="button" ref={back.target} className="small rounds-edit" onClick={begin}>{rounds ? "Edit rounds" : "Add rounds"}</button>
    </span>
  );
}

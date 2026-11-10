import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { JobTrackerDB } from "../../db/schema";
import { MAX_ROLE_CHARS } from "../../db/limits";
import { editApplication } from "../../sync/actions";
import { useAction } from "../useAction";
import { useReturnFocus } from "./useReturnFocus";
import "./quickedit.css";

interface Props {
  db: JobTrackerDB;
  appId: number;
  company: string;
  role: string;
}

/** The role in the list. Choose it to rename it in place: Enter or leaving the field saves, Escape puts it back. */
export function QuickRole({ db, appId, company, role }: Props) {
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(role);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const back = useReturnFocus<HTMLButtonElement>(editing);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const begin = () => {
    done.current = false;
    act.clear();
    setDraft(role);
    setEditing(true);
  };
  /** `fromKeyboard`: Enter or Escape closed it, so focus goes back to the role. Leaving the field by clicking elsewhere keeps focus where you put it. */
  const finish = (save: boolean, fromKeyboard = false) => {
    if (done.current) return;
    done.current = true;
    if (fromKeyboard) back.request();
    if (!save || draft.trim() === role.trim()) {
      setEditing(false);
      return;
    }
    void act.run("role", () => editApplication(db, appId, company, draft)).then((ok) => {
      if (ok) setEditing(false);
      else {
        done.current = false;         // stay open on a problem, so the text isn't lost
        back.cancel();
      }
    });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true, true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(false, true);
    }
  };

  if (!editing) {
    return (
      <button type="button" ref={back.target} className="quick-text" onClick={begin} aria-label={`${role}, edit role for ${company}`} title="Edit role">
        {role}
      </button>
    );
  }
  return (
    <>
      <input ref={input} className="quick-input" value={draft} maxLength={MAX_ROLE_CHARS} aria-label={`Role for ${company}`} aria-invalid={act.error ? true : undefined}
             onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => finish(true)} disabled={act.busy !== null} />
      {act.error ? <span className="quick-error small" role="alert">{act.error}</span> : null}
    </>
  );
}

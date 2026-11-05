import { useEffect, useRef, useState } from "react";
import type { JobTrackerDB } from "../../db/schema";
import { dayOf, localToday } from "../../db/time";
import { ActionError, setAppliedOn } from "../../sync/actions";
import { dayText } from "../TimeText";
import { useAction } from "../useAction";
import { useReturnFocus } from "./useReturnFocus";
import "./quickedit.css";

interface Props {
  db: JobTrackerDB;
  appId: number;
  company: string;
  /** when you applied, ISO, or null when unknown */
  appliedAt: string | null;
}

/**
 * The applied date in the list. Choose it to pick another day. A date field reports a change after every typed digit, so the day
 * is saved on Enter or when you leave the field, never mid-typing. Escape puts the old day back.
 */
export function QuickDate({ db, appId, company, appliedAt }: Props) {
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const back = useReturnFocus<HTMLButtonElement>(editing);
  // The field opens on the same day the label shows (dayOf: a picked day by its date, a mail time by the viewer's calendar day).
  // A day that is somehow ahead of the clock is held at today, because the field's max is today.
  const current = dayOf(appliedAt);
  const today = localToday();
  const initial = current > today ? today : current;
  const shown = dayText(appliedAt, "short");

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  // A failed save leaves the field open and disabled for a moment: put the cursor back so you can fix it.
  useEffect(() => {
    if (editing && act.error) input.current?.focus();
  }, [editing, act.error]);

  const begin = () => {
    done.current = false;
    act.clear();
    setEditing(true);
  };
  const finish = (save: boolean, fromKeyboard = false) => {
    if (done.current) return;
    done.current = true;
    if (fromKeyboard) back.request();
    const day = input.current?.value ?? "";
    if (!save || (day && day === initial)) {
      setEditing(false);
      return;
    }
    // An empty field is not "no date": say so instead of closing as if it saved.
    void act.run("applied", async () => {
      if (!day) throw new ActionError("Pick a date, or press Escape to keep the old one.");
      await setAppliedOn(db, appId, day);
    }).then((ok) => {
      if (ok) setEditing(false);
      else done.current = false;      // stay open on a problem, so what you typed isn't lost
    });
  };

  if (!editing) {
    return (
      <button type="button" ref={back.target} className="quick-text small muted" onClick={begin}
              aria-label={`${shown}, edit applied date for ${company}`} title="Edit applied date">
        {shown}
      </button>
    );
  }
  return (
    <>
      <input ref={input} type="date" className="quick-input" defaultValue={initial} max={today} aria-label={`Applied date for ${company}`}
             aria-invalid={act.error ? true : undefined} disabled={act.busy !== null}
             onBlur={() => finish(true)}
             onKeyDown={(e) => {
               if (e.key === "Enter") { e.preventDefault(); finish(true, true); }
               else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false, true); }
             }} />
      {act.error ? <span className="quick-error small" role="alert">{act.error}</span> : null}
    </>
  );
}

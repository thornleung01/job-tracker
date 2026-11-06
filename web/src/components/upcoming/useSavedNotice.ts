import { useCallback, useEffect, useRef, useState } from "react";

/** What the status line says once a calendar file is saved. */
export const SAVED_TEXT = "Calendar file saved.";
/** The line empties first, then says it again, so a second save is read out too: a live region only reads out a change. */
export const SAVED_REPEAT_MS = 100;
/** How long the words stay before the line empties again. */
export const SAVED_SHOWN_MS = 4000;

/**
 * The words for a status line that tells you a file was saved, and the function to call when it is. The line is always on the
 * page, so what arrives in it is read out. It says the words again on every save (not only the first) and empties a few seconds
 * later, so stale words are never left behind or read out when the button comes back after a month change.
 */
export function useSavedNotice(): [text: string, saved: () => void] {
  const [text, setText] = useState("");
  const current = useRef("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const say = (value: string) => {
    current.current = value;
    setText(value);
  };
  const stop = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => stop, []);
  const saved = useCallback(() => {
    stop();
    if (current.current === "") say(SAVED_TEXT);
    else {
      // still showing from the last save: empty it, then say it again
      say("");
      timers.current.push(setTimeout(() => say(SAVED_TEXT), SAVED_REPEAT_MS));
    }
    timers.current.push(setTimeout(() => say(""), SAVED_SHOWN_MS));
  }, []);
  return [text, saved];
}

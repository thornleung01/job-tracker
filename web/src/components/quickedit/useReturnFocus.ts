import { useCallback, useEffect, useRef } from "react";

/**
 * Puts keyboard focus back on a trigger button after the in-place editor that replaced it closes, so you keep your place in
 * the list. Call `request()` when the editor closes from the keyboard (Enter, Escape, a button). Closing because you clicked
 * somewhere else does not call it, so focus is never pulled back from where you went.
 */
export function useReturnFocus<T extends HTMLElement>(editing: boolean) {
  const target = useRef<T>(null);
  const wanted = useRef(false);
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !editing && wanted.current) target.current?.focus();
    if (!editing) wanted.current = false;
    was.current = editing;
  }, [editing]);
  const request = useCallback(() => {
    wanted.current = true;
  }, []);
  return { target, request };
}

import { useEffect, useLayoutEffect, useRef } from "react";
import { KeyMachine, type ShortcutAction } from "./keys";

/**
 * Listens for the page's shortcuts on the document. `onAction` returns false when it had nothing to do (no row to act on): the key
 * then keeps its own effect. Otherwise the key's own effect (typing "/" into the field it just focused) is stopped.
 */
export function useShortcuts(onAction: (action: ShortcutAction, e: KeyboardEvent) => boolean | void): void {
  const latest = useRef(onAction);
  useLayoutEffect(() => {
    latest.current = onAction;
  });
  useEffect(() => {
    const machine = new KeyMachine();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const action = machine.handle(e);
      if (action && latest.current(action, e) !== false) e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      machine.reset();
    };
  }, []);
}

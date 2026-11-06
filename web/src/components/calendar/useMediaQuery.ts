import { useCallback, useSyncExternalStore } from "react";

/** Whether a CSS media query matches now, and again when it changes. False where the browser has no matchMedia (the test environment). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener?.("change", onChange);
      return () => mql.removeEventListener?.("change", onChange);
    },
    [query],
  );
  const snapshot = useCallback(() => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false), [query]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

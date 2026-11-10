import { useSyncExternalStore } from "react";

/** The phone breakpoint, for anything that must agree with usePhone (FitBox leaves the sheet unscaled on a phone). */
export const PHONE = "(max-width: 720px)";

const subscribe = (on: () => void) => {
  if (typeof matchMedia !== "function") return () => undefined;
  const query = matchMedia(PHONE);
  query.addEventListener?.("change", on);
  return () => query.removeEventListener?.("change", on);
};
const snapshot = () => (typeof matchMedia === "function" ? matchMedia(PHONE).matches : false);

/** True on a phone-width screen, and re-renders when the screen crosses the breakpoint. Absent matchMedia (tests) counts as a desktop. */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

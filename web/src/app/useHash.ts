import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** The current location.hash, as a string so React compares it by value. */
export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash, () => "");
}

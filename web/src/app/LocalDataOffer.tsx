import { useEffect, useRef, useState } from "react";
import type { JobTrackerDB } from "../db/schema";
import { Notice } from "../components/Notice";
import { bringOverLocalData, localApplicationCount, removeLocalCopy, TargetNotEmptyError } from "./carryOver";
import "./localdataoffer.css";

export const DISMISS_KEY = "jobtracker:carryover-dismissed";

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Private mode can refuse storage; the offer then comes back on the next page load.
  }
}

const applications = (n: number) => `${n} ${n === 1 ? "application" : "applications"}`;

type Phase =
  | { name: "checking" }
  | { name: "hidden" }
  | { name: "offer"; count: number }
  | { name: "brought"; count: number }
  | { name: "confirm"; count: number }
  | { name: "removed" }
  | { name: "failed"; message: string };

/**
 * Offered once per session to a signed-in person who has an earlier copy in this browser (saved before they logged in)
 * and an empty account. It never copies anything on its own, and the earlier copy is only deleted after a confirmed
 * question. `onResolved` is called exactly once, when it is safe to go on (the first sync waits for it, because
 * importing replaces everything): at once when there is nothing to offer, or after Not now, a finished copy or an error.
 */
export function LocalDataOffer({ db, onResolved }: { db: JobTrackerDB; onResolved: () => void }) {
  const [phase, setPhase] = useState<Phase>({ name: "checking" });
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const resolved = useRef(false);
  const latest = useRef(onResolved);
  latest.current = onResolved;
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const focusOpener = useRef(false);

  function resolve() {
    if (resolved.current) return;
    resolved.current = true;
    latest.current();
  }

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (readDismissed()) return false;
      const local = await localApplicationCount();
      if (local === 0) return false;
      if ((await db.applications.count()) > 0) return false;
      if (!cancelled) setPhase({ name: "offer", count: local });
      return true;
    }
    check()
      .catch(() => false)
      .then((offered) => {
        if (cancelled || offered) return;
        setPhase({ name: "hidden" });
        resolve();
      });
    return () => {
      cancelled = true;
    };
    // resolve only touches refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  // Focus follows what just opened or closed: Cancel when the question opens, the button that opened it when it is
  // cancelled, and the notice when a result replaces what was clicked.
  const name = phase.name;
  useEffect(() => {
    if (name === "confirm") cancel.current?.focus();
    else if (name === "brought" && focusOpener.current) {
      focusOpener.current = false;
      opener.current?.focus();
    } else if (name === "brought" || name === "removed" || name === "failed") box.current?.focus();
  }, [name]);

  function notNow() {
    writeDismissed();
    setPhase({ name: "hidden" });
    resolve();
  }

  async function bringOver() {
    if (busy) return;
    setBusy(true);
    try {
      setPhase({ name: "brought", count: await bringOverLocalData(db) });
    } catch (e) {
      setPhase({ name: "failed", message: e instanceof TargetNotEmptyError ? e.message : "Couldn't bring them over. Nothing was changed. Your earlier copy is still in this browser." });
    }
    setBusy(false);
    resolve();
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setRemoveError(null);
    try {
      await removeLocalCopy();
      setPhase({ name: "removed" });
    } catch {
      setRemoveError("Couldn't remove the earlier copy. Try again.");
      focusOpener.current = true;
      setPhase((p) => (p.name === "confirm" ? { name: "brought", count: p.count } : p));
    }
    setBusy(false);
  }

  if (phase.name === "checking" || phase.name === "hidden") return null;

  if (phase.name === "offer") {
    return (
      <div className="carryover carryover-row" role="status">
        <span className="carryover-text">You have {applications(phase.count)} saved in this browser from before you logged in.</span>
        <button type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => void bringOver()}>Bring them over</button>
        <button type="button" className="muted" disabled={busy} onClick={notNow}>Not now</button>
      </div>
    );
  }

  if (phase.name === "failed") {
    return (
      <div className="carryover" ref={box} tabIndex={-1}>
        <Notice tone="err">{phase.message}</Notice>
      </div>
    );
  }

  return (
    <div className="carryover" ref={box} tabIndex={-1}>
      {phase.name === "removed" ? (
        <Notice>Removed the earlier copy.</Notice>
      ) : (
        <>
          <Notice>Brought over {applications(phase.count)}. The earlier copy is still in this browser.</Notice>
          {removeError && <Notice tone="err">{removeError}</Notice>}
          {phase.name === "brought" && (
            <p className="row">
              <button type="button" ref={opener} onClick={() => setPhase({ name: "confirm", count: phase.count })}>Remove the earlier copy</button>
            </p>
          )}
          {phase.name === "confirm" && (
            <div className="carryover-confirm" role="group" aria-labelledby="h-carryover-confirm">
              <p id="h-carryover-confirm" className="carryover-confirm-q">Remove the earlier copy?</p>
              <p className="help">It's deleted from this browser. What you brought over stays in your account.</p>
              <div className="row">
                <button type="button" className="danger" disabled={busy} aria-busy={busy || undefined} onClick={() => void remove()}>Remove it</button>
                <button
                  type="button"
                  ref={cancel}
                  disabled={busy}
                  onClick={() => {
                    focusOpener.current = true;
                    setPhase({ name: "brought", count: phase.count });
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default LocalDataOffer;

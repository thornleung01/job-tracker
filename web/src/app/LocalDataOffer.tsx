import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { JobTrackerDB } from "../db/schema";
import { Notice } from "../components/Notice";
import { isDatabaseEmpty } from "../portability";
import { bringOverLocalData, carryOverDone, CarryOverError, localApplicationCount, removeLocalCopy } from "./carryOver";
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
  | { name: "failed"; message: string; count: number; retry: boolean };

/**
 * Offered to a signed-in person who has an earlier copy in this browser (saved before they logged in) and a completely
 * empty account, until a bring-over has worked once in this browser (the copy belongs to nobody, so it is not offered
 * to the next account) and, after Not now, until the session ends. It never copies anything on its own, and the earlier copy is only deleted after a confirmed
 * question. `onResolved` is called exactly once, when it is safe to go on (the first sync waits for it, because
 * importing replaces everything): at once when there is nothing to offer, or after Not now, a finished copy or an error.
 */
export function LocalDataOffer({ db, onResolved }: { db: JobTrackerDB; onResolved: () => void }) {
  const [phase, setPhase] = useState<Phase>({ name: "checking" });
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const resolved = useRef(false);
  const latest = useRef(onResolved);
  useLayoutEffect(() => {
    latest.current = onResolved;
  });
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const bring = useRef<HTMLButtonElement>(null);
  const focusOpener = useRef(false);
  const focusBring = useRef(false);

  function resolve() {
    if (resolved.current) return;
    resolved.current = true;
    latest.current();
  }

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (carryOverDone() || readDismissed()) return false;
      const local = await localApplicationCount();   // the applications you can see; see carryOver.ts
      if (local === 0) return false;
      // "Empty" means every table, Recently deleted applications included: importing replaces everything, so an account
      // that holds even a deleted application is never offered the copy (nothing may be lost that could be restored).
      if (!(await isDatabaseEmpty(db))) return false;
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
    if (name === "offer" && focusBring.current) {
      focusBring.current = false;
      bring.current?.focus();
    } else if (name === "confirm") cancel.current?.focus();
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
    const count = phase.name === "offer" ? phase.count : 0;
    try {
      setPhase({ name: "brought", count: await bringOverLocalData(db) });
    } catch (e) {
      // A refusal (account not empty, copy gone) won't change on a retry; anything else might.
      const refused = e instanceof CarryOverError;
      setPhase({
        name: "failed",
        message: refused ? e.message : "Couldn't bring them over. Nothing was changed. Your earlier copy is still in this browser.",
        count,
        retry: !refused,
      });
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
      <div className="carryover carryover-row" role="group" aria-label="Earlier copy">
        <span className="carryover-text">You have {applications(phase.count)} saved in this browser from before you logged in.</span>
        <button type="button" ref={bring} disabled={busy} aria-busy={busy || undefined} onClick={() => void bringOver()}>Bring them over</button>
        <button type="button" className="muted" disabled={busy} onClick={notNow}>Not now</button>
      </div>
    );
  }

  if (phase.name === "failed") {
    return (
      <div className="carryover" ref={box} tabIndex={-1}>
        <Notice tone="err">{phase.message}</Notice>
        {phase.retry && (
          <p className="row">
            <button
              type="button"
              onClick={() => {
                focusBring.current = true;
                setPhase({ name: "offer", count: phase.count });
              }}
            >
              Try again
            </button>
          </p>
        )}
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

import { useState } from "react";
import type { JobTrackerDB } from "../db/schema";
import { hasData, loadDemoData } from "../demo/loadDemo";
import { navigate } from "./router";
import { useQuery } from "./useQuery";

const DISMISS_KEY = "jobtracker:local-banner-dismissed";

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Shown in the local build (no sign-in) as one quiet line: what this copy is, a text action for the demo data, and
 * Dismiss. The demo action is only offered while the database has no applications (it follows the data live), so it
 * can never replace what is there; Settings > Your data keeps the confirmed version. Dismissing lasts for the browser
 * session. It is a plain status row, so it never blocks the page or competes with the page's own primary button.
 */
export function LocalBanner({ db }: { db: JobTrackerDB }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applications = useQuery(() => db.applications.count(), [db]);

  if (dismissed) return null;

  async function load() {
    setBusy(true);
    setError(null);
    try {
      if (await hasData(db)) return;
      await loadDemoData(db);
      navigate("/");
    } catch {
      setError("Couldn't load the demo data. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Private mode can refuse storage; the banner is then hidden until the page reloads.
    }
    setDismissed(true);
  }

  return (
    <div className="local-banner" role="status">
      <span className="local-banner-text">Demo mode: not logged in, data stays in this browser.</span>
      {applications === 0 && (
        <button type="button" disabled={busy} onClick={() => void load()}>Load demo data</button>
      )}
      <button type="button" className="muted" onClick={dismiss}>Dismiss</button>
      {error && <span className="local-banner-error" role="alert">{error}</span>}
    </div>
  );
}

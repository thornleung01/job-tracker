import type { JobTrackerDB } from "../../db/schema";
import { focusHeading } from "../../app/focus";
import { dismissSetupCard, type SetupDeps, type StepKey } from "../../sync/setupStatus";
import { useAction } from "../useAction";
import { useSetupStatus } from "./useSetupStatus";
import "./setupcard.css";

/** What "Next:" says for the first missing step. */
export const NEXT_STEP_TEXT: Record<StepKey, string> = {
  mailbox: "Next: connect your mailbox",
  resume: "Next: add your resume",
  aiKey: "Next: add your Anthropic key",
  backup: "Next: back up your data",
};

/**
 * A small card above the applications list while setup is unfinished: how far along, the next missing step, Continue (to
 * Settings, where Setup is the first tab) and Dismiss. Hidden once every step is done or skipped, and once dismissed
 * (stored in this database, so it stays gone on reload and travels with an export).
 */
export function SetupCard({ db, deps }: { db: JobTrackerDB; deps?: SetupDeps }) {
  const { status, dismissed } = useSetupStatus(db, deps);
  const action = useAction();
  if (!status || dismissed || status.next === null) return null;

  async function dismiss() {
    const ok = await action.run("dismiss", () => dismissSetupCard(db));
    // The card vanishes with focus on it, so focus goes to the page heading.
    const main = document.getElementById("main");
    if (ok && main) focusHeading(main);
  }

  return (
    <section className="setup-card card" aria-labelledby="setup-card-title">
      <div className="setup-card-text">
        <h2 className="setup-card-title" id="setup-card-title">Finish setting up · {status.done} of {status.total}</h2>
        <p className="setup-card-next">{NEXT_STEP_TEXT[status.next]}</p>
        {action.error ? <p className="small setup-card-error" role="alert">{action.error}</p> : null}
      </div>
      <div className="setup-card-actions">
        <a className="btn primary" href="#/settings">Continue</a>
        <button type="button" className="muted" {...action.button("dismiss")} onClick={() => void dismiss()}>Dismiss</button>
      </div>
    </section>
  );
}

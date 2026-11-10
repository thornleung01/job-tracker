// "AI": the person's own Anthropic key, locked on this device with a passphrase (ai/vault.ts). Three states: no key (KeyForm), locked
// (UnlockForm) and unlocked (UnlockedActions). This file only holds the state, the one-action-at-a-time runner and the intro. The key and the
// passphrase live only in the input being typed in and are cleared the moment they are used. The model choice is saved with the locked key.
import type { AiDeps } from "../../../ai";
import type { JobTrackerDB } from "../../../db/schema";
import type { Reporter } from "../notice";
import { KeyForm } from "./KeyForm";
import { UnlockForm } from "./UnlockForm";
import { UnlockedActions } from "./UnlockedActions";
import { GetKeyLink } from "./GetKeyLink";
import { useAiCard } from "./useAiCard";

interface Props {
  db: JobTrackerDB;
  deps: AiDeps;
  report: Reporter;
}

export function AiSection({ db, deps, report }: Props) {
  const { status, part, justLocked, setup, setSetup, lock, forget } = useAiCard(db, deps, report);

  return (
    <section className="card" id="ai" aria-labelledby="h-ai">
      <h2 className="sec" id="h-ai" tabIndex={-1}>AI</h2>
      <p className="help">Convert a resume, tailor it for a job and read the company and role from a pasted job. Only the text you choose to send goes to Anthropic. Your key stays on this device, locked with your passphrase.</p>
      {status.state === "none" && !setup && (
        <div className="row">
          <button onClick={() => setSetup(true)}>Set up key</button>
          <GetKeyLink />
        </div>
      )}
      {status.state === "none" && setup && (
        <>
          <p className="help"><GetKeyLink /></p>
          <KeyForm {...part} focusOnMount />
        </>
      )}
      {status.state === "locked" && <UnlockForm {...part} last4={status.last4} model={status.model} onForget={forget} focusOnMount={justLocked} />}
      {status.state === "unlocked" && <UnlockedActions {...part} last4={status.last4} model={status.model} complete={deps.complete} onLock={lock} onForget={forget} />}
    </section>
  );
}

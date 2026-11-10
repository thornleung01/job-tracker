// "AI": the person's own Anthropic key, locked on this device with a passphrase (ai/vault.ts). Three states: no key (KeyForm), locked
// (UnlockForm) and unlocked (UnlockedActions). This file only holds the state, the one-action-at-a-time runner and the intro. The key and the
// passphrase live only in the input being typed in and are cleared the moment they are used. The model choice is saved with the locked key.
import { useState } from "react";
import type { AiDeps, VaultStatus } from "../../../ai";
import { messageFor, useAction } from "../../../components/useAction";
import type { JobTrackerDB } from "../../../db/schema";
import type { Reporter } from "../notice";
import { KeyForm } from "./KeyForm";
import { UnlockForm } from "./UnlockForm";
import { UnlockedActions } from "./UnlockedActions";
import type { CardPart } from "./shared";

interface Props {
  db: JobTrackerDB;
  deps: AiDeps;
  report: Reporter;
}

export function AiSection({ db, deps, report }: Props) {
  const { vault } = deps;
  const act = useAction();
  const [status, setStatus] = useState<VaultStatus>(() => vault.status(db.name));
  // Lock removes the button that was pressed, so the passphrase field that appears takes focus.
  const [justLocked, setJustLocked] = useState(false);
  // With no key saved only the description and a Set up key button show; the button reveals the form.
  const [setup, setSetup] = useState(false);

  const refresh = () => setStatus(vault.status(db.name));

  /** Runs one action. A failure is reported at the top of the page in the error's own sentence (an AiError or ActionError), without taking focus from a form that is being retried. */
  const run: CardPart["run"] = (name, fn, onFail) =>
    act.run(name, async () => {
      report.clear();
      try {
        report.say("ok", await fn());
      } catch (e) {
        (onFail ? report.sayQuietly : report.say)("err", messageFor(e));
        onFail?.();
      }
    }).then(() => undefined);
  const part: CardPart = { db: db.name, vault, act, run, refresh };

  const lock = () => {
    vault.lock(db.name);
    setJustLocked(true);
    refresh();
    report.announce("Key locked");
  };
  const forget = () =>
    void run("forget", async () => {
      vault.forget(db.name);
      setSetup(false);
      refresh();
      return "Your key was removed from this browser.";
    });

  return (
    <section className="card" id="ai" aria-labelledby="h-ai">
      <h2 className="sec" id="h-ai" tabIndex={-1}>AI</h2>
      <p className="help">Convert a resume, tailor it for a job and read the company and role from a pasted job. Only the text you choose to send goes to Anthropic. Your key stays on this device, locked with your passphrase.</p>
      {status.state === "none" && !setup && <button onClick={() => setSetup(true)}>Set up key</button>}
      {status.state === "none" && setup && <KeyForm {...part} focusOnMount />}
      {status.state === "locked" && <UnlockForm {...part} last4={status.last4} model={status.model} onForget={forget} focusOnMount={justLocked} />}
      {status.state === "unlocked" && <UnlockedActions {...part} last4={status.last4} model={status.model} complete={deps.complete} onLock={lock} onForget={forget} />}
    </section>
  );
}

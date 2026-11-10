// The state behind the AI key forms, shared by the AI tab and the Setup tab: the vault's status, the one-action-at-a-time
// runner (a failure is reported at the top of the page in the error's own sentence) and the lock and forget actions.
import { useState } from "react";
import type { AiDeps, VaultStatus } from "../../../ai";
import { messageFor, useAction } from "../../../components/useAction";
import type { JobTrackerDB } from "../../../db/schema";
import type { Reporter } from "../notice";
import type { CardPart } from "./shared";

export function useAiCard(db: JobTrackerDB, deps: AiDeps, report: Reporter, onChange?: () => void) {
  const { vault } = deps;
  const act = useAction();
  const [status, setStatus] = useState<VaultStatus>(() => vault.status(db.name));
  // Lock removes the button that was pressed, so the passphrase field that appears takes focus.
  const [justLocked, setJustLocked] = useState(false);
  // With no key saved only the description and a Set up key button show; the button reveals the form.
  const [setup, setSetup] = useState(false);

  const refresh = () => {
    setStatus(vault.status(db.name));
    onChange?.();
  };

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

  return { status, part, justLocked, setup, setSetup, lock, forget };
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AiModel } from "../../../ai";
import { ForgetKey } from "./ForgetKey";
import { KeyEnding } from "./KeyEnding";
import { ModelSelect, type CardPart } from "./shared";

interface Props extends CardPart {
  last4: string;
  model: AiModel;
  onForget(): void;
  /** put focus in the passphrase field when this appears (after Lock, where the pressed button is gone) */
  focusOnMount: boolean;
}

/** A key is saved and locked: the passphrase opens it. */
export function UnlockForm({ db, vault, act, run, refresh, last4, model, onForget, focusOnMount }: Props) {
  const [passphraseInput, setPassphraseInput] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusOnMount) field.current?.focus();
  }, [focusOnMount]);

  const unlock = (e: FormEvent) => {
    e.preventDefault();
    const passphrase = passphraseInput;
    setPassphraseInput("");
    void run("unlock", async () => {
      await vault.unlock(db, passphrase);
      refresh();
      return "Your key is unlocked.";
    }, () => field.current?.focus());
  };

  return (
    <>
      <KeyEnding last4={last4} />
      <form onSubmit={unlock}>
        <div className="field-block">
          <label className="field" htmlFor="ai-passphrase">Passphrase</label>
          <input id="ai-passphrase" ref={field} type="password" autoComplete="off" value={passphraseInput} onChange={(e) => setPassphraseInput(e.target.value)} />
        </div>
        <ModelSelect value={model} onChange={(next) => { vault.setModel(db, next); refresh(); }} />
        <div className="row">
          <button type="submit" className="primary" {...act.button("unlock")}>Unlock</button>
          <ForgetKey act={act} onForget={onForget} />
        </div>
      </form>
    </>
  );
}

import { useRef, useState, type FormEvent } from "react";
import { DEFAULT_MODEL, type AiModel } from "../../../ai";
import { ModelSelect, type CardPart } from "./shared";

/** No key yet: the key, the passphrase to lock it with and the model. Both secrets are cleared the moment they are handed over. */
export function KeyForm({ db, vault, act, run, refresh }: CardPart) {
  const [keyInput, setKeyInput] = useState("");
  const [passphraseInput, setPassphraseInput] = useState("");
  const [model, setModel] = useState<AiModel>(DEFAULT_MODEL);
  const keyField = useRef<HTMLInputElement>(null);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const [key, passphrase] = [keyInput, passphraseInput];
    // A refusal ("at least 12 characters") means typing them again, which beats leaving a key in the page.
    setKeyInput("");
    setPassphraseInput("");
    void run("save", async () => {
      await vault.save(db, key, passphrase, model);
      refresh();
      return "Your key was saved and unlocked.";
    }, () => keyField.current?.focus());
  };

  return (
    <form onSubmit={save}>
      <div className="field-block">
        <label className="field" htmlFor="ai-key">Anthropic key</label>
        <input id="ai-key" ref={keyField} type="password" autoComplete="off" spellCheck={false} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
      </div>
      <div className="field-block">
        <label className="field" htmlFor="ai-passphrase">Passphrase</label>
        <p className="help" id="ai-passphrase-help">At least 12 characters. You'll type it to unlock your key. It isn't stored anywhere.</p>
        <input id="ai-passphrase" type="password" autoComplete="off" aria-describedby="ai-passphrase-help" value={passphraseInput} onChange={(e) => setPassphraseInput(e.target.value)} />
      </div>
      <ModelSelect value={model} onChange={setModel} />
      <button type="submit" {...act.button("save")}>Save key</button>
    </form>
  );
}

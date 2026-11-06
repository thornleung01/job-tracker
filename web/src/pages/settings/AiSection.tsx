// "AI": the person's own Anthropic key, locked on this device with a passphrase (ai/vault.ts). Three states: no key (a form), locked (type the
// passphrase) and unlocked (check, lock or forget). The key and the passphrase live only in the input being typed in and are cleared the
// moment they are used. The model choice is saved with the locked key.
import { useRef, useState, type FormEvent } from "react";
import { AI_MODELS, DEFAULT_MODEL, isAiModel, type AiDeps, type AiModel, type VaultStatus } from "../../ai";
import { InlineConfirm } from "../../components/InlineConfirm";
import { messageFor, useAction } from "../../components/useAction";
import type { JobTrackerDB } from "../../db/schema";
import type { Reporter } from "./notice";

interface Props {
  db: JobTrackerDB;
  deps: AiDeps;
  report: Reporter;
}

/** The cheapest model, for the tiny request that tests a key. */
const CHECK_REQUEST = {
  model: "claude-haiku-5-5",
  system: 'Reply with the JSON {"ok":true}.',
  user: "ping",
  schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
  maxTokens: 20,
} as const;

function ModelSelect({ id, value, onChange }: { id: string; value: AiModel; onChange(model: AiModel): void }) {
  return (
    <div className="field-block">
      <label className="field" htmlFor={id}>Model</label>
      <select id={id} value={value} onChange={(e) => isAiModel(e.target.value) && onChange(e.target.value)}>
        {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.note.toLowerCase()})</option>)}
      </select>
    </div>
  );
}

export function AiSection({ db, deps, report }: Props) {
  const { vault } = deps;
  const act = useAction();
  const [status, setStatus] = useState<VaultStatus>(() => vault.status(db.name));
  const [key, setKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [model, setModel] = useState<AiModel>(DEFAULT_MODEL);
  const [confirmForget, setConfirmForget] = useState(false);
  const forgetButton = useRef<HTMLButtonElement>(null);
  const passphraseInput = useRef<HTMLInputElement>(null);

  const refresh = () => setStatus(vault.status(db.name));

  /** Runs one action. A failure is reported at the top of the page in the error's own sentence (an AiError or ActionError). */
  const run = (name: string, fn: () => Promise<string>) =>
    act.run(name, async () => {
      report.clear();
      try {
        report.say("ok", await fn());
      } catch (e) {
        report.say("err", messageFor(e));
      }
    });

  const save = (e: FormEvent) => {
    e.preventDefault();
    const [k, p] = [key, passphrase];
    // Cleared as soon as they are handed over. A refusal ("at least 8 characters") means typing them again, which beats leaving a key in the page.
    setKey("");
    setPassphrase("");
    void run("save", async () => {
      await vault.save(db.name, k, p, model);
      refresh();
      return "Your key was saved and unlocked.";
    });
  };

  const unlock = (e: FormEvent) => {
    e.preventDefault();
    const p = passphrase;
    setPassphrase("");
    void run("unlock", async () => {
      await vault.unlock(db.name, p);
      refresh();
      return "Your key is unlocked.";
    });
  };

  const check = () =>
    run("check", async () => {
      const k = vault.key(db.name);
      if (!k) {
        refresh();
        return "Unlock your key first.";
      }
      await deps.complete(k, CHECK_REQUEST);
      return "Your key works.";
    });

  const lock = () => {
    vault.lock(db.name);
    refresh();
    report.announce("Key locked");
  };

  const forget = () =>
    run("forget", async () => {
      vault.forget(db.name);
      setConfirmForget(false);
      refresh();
      return "Your key was removed from this browser.";
    });

  const changeModel = (next: AiModel) => {
    vault.setModel(db.name, next);
    refresh();
  };

  const forgetConfirm = confirmForget && (
    <InlineConfirm
      title="Forget your key on this device?"
      help="You'll need to enter it again to use AI."
      confirmLabel="Forget key"
      act={act}
      actionKey="forget"
      opener={forgetButton.current}
      onConfirm={() => void forget()}
      onCancel={() => setConfirmForget(false)}
    />
  );
  const forgetOpener = (
    <button type="button" ref={forgetButton} className="danger" disabled={act.busy !== null} onClick={() => setConfirmForget(true)}>Forget key</button>
  );

  return (
    <section className="card" id="ai" aria-labelledby="h-ai">
      <h2 className="sec" id="h-ai" tabIndex={-1}>AI</h2>
      <p className="help">Used to convert and tailor your resume. Only the text you choose to send goes to Anthropic, and your key stays on this device, locked with your passphrase.</p>

      {status.state === "none" && (
        <form onSubmit={save}>
          <div className="field-block">
            <label className="field" htmlFor="ai-key">Anthropic key</label>
            <input id="ai-key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          <div className="field-block">
            <label className="field" htmlFor="ai-passphrase">Passphrase</label>
            <p className="help" id="ai-passphrase-help">You'll type this to unlock your key. It isn't stored anywhere.</p>
            <input id="ai-passphrase" type="password" autoComplete="off" aria-describedby="ai-passphrase-help" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </div>
          <ModelSelect id="ai-model" value={model} onChange={setModel} />
          <button type="submit" {...act.button("save")}>Save key</button>
        </form>
      )}

      {status.state === "locked" && (
        <>
          <p className="field field-block" id="ai-last4">Key ending in ••••{status.last4}</p>
          <form onSubmit={unlock}>
            <div className="field-block">
              <label className="field" htmlFor="ai-unlock">Passphrase</label>
              <input ref={passphraseInput} id="ai-unlock" type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
            </div>
            <ModelSelect id="ai-model" value={status.model} onChange={changeModel} />
            <div className="row">
              <button type="submit" {...act.button("unlock")}>Unlock</button>
              {forgetOpener}
            </div>
          </form>
          {forgetConfirm}
        </>
      )}

      {status.state === "unlocked" && (
        <>
          <p className="field" id="ai-last4">Key ending in ••••{status.last4}</p>
          <p className="help">Unlocked until you reload or log out.</p>
          <ModelSelect id="ai-model" value={status.model} onChange={changeModel} />
          <div className="row">
            <button type="button" {...act.button("check")} onClick={() => void check()}>Check key</button>
            <button type="button" disabled={act.busy !== null} onClick={lock}>Lock</button>
            {forgetOpener}
          </div>
          {forgetConfirm}
        </>
      )}
    </section>
  );
}

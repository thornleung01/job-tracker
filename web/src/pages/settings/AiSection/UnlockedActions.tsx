import { AiError, CHECK_MODEL, type AiModel, type Complete } from "../../../ai";
import { ForgetKey } from "./ForgetKey";
import { KeyEnding } from "./KeyEnding";
import { ModelSelect, type CardPart } from "./shared";

/** The cheapest model, for the tiny request that tests a key. */
const CHECK_REQUEST = {
  model: CHECK_MODEL,
  system: 'Reply with the JSON {"ok":true}.',
  user: "ping",
  schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
  maxTokens: 20,
} as const;

interface Props extends CardPart {
  last4: string;
  model: AiModel;
  complete: Complete;
  onLock(): void;
  onForget(): void;
}

/** The key is unlocked for this page load: test it, lock it again or forget it. */
export function UnlockedActions({ db, vault, act, run, refresh, last4, model, complete, onLock, onForget }: Props) {
  const check = () =>
    void run("check", async () => {
      const key = vault.key(db);
      if (!key) {
        refresh();   // it was locked from somewhere else, so the card shows the passphrase field now
        throw new AiError("locked");
      }
      await complete(key, CHECK_REQUEST);
      return "Your key works.";
    });

  return (
    <>
      <KeyEnding last4={last4} />
      <p className="help">Unlocked until you reload or log out.</p>
      <ModelSelect value={model} onChange={(next) => { vault.setModel(db, next); refresh(); }} />
      <div className="row">
        <button type="button" {...act.button("check")} onClick={check}>Check key</button>
        <button type="button" disabled={act.busy !== null} onClick={onLock}>Lock</button>
        <ForgetKey act={act} onForget={onForget} />
      </div>
    </>
  );
}

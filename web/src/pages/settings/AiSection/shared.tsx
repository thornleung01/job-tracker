// What the parts of the AI card share: the props they are handed and the model picker.
import { AI_MODELS, isAiModel, type AiModel, type Vault } from "../../../ai";
import type { ActionRunner } from "../../../components/useAction";

/** What a part of the card is handed. `run` does one action and says how it went at the top of the page. */
export interface CardPart {
  /** the person's database name (one vault each) */
  db: string;
  vault: Vault;
  act: ActionRunner;
  /** Runs one action: its sentence is reported when it works, its error's sentence when it fails. `onFail` runs after a failure. */
  run(name: string, fn: () => Promise<string>, onFail?: () => void): Promise<void>;
  /** re-reads the vault's state */
  refresh(): void;
}

export function ModelSelect({ value, onChange }: { value: AiModel; onChange(model: AiModel): void }) {
  return (
    <div className="field-block">
      <label className="field" htmlFor="ai-model">Model</label>
      <select id="ai-model" value={value} onChange={(e) => isAiModel(e.target.value) && onChange(e.target.value)}>
        {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.note.toLowerCase()})</option>)}
      </select>
    </div>
  );
}

// What the app needs from the AI side, as small interfaces, so pages and use cases take them as `deps` and tests pass fakes (the same pattern as
// SettingsDeps and JobLinkDeps). The real implementations are in vault.ts and client.ts; `realAiDeps` in index.ts ties them together.

/** The models a person can choose. The first is the default. */
export const AI_MODELS = [
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", note: "Recommended" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", note: "Cheaper" },
  { id: "claude-opus-5-5", label: "Opus 5.5", note: "Best" },
] as const;
export type AiModel = (typeof AI_MODELS)[number]["id"];
export const DEFAULT_MODEL: AiModel = AI_MODELS[0].id;
export const isAiModel = (value: unknown): value is AiModel => AI_MODELS.some((m) => m.id === value);

/** One request: the system prompt, the user turn (the untrusted text is JSON-encoded inside it) and the JSON schema the reply must match. */
export interface AiRequest {
  model: AiModel;
  system: string;
  user: string;
  /** a flat JSON schema with additionalProperties: false (no recursion, no length limits) */
  schema: Record<string, unknown>;
  maxTokens?: number;
}

export interface AiReply {
  /** the parsed JSON the model returned. It is still untrusted: check it in code before using it. */
  json: unknown;
  model: string;
}

/** Makes the call. `key` is the plain Anthropic key, held only in memory by the caller. Throws AiError. */
export type Complete = (key: string, request: AiRequest, options?: { signal?: AbortSignal }) => Promise<AiReply>;

/** What the vault knows about this person's key. The plain key is never part of it. */
export type VaultStatus =
  | { state: "none" }
  | { state: "locked" | "unlocked"; last4: string; model: AiModel };

/** The key, locked on this device with the person's passphrase. `db` is the person's database name (one vault each). */
export interface Vault {
  status(db: string): VaultStatus;
  /** Locks `key` with `passphrase` and keeps it unlocked for this session. Replaces any key already saved. */
  save(db: string, key: string, passphrase: string, model: AiModel): Promise<void>;
  /** Throws AiError("wrongPassphrase") when the passphrase doesn't open it. */
  unlock(db: string, passphrase: string): Promise<void>;
  /** Forgets the plain key from memory. The locked copy stays. */
  lock(db: string): void;
  /** The plain key when unlocked, otherwise null. */
  key(db: string): string | null;
  setModel(db: string, model: AiModel): void;
  /** Removes the locked copy and the plain key. */
  forget(db: string): void;
}

export interface AiDeps {
  vault: Vault;
  complete: Complete;
}

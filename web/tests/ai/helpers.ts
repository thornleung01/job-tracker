// Fakes for the AI side: a Map-backed Storage, a vault that uses it with a cheap key derivation, and AiDeps around that.
import { vi } from "vitest";
import type { AiDeps, Complete } from "../../src/ai";
import { createVault } from "../../src/ai/vault";

/** A `Storage` that keeps its items in a Map (the tests' stand-in for localStorage). */
export class MemoryStorage implements Storage {
  readonly map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
}

/** One iteration: the tests check the wiring, not the cost of guessing. */
export const testVault = (storage: Storage = new MemoryStorage()) => createVault({ storage: () => storage, iterations: 1 });

export const KEY = "sk-ant-api03-SECRETSECRETSECRET-abcd1234";
export const PASSPHRASE = "correct horse battery";

export function fakeAiDeps(storage: Storage = new MemoryStorage()) {
  const complete = vi.fn<Complete>(async () => ({ json: { ok: true }, model: "claude-haiku-5-5" }));
  const deps: AiDeps = { vault: testVault(storage), complete };
  return { deps, complete, storage };
}

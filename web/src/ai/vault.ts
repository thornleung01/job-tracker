// PLACEHOLDER: replaced by the vault agent. Locks the person's Anthropic key on this device with a passphrase.
import type { Vault } from "./deps";

export const realVault: Vault = {
  status: () => ({ state: "none" }),
  save: async () => { throw new Error("vault not built yet"); },
  unlock: async () => { throw new Error("vault not built yet"); },
  lock: () => {},
  key: () => null,
  setModel: () => {},
  forget: () => {},
};

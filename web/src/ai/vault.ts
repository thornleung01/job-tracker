// Locks the person's Anthropic key on this device with a passphrase. The key is encrypted with AES-GCM under a key derived from the
// passphrase (PBKDF2, SHA-256, a random salt), and only the ciphertext is kept, in localStorage. The plain key and the passphrase are never
// stored, logged or sent anywhere but the Anthropic call: not in IndexedDB (so never in an export or a backup file), not in the settings
// table. An unlocked key lives in a Map for this page load only, so a reload (or logging out) locks it again.
import { ActionError } from "../db/errors";
import { DEFAULT_MODEL, isAiModel, type AiModel, type Vault, type VaultStatus } from "./deps";
import { AiError } from "./errors";

/** Slows down guessing a passphrase from a copy of the stored value. */
export const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const MIN_PASSPHRASE = 8;
const KEY_PREFIX = "sk-ant-";
const storageKey = (db: string) => `jobtracker:ai:vault:${db}`;

/** The one shape that is stored. `salt`, `iv` and `ciphertext` are base64. */
interface Stored {
  v: 1;
  salt: string;
  iv: string;
  ciphertext: string;
  last4: string;
  model: AiModel;
}

export interface VaultSeams {
  /** localStorage, or a fake. Reading it may throw (blocked storage). */
  storage: () => Storage;
  crypto: Crypto;
  iterations: number;
}

const toBase64 = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

function parse(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const o: unknown = JSON.parse(raw);
    if (typeof o !== "object" || o === null) return null;
    const s = o as Record<string, unknown>;
    if (s.v !== 1 || !isAiModel(s.model) || typeof s.last4 !== "string") return null;
    if (typeof s.salt !== "string" || typeof s.iv !== "string" || typeof s.ciphertext !== "string") return null;
    return { v: 1, salt: s.salt, iv: s.iv, ciphertext: s.ciphertext, last4: s.last4, model: s.model };
  } catch {
    return null;
  }
}

export function createVault(seams: Partial<VaultSeams> = {}): Vault & { lockAll(): void } {
  /** The unlocked keys of this page load, by database name. Memory only, so a reload locks them all. */
  const unlocked = new Map<string, string>();
  const storage = seams.storage ?? (() => localStorage);
  const webCrypto = () => seams.crypto ?? globalThis.crypto;
  const iterations = seams.iterations ?? PBKDF2_ITERATIONS;
  const random = (n: number): Uint8Array<ArrayBuffer> => webCrypto().getRandomValues(new Uint8Array(n));

  const read = (db: string): Stored | null => {
    try {
      return parse(storage().getItem(storageKey(db)));
    } catch {
      return null;
    }
  };

  async function derive(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    const { subtle } = webCrypto();
    const material = await subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  return {
    status(db): VaultStatus {
      const s = read(db);
      if (!s) return { state: "none" };
      return { state: unlocked.has(db) ? "unlocked" : "locked", last4: s.last4, model: s.model };
    },

    async save(db, key, passphrase, model) {
      const plain = key.trim();
      if (!plain) throw new ActionError("Enter your Anthropic key.");
      if (!plain.startsWith(KEY_PREFIX)) throw new ActionError("That doesn't look like an Anthropic key.");
      if (passphrase.length < MIN_PASSPHRASE) throw new ActionError(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
      const salt = random(SALT_BYTES);
      const iv = random(IV_BYTES);
      const sealed = await webCrypto().subtle.encrypt({ name: "AES-GCM", iv }, await derive(passphrase, salt), new TextEncoder().encode(plain));
      const entry: Stored = {
        v: 1, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(sealed)), last4: plain.slice(-4),
        model: isAiModel(model) ? model : DEFAULT_MODEL,
      };
      try {
        storage().setItem(storageKey(db), JSON.stringify(entry));
      } catch {
        throw new ActionError("Couldn't save the key in this browser.");
      }
      unlocked.set(db, plain);
    },

    async unlock(db, passphrase) {
      const s = read(db);
      if (!s) throw new AiError("noKey");
      try {
        const plain = await webCrypto().subtle.decrypt({ name: "AES-GCM", iv: fromBase64(s.iv) }, await derive(passphrase, fromBase64(s.salt)), fromBase64(s.ciphertext));
        unlocked.set(db, new TextDecoder().decode(plain));
      } catch {
        // AES-GCM authentication failed (wrong passphrase) or the entry is corrupt: the same answer for both.
        throw new AiError("wrongPassphrase");
      }
    },

    lock: (db) => void unlocked.delete(db),
    lockAll: () => unlocked.clear(),
    key: (db) => unlocked.get(db) ?? null,

    setModel(db, model) {
      if (!isAiModel(model)) return;
      const s = read(db);
      if (!s) return;
      try {
        storage().setItem(storageKey(db), JSON.stringify({ ...s, model }));
      } catch {
        // the choice just isn't kept
      }
    },

    forget(db) {
      unlocked.delete(db);
      try {
        storage().removeItem(storageKey(db));
      } catch {
        // nothing stored that we can reach
      }
    },
  };
}

const real = createVault();
export const realVault: Vault = real;

/** Locks every person's key in memory, for logging out (the shell doesn't know which database is open). */
export const lockAllVaults = (): void => real.lockAll();

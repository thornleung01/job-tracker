// Locks the person's Anthropic key on this device with a passphrase. The key is encrypted with AES-GCM under a key derived from the
// passphrase (PBKDF2, SHA-256, a random salt), and only the ciphertext is kept, in localStorage. The plain key and the passphrase are never
// stored, logged or sent anywhere but the Anthropic call: not in IndexedDB (so never in an export or a backup file), not in the settings
// table. An unlocked key lives in a Map for this page load only, so a reload (or logging out) locks it again. JS strings can't be wiped from
// memory, so `lock` only drops our reference: it is best effort.
import { ActionError } from "../db/errors";
import { DEFAULT_MODEL, isAiModel, type AiModel, type Vault, type VaultStatus } from "./deps";
import { AiError } from "./errors";

/**
 * 600,000 is the OWASP 2023 minimum for PBKDF2-HMAC-SHA256. It slows down guessing a passphrase from a copy of the stored value, and costs
 * about 50 ms on a laptop (Web Crypto runs PBKDF2 off the main thread, so the page doesn't freeze).
 * The count is not stored: `v: 1` stands for it, so changing this number needs a new `v` (and a way to read the old one).
 */
export const PBKDF2_ITERATIONS = 600_000;
/** A random salt per save, so two people (or two saves) with the same passphrase get different keys. */
const SALT_BYTES = 16;
/** 96 bits is the standard AES-GCM nonce size. A fresh one for every save: GCM must never reuse an iv under one key. */
const IV_BYTES = 12;
// MIN_PASSPHRASE and KEY_PREFIX are floors and typo checks, not proofs: a long passphrase can still be weak (see COMMON_PASSPHRASES), and a
// key that starts with "sk-ant-" can still be wrong (the first call finds out).
/**
 * Another page on the same github.io origin can read the locked entry from localStorage and guess the passphrase offline, so the
 * passphrase is the only protection. That is why the floor is 12 and why the most common choices are refused.
 */
const MIN_PASSPHRASE = 12;
const KEY_PREFIX = "sk-ant-";
const storageKey = (db: string) => `jobtracker:ai:vault:${db}`;

/**
 * Passphrases that are guessed first, compared in lower case with spaces removed (and again with trailing digits and symbols removed, so
 * "Password123!" counts as "password"). A starting list, not a dictionary: the length floor does most of the work.
 */
const COMMON_PASSPHRASES = new Set([
  "password", "passphrase", "mypassword", "mypassphrase", "passw0rd", "p@ssw0rd", "letmein", "letmeinplease", "qwerty", "qwertyuiop",
  "qwertyuiopasdf", "asdfghjkl", "asdfghjklqwerty", "zxcvbnm", "iloveyou", "welcome", "welcomehome", "admin", "administrator", "root",
  "correcthorsebatterystaple", "trustno1", "monkey", "dragon", "master", "sunshine", "princess",
  "football", "baseball", "superman", "batman", "shadow", "starwars", "changeme", "default", "login", "whatever", "freedom", "secret",
  "opensesame", "hello", "helloworld", "anthropic", "claude", "claudeapikey", "apikey", "myapikey", "myanthropickey", "abcdefghijkl",
]);
/** True for a passphrase that is on the list, all digits, or one short piece repeated ("aaaaaaaaaaaa", "123456789012", "abcabcabcabc"). */
function isCommonPassphrase(passphrase: string): boolean {
  const squashed = passphrase.toLowerCase().replace(/\s+/g, "");
  const bare = squashed.replace(/[\d!@#$%^&*()._+=-]+$/, "");
  return COMMON_PASSPHRASES.has(squashed) || COMMON_PASSPHRASES.has(bare) || /^\d+$/.test(squashed) || /^(.+?)\1+$/.test(squashed);
}

/**
 * The one shape that is stored. `salt`, `iv` and `ciphertext` are base64. `last4` is kept so the page can say which key is locked without
 * unlocking it. `last4` and `model` are not secret and not authenticated by the encryption (see `aad`); `isAiModel` gates the model when
 * it is read, so a tampered value can't select a model the app doesn't know.
 */
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

/**
 * What AES-GCM authenticates besides the ciphertext: the format version and the database name. An entry copied into another person's
 * database, or flagged with another version, then fails to open (as `wrongPassphrase`).
 */
const aad = (db: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(`jobtracker-ai-vault|v1|${db}`);

function parse(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const entry = value as Record<string, unknown>;
    // A different `v` reads as no key at all: nothing ships with another version yet, and the next save replaces it.
    // `isAiModel` guards the model because it was written from a <select>'s value, and storage can be edited by hand.
    if (entry.v !== 1 || !isAiModel(entry.model) || typeof entry.last4 !== "string") return null;
    if (typeof entry.salt !== "string" || typeof entry.iv !== "string" || typeof entry.ciphertext !== "string") return null;
    return { v: 1, salt: entry.salt, iv: entry.iv, ciphertext: entry.ciphertext, last4: entry.last4, model: entry.model };
  } catch {
    return null;
  }
}

/** `lockAll` is for logging out (see `lockAllVaults` below): the shell doesn't know which databases were open. */
export function createVault(seams: Partial<VaultSeams> = {}): Vault & { lockAll(): void } {
  /** The unlocked keys of this page load, by database name. Memory only, so a reload locks them all. */
  const unlocked = new Map<string, string>();
  /** Counts the locks and forgets of each database (and of all of them), so an unlock that was waiting for the passphrase check can tell. */
  const lockCount = new Map<string, number>();
  let lockAllCount = 0;
  const stamp = (db: string) => `${lockAllCount}:${lockCount.get(db) ?? 0}`;
  const noteLock = (db: string) => lockCount.set(db, (lockCount.get(db) ?? 0) + 1);
  /** The save in progress for each database: saves of one database run one after the other, so storage and memory end up with the same key. */
  const saving = new Map<string, Promise<void>>();
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

  // Every message here is a fixed sentence: nothing echoes the key or the passphrase.
  async function saveNow(db: string, key: string, passphrase: string, model: AiModel): Promise<void> {
    const plain = key.trim();
    if (!plain) throw new ActionError("Enter your Anthropic key.");
    if (!plain.startsWith(KEY_PREFIX)) throw new ActionError("That doesn't look like an Anthropic key.");
    if (passphrase.length < MIN_PASSPHRASE) throw new ActionError(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
    if (isCommonPassphrase(passphrase)) throw new ActionError("That passphrase is too common. Choose another.");
    const salt = random(SALT_BYTES);
    const iv = random(IV_BYTES);
    const sealed = await webCrypto().subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(db) }, await derive(passphrase, salt), new TextEncoder().encode(plain));
    const entry: Stored = {
      v: 1, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(sealed)), last4: plain.slice(-4),
      // the model comes from a <select>, so check it
      model: isAiModel(model) ? model : DEFAULT_MODEL,
    };
    try {
      storage().setItem(storageKey(db), JSON.stringify(entry));
    } catch {
      throw new ActionError("Couldn't save the key in this browser.");
    }
    unlocked.set(db, plain);
  }

  return {
    status(db): VaultStatus {
      const s = read(db);
      if (!s) return { state: "none" };
      return { state: unlocked.has(db) ? "unlocked" : "locked", last4: s.last4, model: s.model };
    },

    save(db, key, passphrase, model) {
      const run = (saving.get(db) ?? Promise.resolve()).then(() => saveNow(db, key, passphrase, model));
      const settled = run.then(() => undefined, () => undefined);
      saving.set(db, settled);
      void settled.then(() => {
        if (saving.get(db) === settled) saving.delete(db);
      });
      return run;
    },

    async unlock(db, passphrase) {
      const s = read(db);
      if (!s) throw new AiError("noKey");
      const before = stamp(db);
      let plain: string;
      try {
        const bytes = await webCrypto().subtle.decrypt(
          { name: "AES-GCM", iv: fromBase64(s.iv), additionalData: aad(db) },
          await derive(passphrase, fromBase64(s.salt)),
          fromBase64(s.ciphertext),
        );
        plain = new TextDecoder().decode(bytes);
      } catch {
        // AES-GCM authentication failed (wrong passphrase, or the entry was changed or moved) or it is corrupt: the same answer for all.
        throw new AiError("wrongPassphrase");
      }
      // Someone locked or forgot this key while the passphrase was being checked: that wins, and the key stays locked.
      if (stamp(db) === before) unlocked.set(db, plain);
    },

    lock(db) {
      noteLock(db);
      unlocked.delete(db);
    },
    lockAll() {
      lockAllCount++;
      unlocked.clear();
    },
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
      noteLock(db);
      unlocked.delete(db);
      try {
        storage().removeItem(storageKey(db));
      } catch {
        // nothing stored that we can reach
      }
    },
  };
}

/** One vault for the whole page load, at module level: it is the only holder of the unlocked keys, so every page sees the same ones. */
export const realVault = createVault();

/** Locks every person's key in memory, for logging out (the shell doesn't know which database is open). Used by app/authApi.ts. */
export const lockAllVaults = (): void => realVault.lockAll();

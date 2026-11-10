// The vault's guards: passphrase strength, what the encryption authenticates, the key derivation settings, and races.
import { describe, expect, it } from "vitest";
import { AiError, lockAllVaults, realVault } from "../../src/ai";
import { PBKDF2_ITERATIONS, createVault, lockAllVaults as lockAllFromVault } from "../../src/ai/vault";
import { ActionError } from "../../src/db/errors";
import { KEY, MemoryStorage, PASSPHRASE, testVault } from "./helpers";

const entryKey = (db: string) => `jobtracker:ai:vault:${db}`;
const readEntry = (s: MemoryStorage, db = "a") => JSON.parse(s.getItem(entryKey(db))!) as Record<string, string>;
const fromB64 = (t: string) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const OTHER_KEY = "sk-ant-api03-another-key-zzzz";

/** The real Web Crypto, with every subtle call recorded and optional hooks that can hold one back. */
function spyCrypto(hooks: { before?: (name: string, count: number) => Promise<void> } = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const counts: Record<string, number> = {};
  const wrap = (name: "importKey" | "deriveKey" | "encrypt" | "decrypt") => async (...args: unknown[]) => {
    calls.push({ name, args });
    counts[name] = (counts[name] ?? 0) + 1;
    await hooks.before?.(name, counts[name]);
    return (crypto.subtle[name] as (...a: unknown[]) => Promise<unknown>)(...args);
  };
  const fake = {
    getRandomValues: (a: Uint8Array) => crypto.getRandomValues(a),
    subtle: { importKey: wrap("importKey"), deriveKey: wrap("deriveKey"), encrypt: wrap("encrypt"), decrypt: wrap("decrypt") },
  } as unknown as Crypto;
  return { crypto: fake, calls };
}

describe("passphrase strength", () => {
  const refuse = async (passphrase: string) => {
    const storage = new MemoryStorage();
    const error = await testVault(storage).save("a", KEY, passphrase, "claude-sonnet-5-5").catch((e: unknown) => e);
    expect(storage.length).toBe(0);
    return error as Error;
  };

  it.each([
    "qwertyuiop12", "Pass Word 123!", "PASSWORD123456", "iloveyou2024!", "CorrectHorseBatteryStaple", "letmein  letmein", "welcome  1234", "Administrator 1",
  ])("refuses the common passphrase %j", async (passphrase) => {
    const error = await refuse(passphrase);
    expect(error).toBeInstanceOf(ActionError);
    expect(error.message).toBe("That passphrase is too common. Choose another.");
  });

  it.each(["aaaaaaaaaaaa", "123456789012", "000000000000", "abcabcabcabc", "ababababababab"])("refuses the repetitive passphrase %j", async (passphrase) => {
    expect((await refuse(passphrase)).message).toBe("That passphrase is too common. Choose another.");
  });

  it("refuses 11 characters as too short and accepts exactly 12 that aren't common", async () => {
    expect((await refuse("x7!kd9w2zq1")).message).toBe("Use a passphrase of at least 12 characters.");
    const vault = testVault();
    await vault.save("a", KEY, "x7!kd9w2zq1m", "claude-sonnet-5-5");
    expect(vault.key("a")).toBe(KEY);
  });

  it("accepts an ordinary long passphrase", async () => {
    const vault = testVault();
    await vault.save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    expect(vault.status("a").state).toBe("unlocked");
  });
});

describe("what the encryption authenticates", () => {
  it("passes the version and database name as additional data when it encrypts and decrypts", async () => {
    const spy = spyCrypto();
    const storage = new MemoryStorage();
    const vault = createVault({ storage: () => storage, crypto: spy.crypto, iterations: 1 });
    await vault.save("db-1", KEY, PASSPHRASE, "claude-sonnet-5-5");
    await createVault({ storage: () => storage, crypto: spy.crypto, iterations: 1 }).unlock("db-1", PASSPHRASE);
    const expected = Array.from(new TextEncoder().encode("jobtracker-ai-vault|v1|db-1"));
    for (const name of ["encrypt", "decrypt"]) {
      const call = spy.calls.find((c) => c.name === name)!;
      expect(Array.from(new Uint8Array((call.args[0] as { additionalData: ArrayBuffer }).additionalData))).toEqual(expected);
    }
  });

  it("won't open an entry that was copied to another database name", async () => {
    const storage = new MemoryStorage();
    await testVault(storage).save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    storage.setItem(entryKey("b"), storage.getItem(entryKey("a"))!);
    const other = testVault(storage);
    expect(other.status("b").state).toBe("locked");
    await expect(other.unlock("b", PASSPHRASE)).rejects.toMatchObject({ code: "wrongPassphrase" });
    expect(other.key("b")).toBeNull();
    await other.unlock("a", PASSPHRASE);
    expect(other.key("a")).toBe(KEY);
  });

  describe("a changed entry fails as wrongPassphrase and leaves an unlocked key alone", () => {
    const tampers: [string, (entry: Record<string, string>, other: Record<string, string>) => Record<string, string>][] = [
      ["a flipped bit in the ciphertext", (e) => {
        const bytes = fromB64(e.ciphertext);
        bytes[0] ^= 1;
        return { ...e, ciphertext: toB64(bytes) };
      }],
      ["a flipped bit in the tag", (e) => {
        const bytes = fromB64(e.ciphertext);
        bytes[bytes.length - 1] ^= 1;
        return { ...e, ciphertext: toB64(bytes) };
      }],
      ["a ciphertext cut short, losing the tag", (e) => ({ ...e, ciphertext: toB64(fromB64(e.ciphertext).slice(0, 8)) })],
      ["an empty ciphertext", (e) => ({ ...e, ciphertext: "" })],
      ["another entry's iv", (e, o) => ({ ...e, iv: o.iv })],
      ["another entry's salt", (e, o) => ({ ...e, salt: o.salt })],
    ];
    it.each(tampers)("%s", async (_name, tamper) => {
      const storage = new MemoryStorage();
      const vault = testVault(storage);
      await vault.save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
      await vault.save("b", OTHER_KEY, PASSPHRASE, "claude-sonnet-5-5");
      storage.setItem(entryKey("a"), JSON.stringify(tamper(readEntry(storage, "a"), readEntry(storage, "b"))));
      const error = await vault.unlock("a", PASSPHRASE).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AiError);
      expect((error as AiError).code).toBe("wrongPassphrase");
      expect(vault.key("a")).toBe(KEY);
      const fresh = testVault(storage);
      await expect(fresh.unlock("a", PASSPHRASE)).rejects.toMatchObject({ code: "wrongPassphrase" });
      expect(fresh.key("a")).toBeNull();
    });
  });

  it("leaves last4 and model unauthenticated, and a tampered model can't select an unknown one", async () => {
    const storage = new MemoryStorage();
    const vault = testVault(storage);
    await vault.save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    storage.setItem(entryKey("a"), JSON.stringify({ ...readEntry(storage), last4: "xxxx", model: "claude-opus-5-5" }));
    const fresh = testVault(storage);
    await fresh.unlock("a", PASSPHRASE);
    expect(fresh.status("a")).toEqual({ state: "unlocked", last4: "xxxx", model: "claude-opus-5-5" });
    storage.setItem(entryKey("a"), JSON.stringify({ ...readEntry(storage), model: "evil-model" }));
    expect(testVault(storage).status("a")).toEqual({ state: "none" });
  });
});

describe("the key derivation", () => {
  it("is PBKDF2 with SHA-256, the given iterations and a 16-byte salt, and a 12-byte iv", async () => {
    const spy = spyCrypto();
    const vault = createVault({ storage: () => new MemoryStorage(), crypto: spy.crypto, iterations: 7 });
    await vault.save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    const derive = spy.calls.find((c) => c.name === "deriveKey")!;
    const algorithm = derive.args[0] as { name: string; hash: string; iterations: number; salt: Uint8Array };
    expect(algorithm.name).toBe("PBKDF2");
    expect(algorithm.hash).toBe("SHA-256");
    expect(algorithm.iterations).toBe(7);
    expect(algorithm.salt.byteLength).toBe(16);
    expect(derive.args[2]).toEqual({ name: "AES-GCM", length: 256 });
    expect(spy.calls.find((c) => c.name === "importKey")!.args[2]).toBe("PBKDF2");
    expect((spy.calls.find((c) => c.name === "encrypt")!.args[0] as { iv: Uint8Array }).iv.byteLength).toBe(12);
  });

  it("is at least the 2023 OWASP minimum, and the default vault uses it", async () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    const spy = spyCrypto();
    await createVault({ storage: () => new MemoryStorage(), crypto: spy.crypto }).save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    expect((spy.calls.find((c) => c.name === "deriveKey")!.args[0] as { iterations: number }).iterations).toBe(PBKDF2_ITERATIONS);
  });

  it("stores the version, not the iteration count", async () => {
    const storage = new MemoryStorage();
    await testVault(storage).save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    expect(Object.keys(readEntry(storage))).not.toContain("iterations");
  });
});

describe("races", () => {
  it("runs two saves for one database one after the other: the last call wins, in memory and in storage", async () => {
    // the first save's encryption is slow, so without serialising it would finish last and win
    const spy = spyCrypto({ before: async (name, count) => { if (name === "encrypt" && count === 1) await new Promise((r) => setTimeout(r, 40)); } });
    const storage = new MemoryStorage();
    const vault = createVault({ storage: () => storage, crypto: spy.crypto, iterations: 1 });
    await Promise.all([
      vault.save("a", KEY, "first passphrase here", "claude-sonnet-5-5"),
      vault.save("a", OTHER_KEY, "second passphrase here", "claude-haiku-5-5"),
    ]);
    expect(vault.key("a")).toBe(OTHER_KEY);
    const fresh = testVault(storage);
    await fresh.unlock("a", "second passphrase here");
    expect(fresh.key("a")).toBe(vault.key("a"));
    expect(fresh.status("a")).toMatchObject({ model: "claude-haiku-5-5" });
    await expect(testVault(storage).unlock("a", "first passphrase here")).rejects.toMatchObject({ code: "wrongPassphrase" });
  });

  it("lets a save after a refused save go through, and saves for different databases don't wait for each other", async () => {
    const vault = testVault();
    await expect(vault.save("a", "nope", PASSPHRASE, "claude-sonnet-5-5")).rejects.toThrow("That doesn't look like an Anthropic key.");
    await Promise.all([vault.save("a", KEY, PASSPHRASE, "claude-sonnet-5-5"), vault.save("b", OTHER_KEY, PASSPHRASE, "claude-sonnet-5-5")]);
    expect(vault.key("a")).toBe(KEY);
    expect(vault.key("b")).toBe(OTHER_KEY);
  });

  /** A vault whose decrypt waits until `release` is called. */
  function gated() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const spy = spyCrypto({ before: async (name) => { if (name === "decrypt") await gate; } });
    const storage = new MemoryStorage();
    return { storage, release, vault: () => createVault({ storage: () => storage, crypto: spy.crypto, iterations: 1 }) };
  }

  it.each([
    ["lock", (v: ReturnType<typeof testVault>) => v.lock("a")],
    ["forget", (v: ReturnType<typeof testVault>) => v.forget("a")],
    ["lockAll", (v: ReturnType<typeof testVault>) => v.lockAll()],
  ])("an unlock that is still checking the passphrase doesn't unlock after %s", async (_name, act) => {
    const g = gated();
    await testVault(g.storage).save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    const vault = g.vault();
    const pending = vault.unlock("a", PASSPHRASE);
    act(vault);
    g.release();
    await pending;
    expect(vault.key("a")).toBeNull();
    expect(vault.status("a").state).not.toBe("unlocked");
  });

  it("an unlock that nobody interrupts still unlocks", async () => {
    const g = gated();
    await testVault(g.storage).save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    const vault = g.vault();
    const pending = vault.unlock("a", PASSPHRASE);
    vault.lock("b");
    g.release();
    await pending;
    expect(vault.key("a")).toBe(KEY);
  });
});

describe("other behaviour that is kept on purpose", () => {
  it("reads an entry with another version as no key, and the next save replaces it", async () => {
    const storage = new MemoryStorage();
    await testVault(storage).save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    storage.setItem(entryKey("a"), JSON.stringify({ ...readEntry(storage), v: 2 }));
    const vault = testVault(storage);
    expect(vault.status("a")).toEqual({ state: "none" });
    await expect(vault.unlock("a", PASSPHRASE)).rejects.toMatchObject({ code: "noKey" });
    await vault.save("a", OTHER_KEY, PASSPHRASE, "claude-sonnet-5-5");
    expect(readEntry(storage).v).toBe(1);
    expect(vault.status("a")).toMatchObject({ state: "unlocked", last4: "zzzz" });
  });

  it("keeps the old model when setModel can't write", async () => {
    const storage = new MemoryStorage();
    const vault = testVault(storage);
    await vault.save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    storage.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
    expect(() => vault.setModel("a", "claude-haiku-5-5")).not.toThrow();
    expect(vault.status("a")).toMatchObject({ model: "claude-sonnet-5-5" });
    expect(vault.key("a")).toBe(KEY);
  });

  it("lockAll locks two unlocked people, and forget of one leaves the other unlocked", async () => {
    const vault = testVault();
    await vault.save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    await vault.save("b", OTHER_KEY, PASSPHRASE, "claude-sonnet-5-5");
    vault.forget("a");
    expect(vault.key("a")).toBeNull();
    expect(vault.key("b")).toBe(OTHER_KEY);
    expect(vault.status("b").state).toBe("unlocked");
    vault.lockAll();
    expect(vault.key("b")).toBeNull();
    expect(vault.status("b").state).toBe("locked");
  });

  it("exports lockAllVaults from the barrel and from vault.ts, for the same real vault", () => {
    expect(lockAllVaults).toBe(lockAllFromVault);
    expect(() => lockAllVaults()).not.toThrow();
    expect(realVault.key("nobody-here")).toBeNull();
  });
});

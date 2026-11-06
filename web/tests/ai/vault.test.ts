import { describe, expect, it, vi } from "vitest";
import { AiError } from "../../src/ai";
import { ActionError } from "../../src/db/errors";
import { createVault } from "../../src/ai/vault";
import { KEY, MemoryStorage, PASSPHRASE, testVault } from "./helpers";

const stored = (s: MemoryStorage, db = "a") => s.getItem(`jobtracker:ai:vault:${db}`);

describe("the key vault", () => {
  it("saves a key, leaves it unlocked and unlocks it again after a reload", async () => {
    const storage = new MemoryStorage();
    const vault = testVault(storage);
    await vault.save("a", `  ${KEY} `, PASSPHRASE, "claude-opus-5-5");
    expect(vault.key("a")).toBe(KEY);
    expect(vault.status("a")).toEqual({ state: "unlocked", last4: "1234", model: "claude-opus-5-5" });

    const reloaded = testVault(storage);
    expect(reloaded.status("a")).toEqual({ state: "locked", last4: "1234", model: "claude-opus-5-5" });
    expect(reloaded.key("a")).toBeNull();
    await reloaded.unlock("a", PASSPHRASE);
    expect(reloaded.key("a")).toBe(KEY);
    expect(reloaded.status("a").state).toBe("unlocked");
  });

  it("refuses the wrong passphrase with the AiError sentence and stays locked", async () => {
    const storage = new MemoryStorage();
    await testVault(storage).save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    const vault = testVault(storage);
    const error = await vault.unlock("a", "not the passphrase").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).code).toBe("wrongPassphrase");
    expect((error as AiError).message).toBe("That passphrase didn't unlock your key.");
    expect(vault.key("a")).toBeNull();
  });

  it("fails a corrupt ciphertext, salt or iv with the same wrongPassphrase answer", async () => {
    const storage = new MemoryStorage();
    await testVault(storage).save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    const entry = JSON.parse(stored(storage)!);
    for (const patch of [{ ciphertext: btoa("garbage-garbage-garbage") }, { salt: "!!not base64!!" }, { iv: btoa("short") }]) {
      storage.setItem("jobtracker:ai:vault:a", JSON.stringify({ ...entry, ...patch }));
      await expect(testVault(storage).unlock("a", PASSPHRASE)).rejects.toMatchObject({ code: "wrongPassphrase" });
    }
  });

  it("never stores the key or the passphrase, only the encrypted entry", async () => {
    const storage = new MemoryStorage();
    await testVault(storage).save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    const raw = stored(storage)!;
    expect(storage.length).toBe(1);
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain(KEY.slice(-8));
    expect(raw).not.toContain("SECRETSECRET");
    expect(raw).not.toContain(PASSPHRASE);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["ciphertext", "iv", "last4", "model", "salt", "v"]);
    expect(JSON.parse(raw).v).toBe(1);
  });

  it("uses a fresh salt and iv for every save", async () => {
    const storage = new MemoryStorage();
    const vault = testVault(storage);
    await vault.save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    const first = JSON.parse(stored(storage)!);
    await vault.save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    const second = JSON.parse(stored(storage)!);
    expect(second.salt).not.toBe(first.salt);
    expect(second.iv).not.toBe(first.iv);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });

  it("keeps different people's keys apart", async () => {
    const storage = new MemoryStorage();
    const vault = testVault(storage);
    await vault.save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    expect(vault.status("b")).toEqual({ state: "none" });
    expect(vault.key("b")).toBeNull();
    await vault.save("b", "sk-ant-other-key-9999", "another passphrase", "claude-haiku-5-5");
    const reloaded = testVault(storage);
    await expect(reloaded.unlock("b", PASSPHRASE)).rejects.toBeInstanceOf(AiError);
    await reloaded.unlock("b", "another passphrase");
    expect(reloaded.key("b")).toBe("sk-ant-other-key-9999");
    expect(reloaded.key("a")).toBeNull();
    reloaded.forget("b");
    expect(reloaded.status("a")).toMatchObject({ state: "locked", last4: "1234" });
  });

  it("locks without forgetting, and forgets both copies", async () => {
    const storage = new MemoryStorage();
    const vault = testVault(storage);
    await vault.save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    vault.lock("a");
    expect(vault.key("a")).toBeNull();
    expect(vault.status("a").state).toBe("locked");
    await vault.unlock("a", PASSPHRASE);
    vault.forget("a");
    expect(vault.key("a")).toBeNull();
    expect(vault.status("a")).toEqual({ state: "none" });
    expect(stored(storage)).toBeNull();
  });

  it("lockAll locks every person's key", async () => {
    const vault = testVault();
    await vault.save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    await vault.save("b", KEY, PASSPHRASE, "claude-sonnet-5-5");
    vault.lockAll();
    expect(vault.key("a")).toBeNull();
    expect(vault.key("b")).toBeNull();
  });

  it("changes only the model with setModel, and ignores an unknown one", async () => {
    const storage = new MemoryStorage();
    const vault = testVault(storage);
    await vault.save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    const before = JSON.parse(stored(storage)!);
    vault.setModel("a", "claude-haiku-5-5");
    expect(JSON.parse(stored(storage)!)).toEqual({ ...before, model: "claude-haiku-5-5" });
    vault.setModel("a", "gpt-4" as never);
    expect(vault.status("a")).toMatchObject({ model: "claude-haiku-5-5" });
    vault.setModel("nobody", "claude-haiku-5-5");
    expect(stored(storage, "nobody")).toBeNull();
    await testVault(storage).unlock("a", PASSPHRASE);
  });

  it("refuses an empty key, a key that isn't Anthropic's and a short passphrase, saving nothing", async () => {
    const storage = new MemoryStorage();
    const vault = testVault(storage);
    const refusal = (key: string, passphrase: string) => vault.save("a", key, passphrase, "claude-sonnet-5-5").catch((e: unknown) => e);
    for (const [key, passphrase, text] of [
      ["   ", PASSPHRASE, "Enter your Anthropic key."],
      ["sk-openai-123", PASSPHRASE, "That doesn't look like an Anthropic key."],
      [KEY, "short", "Use a passphrase of at least 8 characters."],
    ] as const) {
      const error = await refusal(key, passphrase);
      expect(error).toBeInstanceOf(ActionError);
      expect((error as Error).message).toBe(text);
      expect((error as Error).message).not.toContain(key.trim() || "\u0000");
    }
    expect(storage.length).toBe(0);
    expect(vault.status("a")).toEqual({ state: "none" });
  });

  it("counts a malformed stored value as no key, without throwing", () => {
    const storage = new MemoryStorage();
    const vault = testVault(storage);
    const good = { v: 1, salt: "AA==", iv: "AA==", ciphertext: "AA==", last4: "1234", model: "claude-sonnet-5-5" };
    for (const value of ["not json", "null", "[]", "42", JSON.stringify({ ...good, v: 2 }), JSON.stringify({ ...good, model: "gpt" }), JSON.stringify({ ...good, last4: 1234 }), JSON.stringify({ v: 1 }), ""]) {
      storage.setItem("jobtracker:ai:vault:a", value);
      expect(vault.status("a")).toEqual({ state: "none" });
    }
    storage.setItem("jobtracker:ai:vault:a", JSON.stringify(good));
    expect(vault.status("a").state).toBe("locked");
  });

  describe("when storage is blocked", () => {
    const blocked = () => { throw new DOMException("blocked", "SecurityError"); };
    const vault = () => createVault({ storage: blocked, iterations: 1 });

    it("reports no key and doesn't throw from status, forget, lock, key or setModel", () => {
      const v = vault();
      expect(v.status("a")).toEqual({ state: "none" });
      expect(() => { v.forget("a"); v.lock("a"); v.setModel("a", "claude-haiku-5-5"); }).not.toThrow();
      expect(v.key("a")).toBeNull();
    });

    it("says it couldn't save, and keeps nothing unlocked", async () => {
      const v = vault();
      const error = await v.save("a", KEY, PASSPHRASE, "claude-sonnet-5-5").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ActionError);
      expect((error as Error).message).toBe("Couldn't save the key in this browser.");
      expect(v.key("a")).toBeNull();
    });

    it("says it couldn't save when the write fails (quota)", async () => {
      const storage = new MemoryStorage();
      storage.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
      await expect(testVault(storage).save("a", KEY, PASSPHRASE, "claude-sonnet-5-5")).rejects.toThrow("Couldn't save the key in this browser.");
    });
  });

  it("never writes the key or passphrase to the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const storage = new MemoryStorage();
    const vault = testVault(storage);
    await vault.save("a", KEY, PASSPHRASE, "claude-sonnet-5-5");
    await testVault(storage).unlock("a", "wrong passphrase").catch(() => undefined);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });
});

import "fake-indexeddb/auto";
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError } from "../../src/ai";
import type { JobTrackerDB } from "../../src/db/schema";
import { SettingsView, type SettingsDeps } from "../../src/pages/settings/SettingsPage";
import { exportAll } from "../../src/portability";
import { ada, byText, cleanupRendered, click, closeDbs, fakeAuth, freshDb, q, render, waitFor } from "../app/helpers";
import { type } from "../pages/applications/harness";
import { KEY, MemoryStorage, PASSPHRASE, fakeAiDeps, testVault } from "../ai/helpers";

afterEach(() => {
  cleanupRendered();
  closeDbs();
});

type Saved = "none" | "locked" | "unlocked";

async function setup(opts: { saved?: Saved; db?: JobTrackerDB; storage?: MemoryStorage } = {}) {
  const db = opts.db ?? freshDb();
  const storage = opts.storage ?? new MemoryStorage();
  const { deps: ai, complete } = fakeAiDeps(storage);
  if (opts.saved && opts.saved !== "none") {
    await ai.vault.save(db.name, KEY, PASSPHRASE, "claude-sonnet-5-5");
    if (opts.saved === "locked") ai.vault.lock(db.name);
  }
  const fake = fakeAuth({ status: "signed-in", user: ada });
  const deps: SettingsDeps = {
    auth: { getSession: fake.auth.getSession, subscribe: fake.auth.subscribe, signOut: fake.auth.signOut, connectMail: vi.fn(async () => undefined), tokenSource: vi.fn(async () => "token") },
    createProvider: vi.fn() as unknown as SettingsDeps["createProvider"],
    getAddress: vi.fn(async () => "me@gmail.com"),
    download: vi.fn(),
    downloadCsv: vi.fn(),
    ai,
  };
  await render(h(SettingsView, { db, user: ada, params: {}, query: new URLSearchParams(), navigate: () => undefined, deps }));
  await waitFor(() => q("#appearance input[type=radio]"));
  return { db, storage, ai, complete, deps };
}

const card = () => q("#ai")!;
const noticeText = () => q(".notice")?.textContent ?? "";
const input = (id: string) => q<HTMLInputElement>(`#${id}`)!;

async function fillAndSave(key: string, passphrase: string) {
  await type(input("ai-key"), key);
  await type(input("ai-passphrase"), passphrase);
  await click(byText("Save key")!);
}

describe("the AI card", () => {
  it("sits between Appearance and the other cards, with a jump link", async () => {
    await setup();
    const ids = Array.from(document.querySelectorAll("section.card")).map((s) => s.id);
    expect(ids.indexOf("ai")).toBe(ids.indexOf("appearance") + 1);
    expect(byText("AI", "nav a")).not.toBeNull();
    expect(card().textContent).toContain("Used to convert and tailor your resume. Only the text you choose to send goes to Anthropic, and your key stays on this device, locked with your passphrase.");
  });

  it("shows the form when there is no key", async () => {
    await setup();
    expect(input("ai-key").type).toBe("password");
    expect(input("ai-key").autocomplete).toBe("off");
    expect(input("ai-passphrase").type).toBe("password");
    expect(card().textContent).toContain("You'll type this to unlock your key. It isn't stored anywhere.");
    const options = Array.from(card().querySelectorAll<HTMLOptionElement>("select option")).map((o) => o.textContent);
    expect(options).toEqual(["Sonnet 5.5 (recommended)", "Haiku 5.5 (cheaper)", "Opus 5.5 (best)"]);
    expect(byText("Save key")).not.toBeNull();
    expect(byText("Unlock")).toBeNull();
    expect(byText("Forget key")).toBeNull();
  });

  it("shows the locked controls", async () => {
    await setup({ saved: "locked" });
    expect(card().textContent).toContain("Key ending in ••••1234");
    expect(input("ai-unlock").type).toBe("password");
    expect(byText("Unlock")).not.toBeNull();
    expect(byText("Forget key")).not.toBeNull();
    expect(byText("Check key")).toBeNull();
    expect(byText("Save key")).toBeNull();
  });

  it("shows the unlocked controls", async () => {
    await setup({ saved: "unlocked" });
    expect(card().textContent).toContain("Key ending in ••••1234");
    expect(card().textContent).toContain("Unlocked until you reload or log out.");
    for (const label of ["Check key", "Lock", "Forget key"]) expect(byText(label, "button")).not.toBeNull();
    expect(q("#ai-model")).not.toBeNull();
    expect(byText("Unlock")).toBeNull();
  });

  it("saves a key, shows only its last 4 and clears the inputs", async () => {
    const { ai, db, storage } = await setup();
    await type(q("#ai-model"), "claude-haiku-5-5");
    await fillAndSave(KEY, PASSPHRASE);
    await waitFor(() => card().textContent!.includes("Key ending in ••••1234"));
    expect(document.body.textContent).not.toContain(KEY);
    expect(document.body.textContent).not.toContain("SECRETSECRET");
    expect(card().querySelectorAll("input[type=password]").length).toBe(0);
    expect(ai.vault.key(db.name)).toBe(KEY);
    expect(ai.vault.status(db.name)).toMatchObject({ state: "unlocked", model: "claude-haiku-5-5" });
    expect(storage.getItem(`jobtracker:ai:vault:${db.name}`)).not.toContain(KEY);
  });

  it("clears the key and passphrase from the inputs even when saving is refused", async () => {
    const { ai, db } = await setup();
    await fillAndSave(KEY, "short");
    await waitFor(() => noticeText().includes("at least 8 characters"));
    expect(input("ai-key").value).toBe("");
    expect(input("ai-passphrase").value).toBe("");
    expect(ai.vault.status(db.name).state).toBe("none");
  });

  it("says why a key that isn't Anthropic's is refused", async () => {
    await setup();
    await fillAndSave("sk-openai-123", PASSPHRASE);
    await waitFor(() => noticeText() === "That doesn't look like an Anthropic key.");
    expect(q(".notice.err")).not.toBeNull();
  });

  it("unlocks with the right passphrase and clears the input", async () => {
    const { ai, db } = await setup({ saved: "locked" });
    await type(input("ai-unlock"), PASSPHRASE);
    await click(byText("Unlock")!);
    await waitFor(() => card().textContent!.includes("Unlocked until you reload or log out."));
    expect(ai.vault.key(db.name)).toBe(KEY);
    expect(document.body.textContent).not.toContain(KEY);
  });

  it("shows the sentence for a wrong passphrase and stays locked", async () => {
    const { ai, db } = await setup({ saved: "locked" });
    await type(input("ai-unlock"), "not the passphrase");
    await click(byText("Unlock")!);
    await waitFor(() => noticeText() === "That passphrase didn't unlock your key.");
    expect(q(".notice.err")).not.toBeNull();
    expect(input("ai-unlock").value).toBe("");
    expect(ai.vault.key(db.name)).toBeNull();
    expect(byText("Unlock")).not.toBeNull();
  });

  it("locks again", async () => {
    const { ai, db } = await setup({ saved: "unlocked" });
    await click(byText("Lock", "button")!);
    await waitFor(() => byText("Unlock"));
    expect(ai.vault.key(db.name)).toBeNull();
    expect(card().textContent).toContain("Key ending in ••••1234");
  });

  it("checks the key with a tiny Haiku request and says it works", async () => {
    const { complete } = await setup({ saved: "unlocked" });
    await click(byText("Check key")!);
    await waitFor(() => noticeText() === "Your key works.");
    expect(complete).toHaveBeenCalledTimes(1);
    const [key, request] = complete.mock.calls[0];
    expect(key).toBe(KEY);
    expect(request).toEqual({
      model: "claude-haiku-5-5",
      system: 'Reply with the JSON {"ok":true}.',
      user: "ping",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
      maxTokens: 20,
    });
    expect(noticeText()).not.toContain(KEY);
  });

  it("shows the AiError sentence when the check fails", async () => {
    const { complete } = await setup({ saved: "unlocked" });
    complete.mockRejectedValueOnce(new AiError("badKey"));
    await click(byText("Check key")!);
    await waitFor(() => noticeText() === "That key was refused. Check it in Settings.");
    expect(q(".notice.err")).not.toBeNull();
  });

  it("shows a plain sentence for an unexpected failure, never the details", async () => {
    const { complete } = await setup({ saved: "unlocked" });
    complete.mockRejectedValueOnce(new Error(`boom ${KEY}`));
    await click(byText("Check key")!);
    await waitFor(() => noticeText() === "Couldn't finish that. Try again.");
  });

  it("saves the model choice with the locked key", async () => {
    const { ai, db } = await setup({ saved: "unlocked" });
    await type(q("#ai-model"), "claude-opus-5-5");
    expect(ai.vault.status(db.name)).toMatchObject({ model: "claude-opus-5-5" });
    expect(q<HTMLSelectElement>("#ai-model")!.value).toBe("claude-opus-5-5");
  });

  it("asks before forgetting the key, and Cancel keeps it", async () => {
    const { ai, db } = await setup({ saved: "locked" });
    await click(byText("Forget key", "button")!);
    await waitFor(() => q(".inline-confirm"));
    expect(document.activeElement).toBe(byText("Cancel"));
    expect(ai.vault.status(db.name).state).toBe("locked");
    await click(byText("Cancel")!);
    expect(q(".inline-confirm")).toBeNull();
    expect(ai.vault.status(db.name).state).toBe("locked");

    await click(byText("Forget key", "button")!);
    await click(await waitFor(() => q(".inline-confirm button.danger")));
    await waitFor(() => q("#ai-key"));
    expect(ai.vault.status(db.name)).toEqual({ state: "none" });
    expect(noticeText()).toBe("Your key was removed from this browser.");
  });

  it("forgets an unlocked key too, after confirming", async () => {
    const { ai, db } = await setup({ saved: "unlocked" });
    await click(byText("Forget key", "button")!);
    await click(await waitFor(() => q(".inline-confirm button.danger")));
    await waitFor(() => q("#ai-key"));
    expect(ai.vault.key(db.name)).toBeNull();
  });
});

describe("clearing the key", () => {
  it("forgets it when you delete all your data, and the card goes back to the form", async () => {
    const { ai, db, storage } = await setup({ saved: "unlocked" });
    await click(byText("Delete all my data")!);
    await click(await waitFor(() => byText("Delete everything")));
    await waitFor(() => noticeText().startsWith("All your data"));
    expect(ai.vault.status(db.name)).toEqual({ state: "none" });
    expect(ai.vault.key(db.name)).toBeNull();
    expect(storage.length).toBe(0);
    await waitFor(() => q("#ai-key"));
  });

  it("keeps the key when you cancel the delete", async () => {
    const { ai, db } = await setup({ saved: "unlocked" });
    await click(byText("Delete all my data")!);
    await click(await waitFor(() => byText("Cancel")));
    expect(ai.vault.status(db.name).state).toBe("unlocked");
  });
});

describe("what a backup holds", () => {
  it("has no key in the settings table or the export", async () => {
    const db = freshDb();
    const storage = new MemoryStorage();
    const vault = testVault(storage);
    await vault.save(db.name, KEY, PASSPHRASE, "claude-sonnet-5-5");
    const exported = JSON.stringify(await exportAll(db));
    const settings = JSON.stringify(await db.table("settings").toArray());
    for (const text of [exported, settings]) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(KEY.slice(-8));
      expect(text).not.toContain("SECRETSECRET");
      expect(text).not.toContain(PASSPHRASE);
      expect(text).not.toContain("jobtracker:ai:vault");
    }
    expect(storage.length).toBe(1);
  });
});

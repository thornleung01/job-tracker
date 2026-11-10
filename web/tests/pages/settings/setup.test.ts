// Settings > Setup: the four rows, their states and buttons, Skip and Show skipped steps again, the demo build, and the
// Mail and AI tabs' new pieces (Account at the top, Look back before Sync now, the Get a key link).
import "fake-indexeddb/auto";
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_USER } from "../../../src/app/localUser";
import type { BackupDeps } from "../../../src/backup/deps";
import { recordBackup } from "../../../src/backup/state";
import { upsertAccount } from "../../../src/db/repo";
import type { JobTrackerDB } from "../../../src/db/schema";
import { SettingsView, type SettingsDeps } from "../../../src/pages/settings/SettingsPage";
import { saveMaster } from "../../../src/sync/documents";
import { dismissSetupCard, isSetupCardDismissed } from "../../../src/sync/setupStatus";
import type { ProviderName } from "../../../src/types";
import { KEY, MemoryStorage, PASSPHRASE, fakeAiDeps } from "../../ai/helpers";
import { ada, byText, cleanupRendered, click, closeDbs, fakeAuth, freshDb, q, render, settle, waitFor } from "../../app/helpers";
import { type } from "../applications/harness";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanupRendered();
  closeDbs();
});

const sections = [{ kind: "summary", heading: "Summary", lines: [{ text: "Analyst." }] }];

async function open(opts: { db?: JobTrackerDB; user?: typeof ada | typeof LOCAL_USER; section?: string; saved?: "locked" | "unlocked"; storage?: MemoryStorage; backup?: BackupDeps } = {}) {
  const db = opts.db ?? freshDb();
  const { deps: ai } = fakeAiDeps(opts.storage);
  if (opts.saved) {
    await ai.vault.save(db.name, KEY, PASSPHRASE, "claude-sonnet-5-5");
    if (opts.saved === "locked") ai.vault.lock(db.name);
  }
  const fake = fakeAuth({ status: "signed-in", user: ada });
  const download = vi.fn();
  const deps: SettingsDeps = {
    auth: {
      getSession: fake.auth.getSession,
      subscribe: fake.auth.subscribe,
      signOut: fake.auth.signOut,
      connectMail: vi.fn(async (p: ProviderName) => { await fake.set({ mail: { ...fake.auth.getSession().mail, [p]: true } }); }),
      tokenSource: vi.fn(async () => "token"),
    },
    createProvider: vi.fn((name: ProviderName) => ({ name, address: "me@gmail.com", async *fetch() {} })) as unknown as SettingsDeps["createProvider"],
    getAddress: vi.fn(async () => "me@gmail.com"),
    download,
    downloadCsv: vi.fn(),
    ai,
    ...(opts.backup ? { backup: opts.backup } : {}),
  };
  const params: Record<string, string> = opts.section ? { section: opts.section } : {};
  await render(h(SettingsView, { db, user: opts.user ?? ada, params, query: new URLSearchParams(), navigate: () => undefined, deps }));
  await waitFor(() => q("section.card h2"));
  return { db, deps, fake, download };
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>(".setup-row"));
const row = (title: string) => rows().find((r) => r.querySelector("h3")!.textContent!.startsWith(title))!;
const word = (title: string) => row(title).querySelector(".setup-word")!.textContent;
const count = () => q("#setup .setup-title-row p")!.textContent;
const states = () => rows().map((r) => r.className.replace("setup-row ", ""));

describe("Setup tab: a fresh account", () => {
  it("is the default and says 0 of 4 with the four rows in order, each with its words and one line on what it unlocks", async () => {
    await open();
    await waitFor(() => rows().length === 4);
    expect(q("#h-setup")!.textContent).toBe("Set up Job Tracker");
    expect(count()).toBe("0 of 4 done");
    expect(rows().map((r) => r.querySelector("h3")!.textContent)).toEqual(["Mailbox", "Resume", "AI key (optional)", "Backup"]);
    expect(states()).toEqual(["missing", "missing", "missing", "missing"]);
    expect(rows().map((r) => r.querySelector(".setup-word")!.textContent)).toEqual(["Not yet", "Not yet", "Not yet", "Not yet"]);
    expect(row("Mailbox").querySelector(".help")!.textContent).toBe("Finds your applications in your email.");
    expect(row("Resume").querySelector(".help")!.textContent).toBe("Starts every tailored resume and letter.");
    expect(row("AI key").querySelector(".help")!.textContent).toBe("Writes tailored resumes and letters, and reads the company and role from a pasted job.");
    expect(row("Backup").querySelector(".help")!.textContent).toBe("Keeps a copy if this browser's data is cleared.");
    expect(q("#setup")!.textContent).toContain("Everything else is in Mail, AI, Data and Appearance.");
    expect(byText("Show skipped steps again")).toBeNull();
  });

  it("offers each step's own buttons right there", async () => {
    await open();
    await waitFor(() => rows().length === 4);
    expect(Array.from(row("Mailbox").querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Connect Gmail", "Connect Outlook", "Skip, I'll add applications by hand"]);
    const add = byText("Add your resume", "a", row("Resume"))!;
    expect(add.getAttribute("href")).toBe("#/resume");
    expect(Array.from(row("AI key").querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Set up key", "Not now"]);
    const link = byText("Get a key from Anthropic", "a", row("AI key"))!;
    expect(link.getAttribute("href")).toBe("https://console.anthropic.com/settings/keys");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(Array.from(row("Backup").querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Export data"]);
  });

  it("every button has a name and the page keeps sentence case", async () => {
    await open();
    await waitFor(() => rows().length === 4);
    for (const b of Array.from(document.querySelectorAll("#setup button, #setup a.btn"))) {
      const t = b.textContent!.trim();
      expect(t).not.toBe("");
      expect(t.replace(/Gmail|Outlook|Anthropic|I'll/g, "x")).not.toMatch(/ [A-Z]/);
    }
    expect(document.body.textContent).not.toMatch(/[–—]/);
  });
});

describe("Setup tab: the mailbox row", () => {
  it("Connect Gmail connects and the row becomes Connected with the account's detail and Sync now", async () => {
    const { deps, db } = await open();
    await waitFor(() => rows().length === 4);
    await click(byText("Connect Gmail")!);
    await waitFor(() => word("Mailbox") === "Connected");
    expect(deps.auth.connectMail).toHaveBeenCalledWith("gmail");
    expect(count()).toBe("1 of 4 done");
    expect(row("Mailbox").textContent).toContain("Gmail · me@gmail.com");
    expect(byText("Sync now", "button", row("Mailbox"))).not.toBeNull();
    expect(await db.accounts.count()).toBe(1);
    expect(byText("Skip, I'll add applications by hand")).toBeNull();
  });

  it("an account from an earlier visit shows a Reconnect button instead of Sync now", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "me@gmail.com");
    await open({ db });
    await waitFor(() => word("Mailbox") === "Linked");
    expect(row("Mailbox").textContent).toContain("Not connected in this tab. Reconnect to sync.");
    expect(byText("Reconnect account", "button", row("Mailbox"))).not.toBeNull();
    expect(byText("Sync now")).toBeNull();
    // still done: sessions are lost on every reload, so the card must not nag after each one
    expect(row("Mailbox").className).toContain("done");
    expect(count()).toBe("1 of 4 done");
  });

  it("Skip counts the row as done by choice, and Show skipped steps again undoes it", async () => {
    const { db } = await open();
    await waitFor(() => rows().length === 4);
    await click(byText("Skip, I'll add applications by hand")!);
    await waitFor(() => word("Mailbox") === "Skipped");
    expect(count()).toBe("1 of 4 done");
    expect(row("Mailbox").className).toContain("skipped");
    expect(byText("Skip, I'll add applications by hand")).toBeNull();
    // the Connect buttons stay, so skipping never closes the door
    expect(byText("Connect Gmail")).not.toBeNull();
    expect(document.activeElement).toBe(q("#setup-mailbox"));
    await click(byText("Show skipped steps again")!);
    await waitFor(() => word("Mailbox") === "Not yet");
    expect(document.activeElement).toBe(q("#setup-mailbox"));
    expect(count()).toBe("0 of 4 done");
    expect(byText("Show skipped steps again")).toBeNull();
    expect((await db.settings.get("setupSkips"))).toBeUndefined();
  });
});

describe("Setup tab: the resume row", () => {
  it("shows the master resume's date and an Open link once there is one", async () => {
    const db = freshDb();
    await saveMaster(db, sections, "paste");
    await open({ db });
    await waitFor(() => word("Resume") === "Added");
    expect(row("Resume").textContent).toContain("Master resume · updated ");
    expect(byText("Open", "a", row("Resume"))!.getAttribute("href")).toBe("#/resume");
    expect(count()).toBe("1 of 4 done");
  });
});

describe("Setup tab: the AI key row", () => {
  it("Set up key opens the key form inline, and saving it makes the row Unlocked and the count 1", async () => {
    await open();
    await waitFor(() => rows().length === 4);
    await click(byText("Set up key")!);
    expect(q("#ai-key")).not.toBeNull();
    await type(q<HTMLInputElement>("#ai-key")!, KEY);
    await type(q<HTMLInputElement>("#ai-passphrase")!, PASSPHRASE);
    await click(byText("Save key")!);
    await waitFor(() => word("AI key") === "Unlocked");
    expect(count()).toBe("1 of 4 done");
    expect(row("AI key").textContent).toContain("Key ending in ••••");
    expect(row("AI key").textContent).toContain("Unlocked until you reload or log out.");
  });

  it("a locked key shows its ending and an inline passphrase with Unlock", async () => {
    await open({ saved: "locked" });
    await waitFor(() => word("AI key") === "Locked");
    expect(row("AI key").textContent).toContain("Key ending in ••••");
    expect(row("AI key").textContent).toContain("Locked until you unlock it.");
    await type(q<HTMLInputElement>("#ai-passphrase")!, PASSPHRASE);
    await click(byText("Unlock")!);
    await waitFor(() => word("AI key") === "Unlocked");
  });

  it("Not now skips the row; the key can still be set up", async () => {
    await open();
    await waitFor(() => rows().length === 4);
    await click(byText("Not now")!);
    await waitFor(() => word("AI key") === "Skipped");
    expect(count()).toBe("1 of 4 done");
    expect(byText("Not now")).toBeNull();
    expect(byText("Set up key")).not.toBeNull();
  });
});

describe("Setup tab: the backup row", () => {
  it("Export data downloads the file and the row becomes Backed up", async () => {
    const { download } = await open();
    await waitFor(() => rows().length === 4);
    await click(byText("Export data")!);
    await waitFor(() => word("Backup") === "Backed up");
    expect(download).toHaveBeenCalledTimes(1);
    expect(row("Backup").textContent).toContain("Backed up ");
    expect(count()).toBe("1 of 4 done");
  });

  it("a backup from the last 14 days is already done", async () => {
    const db = freshDb();
    recordBackup(db.name);
    await open({ db });
    await waitFor(() => word("Backup") === "Backed up");
  });
});

describe("Setup tab: all four and the card's dismissal setting", () => {
  it("says 4 of 4 when everything is set up or skipped", async () => {
    const db = freshDb();
    await saveMaster(db, sections, "paste");
    recordBackup(db.name);
    await db.settings.put({ key: "setupSkips", value: { mailbox: true, aiKey: true } });
    await open({ db });
    await waitFor(() => count() === "4 of 4 done");
    expect(states()).toEqual(["skipped", "done", "skipped", "done"]);
    await dismissSetupCard(db);
    expect(await isSetupCardDismissed(db)).toBe(true);
  });
});

describe("Setup tab: the backup row after choosing a file", () => {
  it("shows the chosen file as done even though nothing could be written to it yet", async () => {
    const handle = { name: "jobs.json", queryPermission: async () => "granted" as const, getFile: async () => ({ text: async () => "" }), createWritable: async () => ({ write: async () => undefined, close: async () => undefined }) };
    const map = new Map<string, typeof handle>();
    const backup: BackupDeps = {
      file: { store: { get: async (k) => map.get(k) ?? null, put: async (k, v) => void map.set(k, v as typeof handle), delete: async (k) => void map.delete(k) }, showSaveFilePicker: vi.fn(async () => handle) },
      storage: async () => ({ persisted: "unknown", usage: null, quota: null }),
    };
    await open({ backup });
    await waitFor(() => word("Backup") === "Not yet");
    await click(byText("Choose a backup file")!);
    // an empty database: nothing is written, so no backup is recorded, but the file is chosen
    await waitFor(() => word("Backup") === "Backed up");
    expect(row("Backup").textContent).toContain("Backup file · jobs.json");
  });
});

describe("Setup tab: the demo build", () => {
  it("says the demo can't connect mail, offers no Connect buttons and no link to the owner guide", async () => {
    await open({ user: LOCAL_USER });
    await waitFor(() => rows().length === 4);
    expect(row("Mailbox").textContent).toContain("This demo can't connect mail. Your data stays in this browser.");
    expect(byText("Connect Gmail")).toBeNull();
    expect(byText("Connect Outlook")).toBeNull();
    expect(document.body.innerHTML).not.toContain("#/setup");
    expect(byText("Skip, I'll add applications by hand")).toBeNull();
    expect(word("Mailbox")).toBe("Not available");
    expect(row("Mailbox").className).toContain("done");
  });

  it("also opens from #/settings/setup", async () => {
    await open({ user: LOCAL_USER, section: "setup" });
    await waitFor(() => rows().length === 4);
    await settle();
    expect(count()).toBe("1 of 4 done");
  });
});

describe("Mail tab", () => {
  it("has Account at the top and Look back on first sync before Sync now", async () => {
    await open({ section: "mail" });
    await waitFor(() => q("#sync"));
    const headings = Array.from(document.querySelectorAll("h2")).map((e) => e.textContent);
    expect(headings.slice(0, 2)).toEqual(["Account", "Email accounts"]);
    expect(q("#account")!.textContent).toContain("Logged in as Ada Lovelace");
    const look = q("#lookback")!;
    const syncNow = byText("Sync now") ?? byText("Connect an email account above to sync.", "p");
    expect(look.compareDocumentPosition(syncNow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("puts Look back before Sync now when an account is connected too", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "me@gmail.com");
    await open({ db, section: "mail" });
    const syncNow = await waitFor(() => byText("Sync now"));
    expect(q("#lookback")!.compareDocumentPosition(syncNow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("AI tab", () => {
  it("links to Anthropic's console in a new tab when there is no key", async () => {
    await open({ section: "ai" });
    const link = await waitFor(() => byText("Get a key from Anthropic", "a"));
    expect(link.getAttribute("href")).toBe("https://console.anthropic.com/settings/keys");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("has no key link once a key is saved", async () => {
    await open({ section: "ai", saved: "locked" });
    await waitFor(() => q("#ai-last4"));
    expect(byText("Get a key from Anthropic", "a")).toBeNull();
  });
});

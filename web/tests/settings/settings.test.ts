import "fake-indexeddb/auto";
import { createElement as h } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView, type SettingsDeps } from "../../src/pages/settings/SettingsPage";
import { forgetConnections } from "../../src/pages/settings/actions";
import { downloadCsv as realDownloadCsv, exportApplicationsCsv } from "../../src/pages/settings/exportCsv";
import { listAccounts, upsertAccount } from "../../src/db/repo";
import { exportAllAsJson } from "../../src/portability";
import { loadSettings, saveSettings } from "../../src/sync/settings";
import type { JobTrackerDB } from "../../src/db/schema";
import { ProviderHttpError } from "../../src/providers/backoff";
import { NotConnected, type MailProvider, type Message, type ProviderName } from "../../src/types";
import { mk } from "../sync/helpers";
import fixture from "../fixtures/python-export.json";
import { ada, byText, click, cleanupRendered, closeDbs, fakeAuth, freshDb, q, render, settle, sleep, waitFor } from "../app/helpers";

beforeEach(() => forgetConnections());
afterEach(() => {
  cleanupRendered();
  closeDbs();
});

interface Setup {
  db: JobTrackerDB;
  deps: SettingsDeps;
  fake: ReturnType<typeof fakeAuth>;
  download: ReturnType<typeof vi.fn>;
  downloadCsv: ReturnType<typeof vi.fn>;
  createProvider: ReturnType<typeof vi.fn>;
}

type ProviderMaker = (name: ProviderName) => MailProvider;

async function setup(opts: { maker?: ProviderMaker; db?: JobTrackerDB } = {}): Promise<Setup> {
  const db = opts.db ?? freshDb();
  const fake = fakeAuth({ status: "signed-in", user: ada });
  const download = vi.fn();
  const downloadCsv = vi.fn();
  const createProvider = vi.fn((name: ProviderName) =>
    (opts.maker ?? ((n) => ({ name: n, address: "me@gmail.com", async *fetch() {} })))(name),
  );
  const deps: SettingsDeps = {
    auth: {
      getSession: fake.auth.getSession,
      subscribe: fake.auth.subscribe,
      signOut: fake.auth.signOut,
      connectMail: vi.fn(async (p: ProviderName) => {
        await fake.set({ mail: { ...fake.auth.getSession().mail, [p]: true } });
      }),
      tokenSource: vi.fn(async () => "token"),
    },
    createProvider: createProvider as unknown as SettingsDeps["createProvider"],
    getAddress: vi.fn(async (p: ProviderName) => (p === "gmail" ? "me@gmail.com" : "me@outlook.com")),
    download,
    downloadCsv,
  };
  await render(h(SettingsView, { db, user: ada, params: {}, query: new URLSearchParams(), navigate: () => undefined, deps }));
  await waitFor(() => q("#appearance input[type=radio]"));
  return { db, deps, fake, download, downloadCsv, createProvider };
}

const noticeText = () => q(".notice")?.textContent ?? "";

async function chooseFile(name: string, text: string) {
  const input = q<HTMLInputElement>("input[type=file]")!;
  const file = new File([text], name, { type: "application/json" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(30);
  });
}

async function withApplications(db: JobTrackerDB, n = 2) {
  await db.applications.bulkAdd(
    Array.from({ length: n }, (_, i) => ({
      company: `Acme ${i}`, companyKey: `acme${i}`, role: "Engineer", roleKey: "engineer", stage: "Applied" as const,
      stageAt: null, appliedAt: null, lastActivity: null, locked: false, manual: false,
    })),
  );
}

describe("page structure", () => {
  it("has the template's sections, one h1, and sentence case throughout", async () => {
    await setup();
    expect(q("h1")!.textContent).toBe("Settings");
    expect(Array.from(document.querySelectorAll("h2")).map((e) => e.textContent)).toEqual(["Email accounts", "Sync", "Appearance", "Save jobs from any site", "Your data", "Account"]);
    for (const b of Array.from(document.querySelectorAll("button, label.btn"))) {
      const t = b.textContent!.trim();
      // sentence case: only names (Gmail, Outlook) and the CSV acronym are capitalised after the first word
      if (t) expect(t.replace(/Gmail|Outlook|CSV/g, "x")).not.toMatch(/ [A-Z]/);
    }
    expect(document.body.textContent).not.toMatch(/[–—]/);
    expect(byText("Log out")).not.toBeNull();
  });

  it("section links scroll instead of changing the hash", async () => {
    await setup();
    window.location.hash = "#/settings";
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    await click(byText("Appearance", "nav a")!);
    expect(scroll).toHaveBeenCalled();
    expect(window.location.hash).toBe("#/settings");
  });
});

describe("appearance", () => {
  it("shows the saved choices and saves each change straight away", async () => {
    const db = freshDb();
    await saveSettings(db, "appearance", { theme: "light", accent: "forest", density: "compact" });
    await setup({ db });
    const checked = (name: string) => q<HTMLInputElement>(`input[name=${name}]:checked`)!.value;
    expect([checked("theme"), checked("accent"), checked("density"), checked("corners")]).toEqual(["light", "forest", "compact", "soft"]);

    await click(q("input[name=theme][value=dark]")!);
    await click(q("input[name=accent][value=clay]")!);
    await click(q("input[name=density][value=comfortable]")!);
    await click(q("input[name=corners][value=sharp]")!);
    await waitFor(async () => (await loadSettings(db)).appearance.corners === "sharp");
    expect((await loadSettings(db)).appearance).toMatchObject({ theme: "dark", accent: "clay", density: "comfortable", corners: "sharp" });
    expect(checked("theme")).toBe("dark");
  });

  it("has seg and swatch controls, system theme included", async () => {
    await setup();
    expect(document.querySelectorAll(".seg").length).toBe(3);
    expect(Array.from(document.querySelectorAll("input[name=theme]")).map((i) => (i as HTMLInputElement).value)).toEqual(["system", "light", "dark"]);
    expect(document.querySelectorAll(".swatches input").length).toBe(4);
    expect(q<HTMLElement>(".swatches i")!.style.getPropertyValue("--l")).toBe("#000000");
  });

  it("keeps Company and Stage fixed and saves the other columns", async () => {
    const { db } = await setup();
    const box = (label: string) => byText(label, ".checks label")!.querySelector<HTMLInputElement>("input")!;
    expect(box("Company").disabled && box("Company").checked).toBe(true);
    expect(box("Stage").disabled && box("Stage").checked).toBe(true);
    expect(box("Emails").checked).toBe(false);
    await click(box("Emails"));
    await waitFor(async () => (await loadSettings(db)).appearance.columns.includes("emails"));
    await click(box("Role"));
    await waitFor(async () => !(await loadSettings(db)).appearance.columns.includes("role"));
    expect((await loadSettings(db)).appearance.columns).toEqual(["company", "stage", "applied", "lastActivity", "emails"]);
  });

  it("saves the default flow period and the first-sync lookback", async () => {
    const { db } = await setup();
    const flow = q<HTMLSelectElement>("#flow_days")!;
    expect(Array.from(flow.options).map((o) => o.textContent)).toEqual(["All time", "Last 30 days", "Last 90 days", "Last 180 days"]);
    await act(async () => {
      flow.value = "90";
      flow.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(20);
    });
    const lookback = q<HTMLSelectElement>("#lookback")!;
    await act(async () => {
      lookback.value = "180";
      lookback.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(20);
    });
    await waitFor(async () => (await loadSettings(db)).sync.lookbackDays === 180);
    expect((await loadSettings(db)).appearance.flowDays).toBe(90);
  });
});

describe("email accounts", () => {
  it("connects Gmail: asks for mail access, reads the address and saves the account", async () => {
    const { db, deps } = await setup();
    expect(q(".account-list")).toBeNull();
    await click(byText("Connect Gmail")!);
    await waitFor(() => q(".account-list"));
    expect(deps.auth.connectMail).toHaveBeenCalledWith("gmail");
    expect(deps.getAddress).toHaveBeenCalledWith("gmail", deps.auth.tokenSource);
    expect((await listAccounts(db)).map((a) => [a.provider, a.address, a.active])).toEqual([["gmail", "me@gmail.com", true]]);
    expect(q(".prof .name")!.textContent).toContain("Gmail me@gmail.com");
    expect(q(".prof")!.textContent).toContain("Not synced yet");
    expect(q(".prof")!.textContent).toContain("Connected in this tab");
    expect(noticeText()).toBe("Connected Gmail me@gmail.com.");
    expect(q(".provider .addr")!.textContent).toBe("Connected as me@gmail.com");
  });

  it("connects Outlook", async () => {
    const { db, deps } = await setup();
    await click(byText("Connect Outlook")!);
    await waitFor(async () => (await listAccounts(db)).length === 1);
    expect(deps.auth.connectMail).toHaveBeenCalledWith("outlook");
    expect((await listAccounts(db))[0]).toMatchObject({ provider: "outlook", address: "me@outlook.com" });
  });

  it("shows a refused connection as an error and saves nothing", async () => {
    const { db, deps } = await setup();
    (deps.auth.connectMail as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new NotConnected("Google did not give access"));
    await click(byText("Connect Gmail")!);
    await waitFor(() => q(".notice.err"));
    expect(noticeText()).toBe("Couldn't connect Gmail. Google did not give access");
    expect(await listAccounts(db)).toEqual([]);
  });

  it("says plainly that an account from an earlier visit needs connecting again", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "me@gmail.com");
    await db.accounts.update(1, { lastSync: "2026-10-20T12:00:00Z" });
    await setup({ db });
    const row = q(".prof")!;
    expect(row.textContent).toContain("Synced");
    expect(row.textContent).toContain("Not connected in this tab. Reconnect to sync.");
    expect(byText("Reconnect account")).not.toBeNull();
    expect(q(".provider .addr")!.textContent).toBe("Not connected in this tab");
  });

  it("shows the last error of an account", async () => {
    const db = freshDb();
    const id = await upsertAccount(db, "gmail", "me@gmail.com");
    await db.accounts.update(id, { lastError: "ProviderHttpError: 403" });
    await setup({ db });
    expect(q(".prof .status-bad")!.textContent).toBe("ProviderHttpError: 403");
  });

  it("disconnects an account and keeps its emails, then reconnects", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "me@gmail.com");
    const { deps } = await setup({ db });
    await click(byText("Disconnect account")!);
    await waitFor(() => byText("Reconnect account"));
    expect((await listAccounts(db))[0].active).toBe(false);
    expect(q(".prof")!.textContent).toContain("Disconnected");
    await click(byText("Reconnect account")!);
    await waitFor(async () => (await listAccounts(db))[0].active);
    expect(deps.auth.connectMail).toHaveBeenCalledWith("gmail");
    expect(await listAccounts(db)).toHaveLength(1);
  });
});

describe("sync", () => {
  const gmailWith = (messages: Message[]): ProviderMaker => (name) => ({
    name, address: "me@gmail.com",
    async *fetch(_since, skip) {
      for (const m of messages) if (!skip(m.id)) yield m;
    },
  });

  it("offers Sync now only when there is an account", async () => {
    await setup();
    expect(byText("Sync now")).toBeNull();
    expect(q("#sync")!.textContent).toContain("Connect an email account above to sync.");
  });

  it("runs syncAccount through a provider built from the token source, then reports", async () => {
    const { db, deps, createProvider } = await setup({ maker: gmailWith([mk("1", "Thank you for applying to Acme")]) });
    await click(byText("Connect Gmail")!);
    await waitFor(() => byText("Sync now"));
    await click(byText("Sync now")!);
    await waitFor(() => noticeText().startsWith("Synced"));
    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(createProvider.mock.calls[0][0]).toBe("gmail");
    expect(createProvider.mock.calls[0][1]).toBe(deps.auth.tokenSource);
    expect(createProvider.mock.calls[0][2]).toMatchObject({ oldestFirst: true });
    expect(noticeText()).toBe("Synced 1 account. 1 added to applications, 0 need review.");
    expect(await db.applications.count()).toBe(1);
    const row = (await listAccounts(db))[0];
    expect(row.lastSync).not.toBeNull();
    await waitFor(() => q(".prof .status-ok"));
  });

  it("uses the scan choice", async () => {
    const seen: { since?: Date } = {};
    const { fake } = await setup({
      maker: (name) => ({ name, address: "me@gmail.com", async *fetch(since) { seen.since = since; } }),
    });
    void fake;
    await click(byText("Connect Gmail")!);
    await waitFor(() => byText("Sync now"));
    const scan = q<HTMLSelectElement>("#scan")!;
    expect(Array.from(scan.options).map((o) => o.textContent)).toEqual(["New emails since last sync", "Last 30 days", "Last 90 days", "Last 180 days"]);
    await act(async () => {
      scan.value = "90";
      scan.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(10);
    });
    await click(byText("Sync now")!);
    await waitFor(() => noticeText().startsWith("Synced"));
    const days = Math.round((Date.now() - seen.since!.getTime()) / 86_400_000);
    expect(days).toBe(90);
  });

  it("shows a progress bar while it runs and lets you stop", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { createProvider } = await setup({
      maker: (name) => ({
        name, address: "me@gmail.com",
        async *fetch(_s, _k, signal) {
          yield mk("1", "Thank you for applying to Acme");
          await new Promise<void>((resolve, reject) => {
            void gate.then(resolve);
            signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          });
        },
      }),
    });
    await click(byText("Connect Gmail")!);
    await waitFor(() => byText("Sync now"));
    await click(byText("Sync now")!);
    const bar = await waitFor(() => q("[role=progressbar].bar"));
    expect(bar.getAttribute("aria-label")).toBe("Sync progress");
    await waitFor(() => q(".progress-card")!.textContent!.includes("Gmail me@gmail.com: reading 1"));
    expect(byText("Sync now")).toBeNull();
    await click(byText("Stop")!);
    await waitFor(() => q(".notice")?.textContent?.includes("Sync stopped."));
    expect(q(".progress-card")).toBeNull();
    expect(byText("Sync now")).not.toBeNull();
    release();
    expect(createProvider).toHaveBeenCalledTimes(1);
  });

  it("asks you to connect again when the provider says NotConnected", async () => {
    await setup({
      maker: (name) => ({ name, address: "me@gmail.com", async *fetch() { throw new NotConnected("Gmail is not connected"); } }),
    });
    await click(byText("Connect Gmail")!);
    await waitFor(() => byText("Sync now"));
    await click(byText("Sync now")!);
    await waitFor(() => q(".notice.err"));
    expect(noticeText()).toBe("Reconnect Gmail me@gmail.com, then try again.");
    expect(q(".notice")!.getAttribute("role")).toBe("alert");
  });

  it("does not call the provider for an account that is not connected in this tab", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "me@gmail.com");
    const { createProvider } = await setup({ db });
    await click(byText("Sync now")!);
    await waitFor(() => q(".notice.err"));
    expect(noticeText()).toBe("Reconnect Gmail me@gmail.com, then try again.");
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("refuses to sync an account with a token that belongs to another mailbox", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "other@gmail.com");
    const { createProvider } = await setup({ db });
    await click(byText("Connect Gmail")!); // connects me@gmail.com, a second account
    await waitFor(async () => (await listAccounts(db)).length === 2);
    await click(byText("Sync now")!);
    await waitFor(() => noticeText().includes("Reconnect Gmail other@gmail.com"));
    expect(createProvider).toHaveBeenCalledTimes(1);
  });

  it("reports another failure by name and keeps going", async () => {
    await setup({
      maker: (name) => ({ name, address: "me@gmail.com", async *fetch() { throw new ProviderHttpError(500, "HTTP 500"); } }),
    });
    await click(byText("Connect Gmail")!);
    await waitFor(() => byText("Sync now"));
    await click(byText("Sync now")!);
    await waitFor(() => q(".notice.err"));
    expect(noticeText()).toBe("Gmail me@gmail.com: Gmail is busy right now. Try again in a few minutes.");
    await waitFor(() => q(".prof .status-bad"));
    expect(q(".prof .status-bad")!.textContent).toBe("Gmail is busy right now. Try again in a few minutes.");
  });
});

describe("your data", () => {
  it("exports everything as a JSON file", async () => {
    const { db, download } = await setup();
    await withApplications(db, 2);
    await click(byText("Export data")!);
    await waitFor(() => download.mock.calls.length === 1);
    const [filename, text] = download.mock.calls[0];
    expect(filename).toMatch(/^job-tracker-\d{4}-\d{2}-\d{2}\.json$/);
    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({ format: "jobtracker-export", source: "web" });
    expect(parsed.data.applications).toHaveLength(2);
    expect(noticeText()).toBe("Your data was exported.");
  });

  it("exports the applications as a CSV file next to Export data", async () => {
    const { db, downloadCsv } = await setup();
    await withApplications(db, 2);
    await click(byText("Export CSV")!);
    await waitFor(() => downloadCsv.mock.calls.length === 1);
    const [filename, text] = downloadCsv.mock.calls[0];
    expect(filename).toMatch(/^job-tracker-applications-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.split("\r\n")).toHaveLength(4);       // header, two applications, and the closing line end
    expect(text).toContain("Acme 0,Engineer,Applied");
    expect(byText("Export CSV")!.previousElementSibling).toBe(byText("Export data"));
    expect(noticeText()).toBe("Your applications were exported.");
  });

  it("says so, and downloads nothing, when the applications can't be listed", async () => {
    const { db, downloadCsv } = await setup();
    await withApplications(db, 2);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(db.emails, "toArray").mockRejectedValueOnce(new Error("disk is full"));
    try {
      await click(byText("Export CSV")!);
      await waitFor(() => noticeText() !== "");
      expect(noticeText()).toBe("Couldn't export your applications. Try again.");
      expect(downloadCsv).not.toHaveBeenCalled();
      expect(q(".notice")!.className).toContain("err");
      expect(logged).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("saves the CSV as a text/csv;charset=utf-8 file", async () => {
    const db = freshDb();
    await withApplications(db, 1);
    const csv = await exportApplicationsCsv(db);
    const createObjectURL = vi.fn((_blob: Blob) => "blob:csv");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });     // jsdom has neither
    // The download revokes its link a second later. Fake timers catch that call and drop it, so it can't fire after the stubs go.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      realDownloadCsv("job-tracker-applications-2026-11-05.csv", csv);
    } finally {
      vi.useRealTimers();
      delete (URL as { createObjectURL?: unknown }).createObjectURL;
      delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const read = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(read).toBe(csv.slice(1));       // reading as text drops the byte order mark
    expect(blob.size).toBe(new TextEncoder().encode(csv).length);
  });

  it("imports the app's own export after a confirmation", async () => {
    const source = freshDb();
    await withApplications(source, 3);
    const file = await exportAllAsJson(source);
    const db = freshDb();
    await withApplications(db, 1);
    await setup({ db });

    await chooseFile("backup.json", file);
    const dialog = await waitFor(() => q(".confirm"));
    expect(dialog.textContent).toContain("Replace everything in this browser with backup.json?");
    expect(await db.applications.count()).toBe(1); // nothing yet
    await click(byText("Replace my data")!);
    await waitFor(() => noticeText().startsWith("Imported"));
    expect(noticeText()).toBe("Imported 3 applications and 0 emails.");
    expect(await db.applications.count()).toBe(3);
    expect(q(".confirm")).toBeNull();
  });

  it("leaves everything alone when you cancel an import", async () => {
    const source = freshDb();
    await withApplications(source, 3);
    const db = freshDb();
    await withApplications(db, 1);
    await setup({ db });
    await chooseFile("backup.json", await exportAllAsJson(source));
    await click(await waitFor(() => byText("Cancel")));
    expect(q(".confirm")).toBeNull();
    expect(await db.applications.count()).toBe(1);
  });

  it("imports a file from the local edition", async () => {
    const db = freshDb();
    await setup({ db });
    await chooseFile("python.json", JSON.stringify(fixture));
    const dialog = await waitFor(() => q(".confirm"));
    expect(dialog.textContent).toContain("(from the local edition)");
    await click(byText("Replace my data")!);
    await waitFor(() => noticeText().startsWith("Imported"));
    expect(noticeText()).toBe("Imported 39 applications and 80 emails.");
    expect(await db.applications.count()).toBe(39);
  });

  it("shows why a file cannot be imported, and changes nothing", async () => {
    const db = freshDb();
    await withApplications(db, 1);
    await setup({ db });
    await chooseFile("notes.json", "this is not json");
    await waitFor(() => q(".notice.err"));
    expect(noticeText()).toContain("This file can't be imported.");
    expect(noticeText()).toContain("The file isn't valid JSON.");
    expect(q(".confirm")).toBeNull();

    await chooseFile("wrong.json", JSON.stringify({ format: "jobtracker-export", version: 1, data: { applications: "nope" } }));
    await click(await waitFor(() => byText("Replace my data")));
    await waitFor(() => q(".notice.err .line + .line"));
    expect(document.querySelectorAll(".notice .line").length).toBeGreaterThan(1);
    expect(q(".confirm")).toBeNull();
    expect(await db.applications.count()).toBe(1);
  });

  it("deletes all data only after you confirm", async () => {
    const db = freshDb();
    await withApplications(db, 2);
    await upsertAccount(db, "gmail", "me@gmail.com");
    await saveSettings(db, "appearance", { theme: "dark" });
    await setup({ db });

    await click(byText("Delete all my data")!);
    const dialog = await waitFor(() => q(".confirm"));
    expect(document.activeElement).toBe(byText("Cancel"));
    await click(byText("Cancel")!);
    expect(await db.applications.count()).toBe(2);
    expect(q(".confirm")).toBeNull();

    await click(byText("Delete all my data")!);
    await click(await waitFor(() => byText("Delete everything")));
    await waitFor(() => noticeText().startsWith("All your data"));
    expect(dialog).toBeDefined();
    expect(await db.applications.count()).toBe(0);
    expect(await db.accounts.count()).toBe(0);
    expect((await loadSettings(db)).appearance.theme).toBe("system");
    await waitFor(() => !q(".account-list"));
  });
});

describe("account", () => {
  it("names who is logged in and logs out", async () => {
    const { deps } = await setup();
    expect(q("#account")!.textContent).toContain("Logged in as Ada Lovelace (ada@example.com) with Google.");
    await click(byText("Log out")!);
    expect(deps.auth.signOut).toHaveBeenCalledTimes(1);
  });
});

void settle;

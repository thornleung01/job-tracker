import "fake-indexeddb/auto";
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackupDeps } from "../../src/backup/deps";
import type { FileHandleLike, HandleStore } from "../../src/backup/fileBackup";
import { readBackupState, recordBackup } from "../../src/backup/state";
import type { StorageStatus } from "../../src/backup/storage";
import type { JobTrackerDB } from "../../src/db/schema";
import { SettingsView, type SettingsDeps } from "../../src/pages/settings/SettingsPage";
import { byText, cleanupRendered, click, closeDbs, fakeAuth, freshDb, q, render, ada, waitFor } from "../app/helpers";

afterEach(() => {
  cleanupRendered();
  closeDbs();
});

function memoryStore(): HandleStore & { map: Map<string, FileHandleLike> } {
  const map = new Map<string, FileHandleLike>();
  return { map, get: async (k) => map.get(k) ?? null, put: async (k, handle) => void map.set(k, handle), delete: async (k) => void map.delete(k) };
}

function fakeHandle(name = "jobs-backup.json", old = "") {
  const contents = { text: old };
  const handle: FileHandleLike = {
    name,
    queryPermission: async () => "granted",
    getFile: async () => ({ text: async () => contents.text }),
    createWritable: async () => {
      let pending = "";
      return { write: async (d: string) => void (pending += d), close: async () => void (contents.text = pending) };
    },
  };
  return { handle, contents };
}

interface Options {
  status?: StorageStatus;
  picker?: boolean;
  file?: ReturnType<typeof fakeHandle>;
  stored?: boolean;
}

async function setup(opts: Options = {}) {
  const db: JobTrackerDB = freshDb();
  const fake = fakeAuth({ status: "signed-in", user: ada });
  const download = vi.fn();
  const downloadCsv = vi.fn();
  const file = opts.file ?? fakeHandle();
  const store = memoryStore();
  if (opts.stored) store.map.set(db.name, file.handle);
  const picker = vi.fn(async () => file.handle);
  const backup: BackupDeps = {
    file: { store, showSaveFilePicker: opts.picker === false ? undefined : picker },
    storage: async () => opts.status ?? { persisted: "unknown", usage: null, quota: null },
  };
  const deps: SettingsDeps = {
    auth: { getSession: fake.auth.getSession, subscribe: fake.auth.subscribe, signOut: fake.auth.signOut, connectMail: vi.fn(async () => undefined), tokenSource: vi.fn(async () => "token") },
    createProvider: vi.fn() as unknown as SettingsDeps["createProvider"],
    getAddress: vi.fn(async () => "me@gmail.com"),
    download,
    downloadCsv,
    backup,
  };
  await render(h(SettingsView, { db, user: ada, params: {}, query: new URLSearchParams(), navigate: () => undefined, deps }));
  await waitFor(() => q("#appearance input[type=radio]"));
  return { db, download, downloadCsv, picker, store, file };
}

/** The text of an earlier backup file holding this many applications. */
const exportOf = (applications: number): string => JSON.stringify({ format: "jobtracker-export", version: 2, data: { applications: Array.from({ length: applications }, (_, i) => ({ id: i + 1 })) } });
const addApplication = (db: JobTrackerDB, company = "Acme") =>
  db.applications.add({ company, companyKey: company.toLowerCase(), role: "Engineer", roleKey: "engineer", stage: "Applied", stageAt: null, appliedAt: null, lastActivity: null, locked: false, manual: false });

const noticeText = () => q(".notice")?.textContent ?? "";
const statusText = () => q("#storage-status")?.textContent ?? "";

describe("storage status line", () => {
  it("says the browser will keep the data, and how much space it uses", async () => {
    await setup({ status: { persisted: "yes", usage: 2_300_000, quota: 1e10 } });
    await waitFor(() => statusText());
    expect(statusText()).toBe("Your browser will keep this data.Job Tracker uses 2.3 MB in this browser.");
  });

  it("warns and points to a backup when the browser may clear the data", async () => {
    await setup({ status: { persisted: "no", usage: 850_000, quota: 1e10 } });
    await waitFor(() => statusText());
    expect(statusText()).toContain("Your browser may clear this data if it runs low on space. Export a backup to be safe.");
    expect(statusText()).toContain("850 KB");
  });

  it("shows nothing when the browser says nothing", async () => {
    await setup();
    expect(q("#storage-status")).toBeNull();
  });
});

describe("export records the last backup", () => {
  it("Export data is a full backup and records the time", async () => {
    const { db, download } = await setup();
    expect(readBackupState(db.name).lastBackupAt).toBeNull();
    await click(byText("Export data")!);
    await waitFor(() => download.mock.calls.length === 1);
    const at = readBackupState(db.name).lastBackupAt;
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Math.abs(Date.now() - new Date(at!).getTime())).toBeLessThan(60_000);
  });

  it("Export CSV is not a backup and records nothing", async () => {
    const { db, downloadCsv } = await setup();
    await click(byText("Export CSV")!);
    await waitFor(() => downloadCsv.mock.calls.length === 1);
    expect(readBackupState(db.name).lastBackupAt).toBeNull();
  });

  it("a failed export records nothing", async () => {
    const { db, download } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    download.mockImplementation(() => { throw new Error("blocked"); });
    await click(byText("Export data")!);
    await waitFor(() => noticeText());
    expect(noticeText()).toBe("Couldn't export your data. Try again.");
    expect(readBackupState(db.name).lastBackupAt).toBeNull();
  });

  it("the backup time is not inside the export", async () => {
    const { db, download } = await setup();
    recordBackup(db.name, new Date("2026-01-01T10:00:00Z"));
    await click(byText("Export data")!);
    await waitFor(() => download.mock.calls.length === 1);
    expect(download.mock.calls[0][1]).not.toContain("lastBackupAt");
    expect(download.mock.calls[0][1]).not.toContain("2026-01-01T10:00:00Z");
  });

  it("Delete all my data forgets the reminder times and the chosen file", async () => {
    const { db, store } = await setup({ stored: true });
    recordBackup(db.name);
    await click(byText("Delete all my data")!);
    await click(byText("Delete everything")!);
    await waitFor(() => noticeText().startsWith("All your data was deleted"));
    expect(readBackupState(db.name)).toEqual({ lastBackupAt: null, snoozedAt: null });
    expect(store.map.size).toBe(0);
  });
});

describe("backup file", () => {
  it("is not offered when the browser has no file picker", async () => {
    await setup({ picker: false });
    expect(byText("Choose a backup file")).toBeNull();
    expect(byText("Back up now")).toBeNull();
  });

  it("choosing a file saves the first backup there and records it", async () => {
    const file = fakeHandle("jobs.json");
    const { db, picker, store } = await setup({ file });
    await db.applications.add({ company: "Acme", companyKey: "acme", role: "Engineer", roleKey: "engineer", stage: "Applied", stageAt: null, appliedAt: null, lastActivity: null, locked: false, manual: false });
    await click(byText("Choose a backup file")!);
    await waitFor(() => noticeText());
    expect(picker).toHaveBeenCalledTimes(1);
    expect(noticeText()).toBe("Backed up to jobs.json.");
    expect(JSON.parse(file.contents.text).data.applications).toHaveLength(1);
    expect(store.map.get(db.name)).toBe(file.handle);
    expect(readBackupState(db.name).lastBackupAt).not.toBeNull();
    expect(q("#backup-file-name")!.textContent).toBe("Backup file: jobs.json");
    expect(byText("Back up now")).not.toBeNull();
  });

  it("cancelling the picker changes nothing", async () => {
    const { db, picker, store } = await setup();
    picker.mockRejectedValueOnce(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    await click(byText("Choose a backup file")!);
    expect(noticeText()).toBe("");
    expect(store.map.size).toBe(0);
    expect(readBackupState(db.name).lastBackupAt).toBeNull();
  });

  it("Back up now writes to the same file again and records the time", async () => {
    const file = fakeHandle();
    const { db, picker } = await setup({ file, stored: true });
    await addApplication(db);
    await waitFor(() => byText("Back up now"));
    await click(byText("Back up now")!);
    await waitFor(() => noticeText());
    expect(noticeText()).toBe("Backed up to jobs-backup.json.");
    expect(file.contents.text).toContain('"format": "jobtracker-export"');
    expect(picker).not.toHaveBeenCalled();
    expect(readBackupState(db.name).lastBackupAt).not.toBeNull();
  });

  it("says so, and records nothing, when the file can't be written", async () => {
    const file = fakeHandle();
    file.handle.createWritable = async () => { throw new Error("gone"); };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = await setup({ file, stored: true });
    await addApplication(db);
    await waitFor(() => byText("Back up now"));
    await click(byText("Back up now")!);
    await waitFor(() => noticeText());
    expect(noticeText()).toBe("Couldn't write to jobs-backup.json. Choose the file again.");
    expect(q(".notice")!.className).toContain("err");
    expect(readBackupState(db.name).lastBackupAt).toBeNull();
  });

  it("Stop using this file forgets it and leaves the file alone", async () => {
    const file = fakeHandle();
    file.contents.text = "kept";
    const { store } = await setup({ file, stored: true });
    await waitFor(() => byText("Stop using this file"));
    await click(byText("Stop using this file")!);
    await waitFor(() => byText("Choose a backup file"));
    expect(store.map.size).toBe(0);
    expect(file.contents.text).toBe("kept");
  });
});

describe("a backup never replaces a good file with less", () => {
  const confirm = () => q(".inline-confirm");

  it("Choose a backup file on an empty database remembers the file but writes nothing, so the old backup survives", async () => {
    const file = fakeHandle("jobs.json", exportOf(40));
    const { db, store } = await setup({ file });
    await click(byText("Choose a backup file")!);
    await waitFor(() => noticeText());
    expect(noticeText()).toBe("There's nothing to back up yet, so jobs.json was left as it is.");
    expect(q(".notice")!.className).toContain("err");
    expect(file.contents.text).toBe(exportOf(40));
    expect(readBackupState(db.name).lastBackupAt).toBeNull();
    // the file is chosen, so a later Back up now (once there is something to save) goes there
    expect(store.map.get(db.name)).toBe(file.handle);
    expect(q("#backup-file-name")!.textContent).toBe("Backup file: jobs.json");
  });

  it("Back up now on an empty database (the state after Delete all my data) leaves the file as it is", async () => {
    const file = fakeHandle("jobs.json", exportOf(40));
    const { db } = await setup({ file, stored: true });
    await waitFor(() => byText("Back up now"));
    await click(byText("Back up now")!);
    await waitFor(() => noticeText());
    expect(noticeText()).toBe("There's nothing to back up yet, so jobs.json was left as it is.");
    expect(file.contents.text).toBe(exportOf(40));
    expect(readBackupState(db.name).lastBackupAt).toBeNull();
    expect(confirm()).toBeNull();
  });

  it("asks in place before replacing a file that holds more applications, and Cancel leaves it alone", async () => {
    const file = fakeHandle("jobs.json", exportOf(5));
    const { db } = await setup({ file, stored: true });
    await addApplication(db);
    await waitFor(() => byText("Back up now"));
    await click(byText("Back up now")!);
    await waitFor(() => confirm());
    expect(confirm()!.textContent).toContain("Replace the backup in jobs.json with one that has fewer applications?");
    expect(confirm()!.textContent).toContain("The file has 5 applications. This backup has 1. This can't be undone.");
    expect(file.contents.text).toBe(exportOf(5));
    expect(readBackupState(db.name).lastBackupAt).toBeNull();
    expect(document.activeElement).toBe(byText("Cancel", "button", confirm()!));
    await click(byText("Cancel", "button", confirm()!)!);
    expect(confirm()).toBeNull();
    expect(file.contents.text).toBe(exportOf(5));
    expect(document.activeElement).toBe(byText("Back up now"));
    expect(readBackupState(db.name).lastBackupAt).toBeNull();
  });

  it("writes the smaller backup once the person confirms, and says so", async () => {
    const file = fakeHandle("jobs.json", exportOf(5));
    const { db } = await setup({ file, stored: true });
    await addApplication(db);
    await waitFor(() => byText("Back up now"));
    await click(byText("Back up now")!);
    await waitFor(() => confirm());
    await click(byText("Replace the backup", "button", confirm()!)!);
    await waitFor(() => noticeText());
    expect(noticeText()).toBe("Backed up to jobs.json.");
    expect(confirm()).toBeNull();
    expect(JSON.parse(file.contents.text).data.applications).toHaveLength(1);
    expect(readBackupState(db.name).lastBackupAt).not.toBeNull();
  });

  it("asks the same question when the chosen file holds more applications, and doesn't write until it is answered", async () => {
    const file = fakeHandle("jobs.json", exportOf(5));
    const { db, store } = await setup({ file });
    await addApplication(db);
    await click(byText("Choose a backup file")!);
    await waitFor(() => confirm());
    expect(file.contents.text).toBe(exportOf(5));
    expect(store.map.get(db.name)).toBe(file.handle);
    await click(byText("Replace the backup", "button", confirm()!)!);
    await waitFor(() => noticeText());
    expect(noticeText()).toBe("Backed up to jobs.json.");
    expect(JSON.parse(file.contents.text).data.applications).toHaveLength(1);
  });

  it("doesn't ask when the backup is as large as the file", async () => {
    const file = fakeHandle("jobs.json", exportOf(1));
    const { db } = await setup({ file, stored: true });
    await addApplication(db);
    await waitFor(() => byText("Back up now"));
    await click(byText("Back up now")!);
    await waitFor(() => noticeText());
    expect(confirm()).toBeNull();
    expect(noticeText()).toBe("Backed up to jobs.json.");
  });

  it("says the data couldn't be read, not that the file is at fault, when the export fails, and leaves the file as it is", async () => {
    const file = fakeHandle("jobs.json", exportOf(5));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = await setup({ file, stored: true });
    await addApplication(db);
    vi.spyOn(db.accounts, "toArray").mockRejectedValue(new Error("db closed"));
    await waitFor(() => byText("Back up now"));
    await click(byText("Back up now")!);
    await waitFor(() => noticeText());
    expect(noticeText()).toBe("Couldn't read your data to back it up. Try again.");
    expect(file.contents.text).toBe(exportOf(5));
    expect(readBackupState(db.name).lastBackupAt).toBeNull();
  });
});


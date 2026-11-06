import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { BackupContent } from "../../src/backup/content";
import { backUpToFile, backupFileName, chooseBackupFile, forgetBackupFile, idbHandleStore, isFileBackupSupported, type FileBackupDeps, type FileHandleLike, type HandleStore } from "../../src/backup/fileBackup";

interface FakeFile {
  handle: FileHandleLike;
  /** what the file holds: only replaced when a write is closed, like a real writable */
  contents: { text: string };
  calls: string[];
}

/** A backup as the app makes one: the text and what is in it. Worth saving unless said otherwise. */
const content = (text: string, applications = 1, worthSaving = true): BackupContent => ({ text, applications, worthSaving });
/** The text of an earlier backup file with this many applications. */
const exportOf = (applications: number): string => JSON.stringify({ format: "jobtracker-export", version: 2, data: { applications: Array.from({ length: applications }, (_, i) => ({ id: i + 1 })) } });

interface FakeOptions {
  name?: string;
  permission?: "granted" | "prompt" | "denied";
  requestResult?: "granted" | "denied";
  failWrite?: boolean;
  failClose?: boolean;
  failAbort?: boolean;
  missing?: boolean;
  /** what the file holds to begin with */
  old?: string;
  /** reading the file fails */
  unreadable?: boolean;
  /** the handle has no getFile at all */
  noRead?: boolean;
}

function fakeFile(opts: FakeOptions = {}): FakeFile {
  const contents = { text: opts.old ?? "old backup" };
  const calls: string[] = [];
  let permission = opts.permission ?? "granted";
  const handle: FileHandleLike = {
    name: opts.name ?? "backup.json",
    queryPermission: async () => { calls.push("query"); return permission; },
    requestPermission: async () => { calls.push("request"); permission = opts.requestResult ?? "granted"; return permission; },
    getFile: opts.noRead ? undefined : async () => {
      calls.push("read");
      if (opts.unreadable) throw new Error("not readable");
      return { text: async () => contents.text };
    },
    createWritable: async () => {
      calls.push("create");
      if (opts.missing) throw Object.assign(new Error("gone"), { name: "NotFoundError" });
      let pending = "";
      return {
        write: async (data) => { if (opts.failWrite) throw new Error("disk full"); pending += data; },
        close: async () => { if (opts.failClose) throw new Error("close failed"); contents.text = pending; calls.push("close"); },
        abort: async () => { calls.push("abort"); if (opts.failAbort) throw new Error("abort failed"); },
      };
    },
  };
  return { handle, contents, calls };
}

function memoryStore(): HandleStore & { map: Map<string, FileHandleLike> } {
  const map = new Map<string, FileHandleLike>();
  return { map, get: async (k) => map.get(k) ?? null, put: async (k, h) => void map.set(k, h), delete: async (k) => void map.delete(k) };
}

const withFile = (file: FakeFile, store = memoryStore()): { deps: FileBackupDeps; store: ReturnType<typeof memoryStore> } => {
  store.map.set("acct", file.handle);
  return { deps: { store, showSaveFilePicker: async () => file.handle }, store };
};

describe("support", () => {
  it("is offered only where the browser has the file picker", () => {
    expect(isFileBackupSupported({ store: memoryStore() })).toBe(false);
    expect(isFileBackupSupported({ store: memoryStore(), showSaveFilePicker: async () => fakeFile().handle })).toBe(true);
  });

  it("does nothing, and doesn't throw, without the picker", async () => {
    expect(await chooseBackupFile("acct", "x.json", { store: memoryStore() })).toBeNull();
  });
});

describe("chooseBackupFile", () => {
  it("remembers the chosen file for that account and returns its name", async () => {
    const file = fakeFile({ name: "my-jobs.json" });
    const store = memoryStore();
    const picker = vi.fn(async () => file.handle);
    expect(await chooseBackupFile("acct", "job-tracker-2026-11-05.json", { store, showSaveFilePicker: picker })).toBe("my-jobs.json");
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: "job-tracker-2026-11-05.json" }));
    expect(await backupFileName("acct", { store })).toBe("my-jobs.json");
    expect(await backupFileName("someone-else", { store })).toBeNull();
  });

  it("returns null and stores nothing when the person cancels the picker", async () => {
    const store = memoryStore();
    const cancel = async () => { throw Object.assign(new Error("cancelled"), { name: "AbortError" }); };
    expect(await chooseBackupFile("acct", "x.json", { store, showSaveFilePicker: cancel })).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it("lets a real failure through, so it can be reported", async () => {
    const boom = async () => { throw new Error("blocked"); };
    await expect(chooseBackupFile("acct", "x.json", { store: memoryStore(), showSaveFilePicker: boom })).rejects.toThrow("blocked");
  });
});

describe("backUpToFile", () => {
  it("writes the export into the chosen file", async () => {
    const file = fakeFile();
    const { deps } = withFile(file);
    expect(await backUpToFile("acct", async () => content('{"new":true}'), deps)).toEqual({ status: "written", name: "backup.json" });
    expect(file.contents.text).toBe('{"new":true}');
  });

  it("says there is no file when none was chosen", async () => {
    expect(await backUpToFile("acct", async () => content("x"), { store: memoryStore() })).toEqual({ status: "no-file" });
  });

  it("asks again for permission when the browser forgot it, before it builds the export", async () => {
    const file = fakeFile({ permission: "prompt" });
    const { deps } = withFile(file);
    const makeText = vi.fn(async () => {
      expect(file.calls).toEqual(["query", "request"]);
      return content("data");
    });
    expect((await backUpToFile("acct", makeText, deps)).status).toBe("written");
    expect(makeText).toHaveBeenCalledTimes(1);
  });

  it("doesn't ask when permission is already granted", async () => {
    const file = fakeFile();
    await backUpToFile("acct", async () => content("x"), withFile(file).deps);
    expect(file.calls).not.toContain("request");
  });

  it("leaves the file alone when the person says no", async () => {
    const file = fakeFile({ permission: "prompt", requestResult: "denied" });
    const makeText = vi.fn(async () => content("new"));
    expect(await backUpToFile("acct", makeText, withFile(file).deps)).toEqual({ status: "permission-denied", name: "backup.json" });
    expect(makeText).not.toHaveBeenCalled();
    expect(file.calls).not.toContain("create");
    expect(file.contents.text).toBe("old backup");
  });

  it("keeps the previous backup and aborts the writer when the write fails part-way", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const file = fakeFile({ failWrite: true });
    expect(await backUpToFile("acct", async () => content("new"), withFile(file).deps)).toEqual({ status: "failed", name: "backup.json" });
    expect(file.contents.text).toBe("old backup");
    expect(file.calls).toContain("abort");
    expect(logged).toHaveBeenCalled();
  });

  it("reports a failed close as a failure, not a success", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const file = fakeFile({ failClose: true });
    expect((await backUpToFile("acct", async () => content("new"), withFile(file).deps)).status).toBe("failed");
    expect(file.contents.text).toBe("old backup");
  });

  it("reports a file that was moved or deleted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await backUpToFile("acct", async () => content("new"), withFile(fakeFile({ missing: true })).deps)).status).toBe("failed");
  });

  it("reports an export that can't be built as that, not as a problem with the file, without touching the file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const file = fakeFile();
    expect(await backUpToFile("acct", async () => { throw new Error("db closed"); }, withFile(file).deps)).toEqual({ status: "export-failed", name: "backup.json" });
    expect(file.calls).not.toContain("create");
    expect(file.contents.text).toBe("old backup");
  });

  it("works for a handle with no permission methods (the browser grants it with the picker)", async () => {
    const file = fakeFile();
    delete file.handle.queryPermission;
    delete file.handle.requestPermission;
    expect((await backUpToFile("acct", async () => content("x"), withFile(file).deps)).status).toBe("written");
  });
});

describe("a backup never replaces a good file with less", () => {
  const spyLog = () => vi.spyOn(console, "error").mockImplementation(() => undefined);

  it("writes nothing for a database with nothing worth saving, and doesn't even open the file for writing", async () => {
    const file = fakeFile({ old: exportOf(40) });
    const empty = content("EMPTY EXPORT", 0, false);
    expect(await backUpToFile("acct", async () => empty, withFile(file).deps)).toEqual({ status: "nothing-to-back-up", name: "backup.json" });
    expect(file.contents.text).toBe(exportOf(40));
    expect(file.calls).not.toContain("create");
  });

  it("refuses an empty backup even when the person has agreed to a smaller one", async () => {
    const file = fakeFile({ old: exportOf(40) });
    const result = await backUpToFile("acct", async () => content("EMPTY EXPORT", 0, false), withFile(file).deps, { replaceLarger: true });
    expect(result.status).toBe("nothing-to-back-up");
    expect(file.contents.text).toBe(exportOf(40));
  });

  it("writes a backup with no applications when something else is worth saving, if the file holds nothing larger", async () => {
    const file = fakeFile({ old: exportOf(0) });
    expect((await backUpToFile("acct", async () => content("RULES ONLY", 0, true), withFile(file).deps)).status).toBe("written");
    expect(file.contents.text).toBe("RULES ONLY");
  });

  it("asks first when the file holds more applications, and leaves it alone", async () => {
    const file = fakeFile({ old: exportOf(5) });
    expect(await backUpToFile("acct", async () => content("SMALL", 2), withFile(file).deps)).toEqual({ status: "would-shrink", name: "backup.json", inFile: 5, inBackup: 2 });
    expect(file.contents.text).toBe(exportOf(5));
    expect(file.calls).not.toContain("create");
  });

  it("asks first when the backup has applications but the file holds more, even one more", async () => {
    const file = fakeFile({ old: exportOf(3) });
    expect((await backUpToFile("acct", async () => content("SMALL", 2), withFile(file).deps)).status).toBe("would-shrink");
  });

  it("replaces the smaller file once the person has agreed", async () => {
    const file = fakeFile({ old: exportOf(5) });
    expect(await backUpToFile("acct", async () => content("SMALL", 2), withFile(file).deps, { replaceLarger: true })).toEqual({ status: "written", name: "backup.json" });
    expect(file.contents.text).toBe("SMALL");
  });

  it.each([[2, 2], [2, 5], [0, 1]])("just writes when the file holds %i applications and the backup %i", async (inFile, inBackup) => {
    const file = fakeFile({ old: exportOf(inFile) });
    expect((await backUpToFile("acct", async () => content("NEXT", inBackup), withFile(file).deps)).status).toBe("written");
    expect(file.contents.text).toBe("NEXT");
  });

  it.each([
    ["an empty file", { old: "" }],
    ["a file that isn't a Job Tracker export", { old: '{"hello":"world"}' }],
    ["text that isn't JSON", { old: "my notes" }],
    ["a file that can't be read", { old: exportOf(9), unreadable: true }],
    ["a handle that can't read at all", { old: exportOf(9), noRead: true }],
  ] as [string, FakeOptions][])("doesn't judge %s, and writes", async (_name, opts) => {
    spyLog();
    const file = fakeFile(opts);
    expect((await backUpToFile("acct", async () => content("NEXT", 1), withFile(file).deps)).status).toBe("written");
    expect(file.contents.text).toBe("NEXT");
  });

  it("reads the file only after write access is confirmed", async () => {
    const file = fakeFile({ permission: "prompt", requestResult: "denied", old: exportOf(9) });
    await backUpToFile("acct", async () => content("NEXT"), withFile(file).deps);
    expect(file.calls).toEqual(["query", "request"]);
  });

  describe("the old file is never truncated before the new text is written and closed", () => {
    it("builds the whole text before it opens the writer", async () => {
      const file = fakeFile();
      const order: string[] = [];
      const make = async () => { order.push(`make after ${file.calls.join(",")}`); return content("NEXT"); };
      await backUpToFile("acct", make, withFile(file).deps);
      expect(order).toEqual(["make after query"]);
      expect(file.calls.indexOf("create")).toBeGreaterThan(file.calls.indexOf("read"));
    });

    it("keeps the old file when the write fails, and aborts the writer", async () => {
      spyLog();
      const file = fakeFile({ failWrite: true, old: exportOf(3) });
      expect((await backUpToFile("acct", async () => content("NEXT", 3), withFile(file).deps)).status).toBe("failed");
      expect(file.contents.text).toBe(exportOf(3));
      expect(file.calls).toContain("abort");
      expect(file.calls).not.toContain("close");
    });

    it("keeps the old file when the close fails, and aborts the writer", async () => {
      spyLog();
      const file = fakeFile({ failClose: true, old: exportOf(3) });
      expect((await backUpToFile("acct", async () => content("NEXT", 3), withFile(file).deps)).status).toBe("failed");
      expect(file.contents.text).toBe(exportOf(3));
      expect(file.calls).toContain("abort");
    });

    it("still reports a failure, with the old file intact, when abort itself fails", async () => {
      spyLog();
      const file = fakeFile({ failWrite: true, failAbort: true, old: exportOf(3) });
      expect(await backUpToFile("acct", async () => content("NEXT", 3), withFile(file).deps)).toEqual({ status: "failed", name: "backup.json" });
      expect(file.contents.text).toBe(exportOf(3));
    });

    it("never calls createWritable with keepExistingData or any option, so the browser writes a separate copy and swaps it in on close", async () => {
      const file = fakeFile();
      const create = vi.spyOn(file.handle, "createWritable");
      await backUpToFile("acct", async () => content("NEXT"), withFile(file).deps);
      expect(create).toHaveBeenCalledWith();
    });
  });
});

describe("forgetBackupFile", () => {
  it("stops using the file", async () => {
    const { deps, store } = withFile(fakeFile());
    await forgetBackupFile("acct", deps);
    expect(store.map.size).toBe(0);
    expect(await backupFileName("acct", deps)).toBeNull();
  });
});

describe("the IndexedDB handle store", () => {
  // A real handle is structured-cloneable; a plain object stands in for one here.
  const handle = { name: "backup.json" } as unknown as FileHandleLike;

  it("keeps a handle per account, in a database of its own", async () => {
    await idbHandleStore.put("acct-1", handle);
    expect(await idbHandleStore.get("acct-1")).toEqual({ name: "backup.json" });
    expect(await idbHandleStore.get("acct-2")).toBeNull();
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).toContain("jobtracker-backup-files");
    await idbHandleStore.delete("acct-1");
    expect(await idbHandleStore.get("acct-1")).toBeNull();
  });
});

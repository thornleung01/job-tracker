import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatBytes } from "../../src/backup/format";
import { describeStorage, requestPersistence, resetPersistAsked, storageStatus, type StorageManagerLike } from "../../src/backup/storage";

beforeEach(() => resetPersistAsked());

const manager = (over: Partial<StorageManagerLike> = {}): StorageManagerLike & { persist: ReturnType<typeof vi.fn> } =>
  ({ persist: vi.fn(async () => true), persisted: vi.fn(async () => false), estimate: vi.fn(async () => ({ usage: 2_300_000, quota: 10_000_000_000 })), ...over }) as never;

describe("requestPersistence", () => {
  it("asks once per session, however many times it is called", async () => {
    const m = manager();
    expect(await requestPersistence(true, m)).toBe(true);
    expect(await requestPersistence(true, m)).toBe(false);
    expect(await requestPersistence(true, m)).toBe(false);
    expect(m.persist).toHaveBeenCalledTimes(1);
  });

  it("does not count as the session's one ask while the database is empty", async () => {
    const m = manager();
    expect(await requestPersistence(false, m)).toBe(false);
    expect(m.persist).not.toHaveBeenCalled();
    expect(await requestPersistence(true, m)).toBe(true);
    expect(m.persist).toHaveBeenCalledTimes(1);
  });

  it("remembers across a reload of the same tab (session storage) but not across tabs", async () => {
    await requestPersistence(true, manager());
    resetPersistAsked(); // a reload: the page's memory is gone, session storage stays
    const again = manager();
    expect(await requestPersistence(true, again)).toBe(false);
    expect(again.persist).not.toHaveBeenCalled();
    sessionStorage.clear(); // a new tab
    resetPersistAsked();
    expect(await requestPersistence(true, again)).toBe(true);
  });

  it("doesn't ask when the browser already keeps the data", async () => {
    const m = manager({ persisted: vi.fn(async () => true) });
    expect(await requestPersistence(true, m)).toBe(false);
    expect(m.persist).not.toHaveBeenCalled();
  });

  it("does nothing, and doesn't throw, without the API or when it fails", async () => {
    expect(await requestPersistence(true, undefined)).toBe(false);
    expect(await requestPersistence(true, {})).toBe(false);
    const broken = manager({ persist: vi.fn(async () => { throw new Error("denied"); }) });
    expect(await requestPersistence(true, broken)).toBe(false);
  });
});

describe("storageStatus", () => {
  it("reports persisted, usage and quota", async () => {
    expect(await storageStatus(manager({ persisted: vi.fn(async () => true) }))).toEqual({ persisted: "yes", usage: 2_300_000, quota: 10_000_000_000 });
    expect(await storageStatus(manager())).toMatchObject({ persisted: "no" });
  });

  it("says unknown, with no sizes, when the browser can't tell", async () => {
    expect(await storageStatus(undefined)).toEqual({ persisted: "unknown", usage: null, quota: null });
    expect(await storageStatus({})).toEqual({ persisted: "unknown", usage: null, quota: null });
    const failing = { persisted: async () => { throw new Error("x"); }, estimate: async () => { throw new Error("x"); } };
    expect(await storageStatus(failing)).toEqual({ persisted: "unknown", usage: null, quota: null });
  });
});

describe("describeStorage", () => {
  it("says the browser will keep the data", () => {
    expect(describeStorage({ persisted: "yes", usage: 2_300_000, quota: 1 })).toEqual(["Your browser will keep this data.", "Job Tracker uses 2.3 MB in this browser."]);
  });
  it("warns, and points to a backup, when the browser may clear it", () => {
    expect(describeStorage({ persisted: "no", usage: 850_000, quota: 1 })).toEqual([
      "Your browser may clear this data if it runs low on space. Export a backup to be safe.",
      "Job Tracker uses 850 KB in this browser.",
    ]);
  });
  it("makes no promise when it is unknown, and says nothing when it knows nothing", () => {
    expect(describeStorage({ persisted: "unknown", usage: 1500, quota: null })).toEqual(["Job Tracker uses 1.5 KB in this browser."]);
    expect(describeStorage({ persisted: "unknown", usage: null, quota: null })).toEqual([]);
  });
});

describe("formatBytes", () => {
  it("uses short decimal units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1000)).toBe("1.0 KB");
    expect(formatBytes(12_345)).toBe("12 KB");
    expect(formatBytes(2_300_000)).toBe("2.3 MB");
    expect(formatBytes(5_000_000_000)).toBe("5.0 GB");
    expect(formatBytes(-1)).toBe("0 B");
  });
});

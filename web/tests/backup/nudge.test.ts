import "fake-indexeddb/auto";
import { act, createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupGuard } from "../../src/backup/BackupGuard";
import { BackupNudge } from "../../src/backup/BackupNudge";
import { resetPersistAsked, type StorageManagerLike } from "../../src/backup/storage";
import { readBackupState, recordBackup, snoozeNudge } from "../../src/backup/state";
import { SNOOZE_DAYS } from "../../src/backup/schedule";
import { DAY_MS } from "../../src/db/time";
import type { JobTrackerDB } from "../../src/db/schema";
import { isSyncing, tryAcquire } from "../../src/sync/syncLock";
import { byText, cleanupRendered, click, closeDbs, freshDb, q, render, settle, waitFor } from "../app/helpers";

const NOW = new Date("2026-11-05T15:30:00Z");
const clock = (at: Date = NOW) => () => at;

afterEach(() => {
  cleanupRendered();
  closeDbs();
  resetPersistAsked();
});

async function withApplications(db: JobTrackerDB, n: number) {
  await db.applications.bulkAdd(
    Array.from({ length: n }, (_, i) => ({
      company: `Acme ${i}`, companyKey: `acme${i}`, role: "Engineer", roleKey: "engineer", stage: "Applied" as const,
      stageAt: null, appliedAt: null, lastActivity: null, locked: false, manual: false,
    })),
  );
}

const nudge = () => q(".backup-nudge");
const shown = () => waitFor(nudge);

describe("backup nudge", () => {
  it("says the data only lives in this browser and that there has been no backup", async () => {
    const db = freshDb();
    await withApplications(db, 1);
    await render(h(BackupNudge, { db, now: clock() }));
    await shown();
    expect(nudge()!.textContent).toBe("Your applications only live in this browser. Last backup: never.Export a backupRemind me in a week");
  });

  it("says how long ago the last backup was once it is more than 14 days old", async () => {
    const db = freshDb();
    await withApplications(db, 1);
    recordBackup(db.name, new Date(NOW.getTime() - 20 * DAY_MS));
    await render(h(BackupNudge, { db, now: clock() }));
    await shown();
    expect(nudge()!.textContent).toContain("Last backup: 20 days ago.");
  });

  it("stays hidden in an empty database", async () => {
    const db = freshDb();
    await render(h(BackupNudge, { db, now: clock() }));
    await settle(30);
    expect(nudge()).toBeNull();
  });

  it("counts an application in Recently deleted: it is still in the database and the backup, so it is worth one", async () => {
    const db = freshDb();
    await withApplications(db, 1);
    await db.applications.toCollection().modify({ deletedAt: "2026-11-01T10:00:00Z" });
    await render(h(BackupNudge, { db, now: clock() }));
    await shown();
  });

  it("stays hidden once the last application is erased for good", async () => {
    const db = freshDb();
    await withApplications(db, 1);
    await db.applications.toCollection().modify({ deletedAt: "2026-11-01T10:00:00Z" });
    await render(h(BackupNudge, { db, now: clock() }));
    await shown();
    await act(async () => { await db.applications.clear(); });
    await settle(30);
    expect(nudge()).toBeNull();
  });

  it("stays hidden after a recent backup", async () => {
    const db = freshDb();
    await withApplications(db, 1);
    recordBackup(db.name, new Date(NOW.getTime() - 3 * DAY_MS));
    await render(h(BackupNudge, { db, now: clock() }));
    await settle(30);
    expect(nudge()).toBeNull();
  });

  it("stays hidden while a sync runs and appears when it ends", async () => {
    const db = freshDb();
    await withApplications(db, 1);
    const release = tryAcquire()!;
    try {
      await render(h(BackupNudge, { db, now: clock() }));
      await settle(30);
      expect(isSyncing()).toBe(true);
      expect(nudge()).toBeNull();
    } finally {
      release();
    }
    await waitFor(nudge, 3000);
  });

  it("snoozes for a week, and the snooze survives a reload", async () => {
    const db = freshDb();
    await withApplications(db, 1);
    const first = await render(h(BackupNudge, { db, now: clock() }));
    await shown();
    await click(byText("Remind me in a week")!);
    expect(nudge()).toBeNull();
    expect(readBackupState(db.name).snoozedAt).toBe("2026-11-05T15:30:00Z");

    first.unmount(); // a reload: new component, same storage
    await render(h(BackupNudge, { db, now: clock(new Date(NOW.getTime() + 2 * DAY_MS)) }));
    await settle(30);
    expect(nudge()).toBeNull();

    cleanupRendered();
    await render(h(BackupNudge, { db, now: clock(new Date(NOW.getTime() + SNOOZE_DAYS * DAY_MS)) }));
    await waitFor(nudge);
  });

  it("goes away when a backup is made elsewhere in the app", async () => {
    const db = freshDb();
    await withApplications(db, 1);
    await render(h(BackupNudge, { db, now: clock() }));
    await shown();
    await act(async () => recordBackup(db.name, NOW));
    await settle(30);
    expect(nudge()).toBeNull();
  });

  it("goes to Settings > Your data from the Export a backup link", async () => {
    const db = freshDb();
    await withApplications(db, 1);
    window.location.hash = "#/";
    await render(h(BackupNudge, { db, now: clock() }));
    await shown();
    await click(byText("Export a backup")!);
    expect(window.location.hash).toBe("#/settings");
  });

  it("keeps each account's snooze apart", async () => {
    const a = freshDb();
    const b = freshDb();
    await withApplications(a, 1);
    await withApplications(b, 1);
    snoozeNudge(a.name, NOW);
    await render(h(BackupNudge, { db: b, now: clock() }));
    await shown();
  });
});

describe("backup guard", () => {
  const storage = (): StorageManagerLike & { persist: ReturnType<typeof vi.fn> } => ({ persist: vi.fn(async () => true), persisted: vi.fn(async () => false) });

  it("asks the browser to keep the data once there is data, whatever the page", async () => {
    const db = freshDb();
    await withApplications(db, 1);
    const s = storage();
    await render(h(BackupGuard, { db, page: "settings", storage: s }));
    await waitFor(() => s.persist.mock.calls.length === 1);
    expect(nudge()).toBeNull();
  });

  it("asks when the only application is in Recently deleted: it can be restored, so there is something to lose", async () => {
    const db = freshDb();
    await withApplications(db, 1);
    await db.applications.toCollection().modify({ deletedAt: "2026-11-01T10:00:00Z" });
    const s = storage();
    await render(h(BackupGuard, { db, page: "settings", storage: s }));
    await waitFor(() => s.persist.mock.calls.length === 1);
  });

  it("doesn't ask while the database is empty, and asks as soon as data arrives", async () => {
    const db = freshDb();
    const s = storage();
    await render(h(BackupGuard, { db, page: "applications", storage: s }));
    await settle(30);
    expect(s.persist).not.toHaveBeenCalled();
    await withApplications(db, 1);
    await waitFor(() => s.persist.mock.calls.length === 1);
  });

  it("asks once even as the page changes and the data changes", async () => {
    const db = freshDb();
    await withApplications(db, 1);
    const s = storage();
    const view = await render(h(BackupGuard, { db, page: "applications", storage: s }));
    await waitFor(() => s.persist.mock.calls.length === 1);
    await view.rerender(h(BackupGuard, { db, page: "people", storage: s }));
    await withApplications(db, 1);
    await settle(30);
    expect(s.persist).toHaveBeenCalledTimes(1);
  });

  it("shows the nudge only on the Applications page", async () => {
    const db = freshDb();
    await withApplications(db, 1);
    const s = storage();
    const view = await render(h(BackupGuard, { db, page: "applications", storage: s }));
    await waitFor(nudge);
    await view.rerender(h(BackupGuard, { db, page: "people", storage: s }));
    expect(nudge()).toBeNull();
  });
});

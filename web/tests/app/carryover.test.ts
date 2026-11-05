import "fake-indexeddb/auto";
import { createElement as h } from "react";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_DB_NAME } from "../../src/config";
import { openDatabase, type JobTrackerDB } from "../../src/db/schema";
import { bringOverLocalData, DONE_KEY, localApplicationCount, NothingToBringOverError, removeLocalCopy, TargetNotEmptyError } from "../../src/app/carryOver";
import { DISMISS_KEY, LocalDataOffer } from "../../src/app/LocalDataOffer";
import { importAll } from "../../src/portability";
import { upsertAccount } from "../../src/db/repo";
import { addNote } from "../../src/sync/activity";
import { addApp, addMail } from "../pages/applications/harness";
import { byText, cleanupRendered, click, closeDbs, freshDb, q, render, settle, waitFor } from "./helpers";

/** The local database as the demo-mode app leaves it: one account, two applications, one email and one note. */
async function seedLocal(): Promise<void> {
  const local = openDatabase(LOCAL_DB_NAME);
  try {
    const account = await upsertAccount(local, "gmail", "me@gmail.com");
    const acme = await addApp(local, "Acme");
    await addApp(local, "Globex", { stage: "Interview" });
    await addMail(local, account, acme);
    await addNote(local, acme, "Referred by Sam");
  } finally {
    local.close();
  }
}

const localExists = () => Dexie.exists(LOCAL_DB_NAME);
const localNames = async () => (await indexedDB.databases()).map((d) => d.name);

async function localCounts() {
  const local = openDatabase(LOCAL_DB_NAME);
  try {
    return { applications: await local.applications.count(), emails: await local.emails.count(), activity: await local.activity.count() };
  } finally {
    local.close();
  }
}

beforeEach(async () => {
  window.sessionStorage.clear();
  window.localStorage.removeItem(DONE_KEY);
  await Dexie.delete(LOCAL_DB_NAME);
});
afterEach(async () => {
  cleanupRendered();
  closeDbs();
  vi.restoreAllMocks();
  await Dexie.delete(LOCAL_DB_NAME);
});

describe("localApplicationCount", () => {
  it("is 0 and does not create the local database when there is none", async () => {
    expect(await localApplicationCount()).toBe(0);
    expect(await localNames()).not.toContain(LOCAL_DB_NAME);
    expect(await localExists()).toBe(false);
  });

  it("counts the applications through the injected open function and closes the handle", async () => {
    await seedLocal();
    const opened: JobTrackerDB[] = [];
    const open = vi.fn((name: string) => {
      const db = openDatabase(name);
      opened.push(db);
      return db;
    });
    expect(await localApplicationCount(open)).toBe(2);
    expect(open).toHaveBeenCalledWith(LOCAL_DB_NAME);
    expect(opened[0]!.isOpen()).toBe(false);
  });
});

describe("bringOverLocalData and removeLocalCopy", () => {
  it("copies applications, emails and activity, and leaves the local database as it was", async () => {
    await seedLocal();
    const target = freshDb();
    const before = await localCounts();
    expect(await bringOverLocalData(target)).toBe(2);
    expect(await target.applications.count()).toBe(2);
    expect(await target.emails.count()).toBe(1);
    expect(await target.activity.count()).toBeGreaterThan(0);
    expect(await localCounts()).toEqual(before);
  });

  it("refuses when the target has applications, and changes nothing", async () => {
    await seedLocal();
    const target = freshDb();
    await addApp(target, "Initech");
    await expect(bringOverLocalData(target)).rejects.toBeInstanceOf(TargetNotEmptyError);
    expect((await target.applications.toArray()).map((a) => a.company)).toEqual(["Initech"]);
  });

  it("refuses when the target has any data at all, not only applications, and changes nothing", async () => {
    await seedLocal();
    const withSettings = freshDb();
    await withSettings.settings.put({ key: "theme", value: "dark" });
    await expect(bringOverLocalData(withSettings)).rejects.toBeInstanceOf(TargetNotEmptyError);
    expect(await withSettings.settings.toArray()).toEqual([{ key: "theme", value: "dark" }]);
    expect(await withSettings.applications.count()).toBe(0);

    const withAccount = freshDb();
    await upsertAccount(withAccount, "outlook", "me@outlook.com");
    await expect(bringOverLocalData(withAccount)).rejects.toBeInstanceOf(TargetNotEmptyError);
    expect(await withAccount.accounts.count()).toBe(1);
    expect(await withAccount.applications.count()).toBe(0);
    expect(window.localStorage.getItem(DONE_KEY)).toBeNull();
  });

  it("checks that the target is empty inside the import transaction, so a row written just before it is not wiped", async () => {
    await seedLocal();
    const target = freshDb();
    await target.open();
    const real = target.transaction.bind(target) as (...a: unknown[]) => Promise<unknown>;
    vi.spyOn(target, "transaction").mockImplementation((async (...args: unknown[]) => {
      await target.settings.put({ key: "late", value: 1 }); // lands after any earlier check, before the import runs
      return real(...args);
    }) as never);
    await expect(bringOverLocalData(target)).rejects.toBeInstanceOf(TargetNotEmptyError);
    expect(await target.settings.toArray()).toEqual([{ key: "late", value: 1 }]);
    expect(await target.applications.count()).toBe(0);
    expect(window.localStorage.getItem(DONE_KEY)).toBeNull();
  });

  it("throws when the local database vanished, and does not create it again", async () => {
    await seedLocal();
    await removeLocalCopy();
    const open = vi.fn(openDatabase);
    const target = freshDb();
    await expect(bringOverLocalData(target, open)).rejects.toBeInstanceOf(NothingToBringOverError);
    expect(open).not.toHaveBeenCalled();
    expect(await localExists()).toBe(false);
    expect(await localNames()).not.toContain(LOCAL_DB_NAME);
    expect(await target.applications.count()).toBe(0);
  });

  it("refuses an earlier copy with no applications, and changes nothing", async () => {
    const local = openDatabase(LOCAL_DB_NAME);
    await upsertAccount(local, "gmail", "me@gmail.com");
    local.close();
    const target = freshDb();
    await expect(bringOverLocalData(target)).rejects.toBeInstanceOf(NothingToBringOverError);
    expect(await target.accounts.count()).toBe(0);
    expect(window.localStorage.getItem(DONE_KEY)).toBeNull();
  });

  it("records that a bring-over worked only after it succeeds", async () => {
    await seedLocal();
    expect(window.localStorage.getItem(DONE_KEY)).toBeNull();
    await bringOverLocalData(freshDb());
    expect(window.localStorage.getItem(DONE_KEY)).toBe("1");
  });

  it("importAll still replaces everything (Settings > Import is unchanged)", async () => {
    await seedLocal();
    const local = openDatabase(LOCAL_DB_NAME);
    const { exportAll } = await import("../../src/portability");
    const envelope = await exportAll(local);
    local.close();
    const target = freshDb();
    await addApp(target, "Initech");
    await importAll(target, envelope);
    expect((await target.applications.toArray()).map((a) => a.company).sort()).toEqual(["Acme", "Globex"]);
  });

  it("removes the local database", async () => {
    await seedLocal();
    expect(await localExists()).toBe(true);
    await removeLocalCopy();
    expect(await localExists()).toBe(false);
  });
});

const offerText = () => document.querySelector(".carryover")?.textContent ?? "";

describe("LocalDataOffer", () => {
  it("shows nothing, calls onResolved once and never creates the local database when there is no local copy", async () => {
    const db = freshDb();
    const onResolved = vi.fn();
    const view = await render(h(LocalDataOffer, { db, onResolved }));
    await waitFor(() => onResolved.mock.calls.length === 1);
    await settle(50);
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toBe("");
    expect(await localNames()).not.toContain(LOCAL_DB_NAME);
  });

  it("shows nothing when the account already has data", async () => {
    await seedLocal();
    const db = freshDb();
    await addApp(db, "Initech");
    const onResolved = vi.fn();
    const view = await render(h(LocalDataOffer, { db, onResolved }));
    await waitFor(() => onResolved.mock.calls.length === 1);
    await settle(50);
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toBe("");
    expect(await db.applications.count()).toBe(1);
  });

  it("does not offer again after Not now in the same session", async () => {
    await seedLocal();
    const db = freshDb();
    const onResolved = vi.fn();
    await render(h(LocalDataOffer, { db, onResolved }));
    await waitFor(() => byText("Not now"));
    expect(onResolved).not.toHaveBeenCalled();
    await click(byText("Not now")!);
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(q(".carryover")).toBeNull();
    expect(window.sessionStorage.getItem(DISMISS_KEY)).toBe("1");
    expect(await db.applications.count()).toBe(0);

    cleanupRendered();
    const again = vi.fn();
    const view = await render(h(LocalDataOffer, { db, onResolved: again }));
    await waitFor(() => again.mock.calls.length === 1);
    await settle(50);
    expect(again).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toBe("");
  });

  it("offers with the right count and copies nothing until asked", async () => {
    await seedLocal();
    const db = freshDb();
    const onResolved = vi.fn();
    await render(h(LocalDataOffer, { db, onResolved }));
    await waitFor(() => byText("Bring them over"));
    expect(offerText()).toContain("You have 2 applications saved in this browser from before you logged in.");
    const row = q(".carryover")!;
    expect(row.getAttribute("role")).toBe("group");
    expect(row.getAttribute("aria-label")).toBe("Earlier copy");
    expect(row.querySelector("[role=status]")).toBeNull();
    await settle(100);
    expect(await db.applications.count()).toBe(0);
    expect(await db.emails.count()).toBe(0);
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("says application, not applications, for one", async () => {
    const local = openDatabase(LOCAL_DB_NAME);
    await addApp(local, "Acme");
    local.close();
    await render(h(LocalDataOffer, { db: freshDb(), onResolved: vi.fn() }));
    await waitFor(() => byText("Bring them over"));
    expect(offerText()).toContain("You have 1 application saved");
  });

  it("does not call onResolved before the checks finish", async () => {
    await seedLocal();
    const db = freshDb();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = db.transaction.bind(db) as (...a: unknown[]) => Promise<unknown>;
    vi.spyOn(db, "transaction").mockImplementation(((...args: unknown[]) => gate.then(() => real(...args))) as never);
    const onResolved = vi.fn();
    const view = await render(h(LocalDataOffer, { db, onResolved }));
    await settle(50);
    expect(onResolved).not.toHaveBeenCalled();
    expect(view.container.textContent).toBe("");
    release();
    await waitFor(() => byText("Bring them over"));
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("brings the data over on click, keeps the earlier copy and calls onResolved once", async () => {
    await seedLocal();
    const db = freshDb();
    const onResolved = vi.fn();
    await render(h(LocalDataOffer, { db, onResolved }));
    await click((await waitFor(() => byText("Bring them over")))!);
    await waitFor(() => offerText().includes("Brought over 2 applications. The earlier copy is still in this browser."));
    expect(await db.applications.count()).toBe(2);
    expect(await db.emails.count()).toBe(1);
    expect(await db.activity.count()).toBeGreaterThan(0);
    expect((await localCounts()).applications).toBe(2);
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(q(".carryover .notice")?.getAttribute("role")).toBe("status");
  });

  it("asks before removing: Cancel keeps the copy, Remove it deletes it", async () => {
    await seedLocal();
    const db = freshDb();
    const onResolved = vi.fn();
    await render(h(LocalDataOffer, { db, onResolved }));
    await click((await waitFor(() => byText("Bring them over")))!);
    await click((await waitFor(() => byText("Remove the earlier copy")))!);

    // the question is open, nothing is deleted yet, and Cancel has focus
    const cancel = await waitFor(() => byText("Cancel"));
    expect(document.activeElement).toBe(cancel);
    expect(offerText()).toContain("Remove the earlier copy?");
    expect(await localExists()).toBe(true);

    await click(cancel);
    expect(byText("Cancel")).toBeNull();
    expect(await localExists()).toBe(true);
    const opener = byText("Remove the earlier copy")!;
    expect(document.activeElement).toBe(opener);

    await click(opener);
    await click((await waitFor(() => byText("Remove it")))!);
    await waitFor(() => offerText().includes("Removed the earlier copy."));
    expect(await localExists()).toBe(false);
    expect(await db.applications.count()).toBe(2);
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it("shows an error and still calls onResolved once when the account gained data after the offer", async () => {
    await seedLocal();
    const db = freshDb();
    const onResolved = vi.fn();
    await render(h(LocalDataOffer, { db, onResolved }));
    const bring = await waitFor(() => byText("Bring them over"));
    await addApp(db, "Initech");
    await click(bring);
    await waitFor(() => q('.carryover [role="alert"]'));
    expect(q('.carryover [role="alert"]')!.textContent).toContain("already has data");
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect((await db.applications.toArray()).map((a) => a.company)).toEqual(["Initech"]);
    expect((await localCounts()).applications).toBe(2);
    await settle(50);
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it("does not offer when the account has settings or accounts but no applications", async () => {
    await seedLocal();
    for (const prepare of [
      (d: JobTrackerDB) => d.settings.put({ key: "theme", value: "dark" }),
      (d: JobTrackerDB) => upsertAccount(d, "gmail", "me@gmail.com"),
    ]) {
      cleanupRendered();
      const db = freshDb();
      await prepare(db);
      expect(await db.applications.count()).toBe(0);
      const onResolved = vi.fn();
      const view = await render(h(LocalDataOffer, { db, onResolved }));
      await waitFor(() => onResolved.mock.calls.length === 1);
      await settle(50);
      expect(onResolved).toHaveBeenCalledTimes(1);
      expect(view.container.textContent).toBe("");
    }
  });

  it("stops offering in this browser once a bring-over worked, but not before", async () => {
    await seedLocal();
    // Not now does not set the flag
    const first = vi.fn();
    await render(h(LocalDataOffer, { db: freshDb(), onResolved: first }));
    await click((await waitFor(() => byText("Not now")))!);
    expect(window.localStorage.getItem(DONE_KEY)).toBeNull();
    window.sessionStorage.clear();
    cleanupRendered();

    const second = vi.fn();
    await render(h(LocalDataOffer, { db: freshDb(), onResolved: second }));
    await click((await waitFor(() => byText("Bring them over")))!);
    await waitFor(() => offerText().includes("Brought over 2 applications"));
    expect(window.localStorage.getItem(DONE_KEY)).toBe("1");
    expect(window.localStorage.getItem("jobtracker:carryover-done")).toBe("1");
    cleanupRendered();

    // a different account in the same browser, with the earlier copy still there
    expect((await localCounts()).applications).toBe(2);
    const third = vi.fn();
    const view = await render(h(LocalDataOffer, { db: freshDb(), onResolved: third }));
    await waitFor(() => third.mock.calls.length === 1);
    await settle(50);
    expect(third).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toBe("");
  });

  it("offers Try again after an unexpected failure, and onResolved still fires once", async () => {
    await seedLocal();
    const db = freshDb();
    const onResolved = vi.fn();
    await render(h(LocalDataOffer, { db, onResolved }));
    const bring = await waitFor(() => byText("Bring them over"));
    vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("disk full"));
    await click(bring);
    await waitFor(() => q('.carryover [role="alert"]'));
    expect(q('.carryover [role="alert"]')!.textContent).toContain("Couldn't bring them over");
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(DONE_KEY)).toBeNull();

    await click(byText("Try again")!);
    const again = await waitFor(() => byText("Bring them over"));
    expect(q('.carryover [role="alert"]')).toBeNull();
    expect(document.activeElement).toBe(again);
    await click(again);
    await waitFor(() => offerText().includes("Brought over 2 applications"));
    expect(await db.applications.count()).toBe(2);
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it("has no Try again when the refusal can't change", async () => {
    await seedLocal();
    const db = freshDb();
    await render(h(LocalDataOffer, { db, onResolved: vi.fn() }));
    const bring = await waitFor(() => byText("Bring them over"));
    await db.settings.put({ key: "theme", value: "dark" });
    await click(bring);
    await waitFor(() => q('.carryover [role="alert"]'));
    expect(offerText()).toContain("already has data");
    expect(byText("Try again")).toBeNull();
  });
});

// setupStatus: each of the four steps as done, skipped or missing, the detail lines, the next step, and the skip and dismissal settings.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { upsertAccount } from "../../src/db/repo";
import { exportAll, importAll } from "../../src/portability";
import { saveMaster } from "../../src/sync/documents";
import { dismissSetupCard, isSetupCardDismissed, setupStatus, skipStep, unskipAll, type SetupDeps } from "../../src/sync/setupStatus";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const NOW = new Date("2026-11-10T15:00:00Z");
const sections = [{ kind: "summary", heading: "Summary", lines: [{ text: "Analyst." }] }];

function fakeDeps(parts: Partial<SetupDeps> = {}): SetupDeps {
  return {
    aiState: () => "none",
    aiLast4: () => null,
    lastBackupAt: () => null,
    backupFile: async () => null,
    mailAvailable: () => true,
    ...parts,
  };
}

describe("setupStatus", () => {
  it("is 0 of 4 on an empty account, with the mailbox next", async () => {
    const s = await setupStatus(freshDb(), fakeDeps(), NOW);
    expect(s.done).toBe(0);
    expect(s.total).toBe(4);
    expect(s.next).toBe("mailbox");
    expect(Object.values(s.steps).map((x) => x.state)).toEqual(["missing", "missing", "missing", "missing"]);
    expect(s.steps.mailbox.detail).toBe("No mailbox connected");
  });

  it("says the demo can't connect mail", async () => {
    const s = await setupStatus(freshDb(), fakeDeps({ mailAvailable: () => false }), NOW);
    expect(s.steps.mailbox).toEqual({ state: "missing", detail: "This demo can't connect mail" });
  });

  it("mailbox is done with one detail per active account, and a disconnected account doesn't count", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "you@gmail.com");
    const out = await upsertAccount(db, "outlook", "old@outlook.com");
    await db.accounts.update(out, { active: false });
    expect((await setupStatus(db, fakeDeps(), NOW)).steps.mailbox).toEqual({ state: "done", detail: "Gmail · you@gmail.com" });
    await upsertAccount(db, "outlook", "me@outlook.com");
    await db.accounts.update(out, { active: false });
    expect((await setupStatus(db, fakeDeps(), NOW)).steps.mailbox.detail).toBe("Gmail · you@gmail.com, Outlook · me@outlook.com");
  });

  it("resume is done with the master's update date, and a deleted master is missing", async () => {
    const db = freshDb();
    const id = await saveMaster(db, sections, "paste", new Date("2026-11-10T15:00:00Z"));
    const done = (await setupStatus(db, fakeDeps(), NOW)).steps.resume;
    expect(done.state).toBe("done");
    expect(done.detail).toBe(`Master resume · updated ${new Date("2026-11-10T15:00:00Z").toLocaleDateString([], { month: "short", day: "numeric" })}`);
    await db.documents.update(id, { deletedAt: "2026-11-10T16:00:00Z" });
    expect((await setupStatus(db, fakeDeps(), NOW)).steps.resume.state).toBe("missing");
  });

  it("AI key: none is missing, locked and unlocked are done and say which", async () => {
    const db = freshDb();
    expect((await setupStatus(db, fakeDeps(), NOW)).steps.aiKey).toEqual({ state: "missing", detail: "No key" });
    const locked = await setupStatus(db, fakeDeps({ aiState: () => "locked", aiLast4: () => "1234" }), NOW);
    expect(locked.steps.aiKey).toEqual({ state: "done", detail: "Key ending in ••••1234 · locked" });
    const open = await setupStatus(db, fakeDeps({ aiState: () => "unlocked", aiLast4: () => "1234" }), NOW);
    expect(open.steps.aiKey).toEqual({ state: "done", detail: "Key ending in ••••1234 · unlocked" });
  });

  it("backup: a recent export or a chosen file is done, an old export is not", async () => {
    const db = freshDb();
    const nine = "2026-11-09T15:00:00Z";
    const recent = (await setupStatus(db, fakeDeps({ lastBackupAt: () => nine }), NOW)).steps.backup;
    expect(recent.state).toBe("done");
    expect(recent.detail).toBe(`Backed up ${new Date(nine).toLocaleDateString([], { month: "short", day: "numeric" })}`);
    const stale = (await setupStatus(db, fakeDeps({ lastBackupAt: () => "2026-10-01T15:00:00Z" }), NOW)).steps.backup;
    expect(stale.state).toBe("missing");
    expect(stale.detail).toMatch(/^Last backup /);
    expect((await setupStatus(db, fakeDeps(), NOW)).steps.backup).toEqual({ state: "missing", detail: "Never backed up" });
    const file = (await setupStatus(db, fakeDeps({ backupFile: async () => "jobs.json" }), NOW)).steps.backup;
    expect(file).toEqual({ state: "done", detail: "Backup file · jobs.json" });
  });

  it("a backup exactly 14 days old is still fresh, 15 is stale", async () => {
    const db = freshDb();
    expect((await setupStatus(db, fakeDeps({ lastBackupAt: () => "2026-10-27T15:00:00Z" }), NOW)).steps.backup.state).toBe("done");
    expect((await setupStatus(db, fakeDeps({ lastBackupAt: () => "2026-10-26T15:00:00Z" }), NOW)).steps.backup.state).toBe("missing");
  });

  it("next is the first missing step in order, and is null when every step is done", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "you@gmail.com");
    expect((await setupStatus(db, fakeDeps(), NOW)).next).toBe("resume");
    await saveMaster(db, sections, "paste");
    expect((await setupStatus(db, fakeDeps(), NOW)).next).toBe("aiKey");
    const all = await setupStatus(db, fakeDeps({ aiState: () => "locked", aiLast4: () => "9999", backupFile: async () => "b.json" }), NOW);
    expect(all.next).toBeNull();
    expect(all.done).toBe(4);
  });
});

describe("skipping", () => {
  it("a skipped step counts as done and says Skipped", async () => {
    const db = freshDb();
    await skipStep(db, "mailbox");
    const s = await setupStatus(db, fakeDeps(), NOW);
    expect(s.steps.mailbox).toEqual({ state: "skipped", detail: "Skipped" });
    expect(s.done).toBe(1);
    expect(s.next).toBe("resume");
    await skipStep(db, "aiKey");
    const both = await setupStatus(db, fakeDeps(), NOW);
    expect(both.steps.aiKey.state).toBe("skipped");
    expect(both.done).toBe(2);
  });

  it("a step that is really done shows done even if it was skipped earlier", async () => {
    const db = freshDb();
    await skipStep(db, "mailbox");
    await upsertAccount(db, "gmail", "you@gmail.com");
    expect((await setupStatus(db, fakeDeps(), NOW)).steps.mailbox.state).toBe("done");
  });

  it("unskipAll brings every skipped step back", async () => {
    const db = freshDb();
    await skipStep(db, "mailbox");
    await skipStep(db, "aiKey");
    await unskipAll(db);
    const s = await setupStatus(db, fakeDeps(), NOW);
    expect(s.steps.mailbox.state).toBe("missing");
    expect(s.steps.aiKey.state).toBe("missing");
    expect(s.done).toBe(0);
  });

  it("skips and the dismissal travel with an export and an import", async () => {
    const a = freshDb();
    await skipStep(a, "aiKey");
    await dismissSetupCard(a);
    const envelope = await exportAll(a);
    expect(envelope.data.settings.setupSkips).toEqual({ mailbox: false, aiKey: true });
    const b = freshDb();
    await importAll(b, JSON.parse(JSON.stringify(envelope)));
    expect((await setupStatus(b, fakeDeps(), NOW)).steps.aiKey.state).toBe("skipped");
    expect(await isSetupCardDismissed(b)).toBe(true);
  });

  it("a malformed value in an imported file counts as not skipped", async () => {
    const a = freshDb();
    const envelope = JSON.parse(JSON.stringify(await exportAll(a)));
    envelope.data.settings.setupSkips = { mailbox: "yes", aiKey: 1, extra: true };
    envelope.data.settings.setupCard = { dismissed: "true" };
    const b = freshDb();
    await importAll(b, envelope);
    expect((await setupStatus(b, fakeDeps(), NOW)).done).toBe(0);
    expect(await isSetupCardDismissed(b)).toBe(false);
  });
});

describe("the card's dismissal", () => {
  it("starts not dismissed, stays dismissed, and is per database", async () => {
    const db = freshDb();
    const other = freshDb();
    expect(await isSetupCardDismissed(db)).toBe(false);
    await dismissSetupCard(db);
    expect(await isSetupCardDismissed(db)).toBe(true);
    expect(await isSetupCardDismissed(other)).toBe(false);
  });

  it("is not undone by skipping or unskipping", async () => {
    const db = freshDb();
    await dismissSetupCard(db);
    await skipStep(db, "mailbox");
    await unskipAll(db);
    expect(await isSetupCardDismissed(db)).toBe(true);
  });
});

// A second tab (or a sync) can write while an action is working out what to do. These tests make that happen at the worst
// moment: just before the action's transaction starts. An action that decided things before the transaction would then act
// on facts that are no longer true; one that reads inside the transaction sees the other writer's change.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type JobTrackerDB } from "../../src/db/schema";
import { deleteApplication, editApplication, mergeApplications, setStage, unlockStage } from "../../src/sync/actions";
import { recheck } from "../../src/sync/recheck";
import { processMessage } from "../../src/sync/sync";
import { MissingRecordError } from "../../src/db/errors";
import { closeAll, dbWithAccount, mail, seedNote } from "./helpers";

const others: JobTrackerDB[] = [];
afterEach(async () => {
  await closeAll();
  while (others.length) others.pop()!.close();
});

/** Another connection to the same database, like a second tab. */
function secondTab(db: JobTrackerDB): JobTrackerDB {
  const other = openDatabase(db.name);
  others.push(other);
  return other;
}

/** Runs `write` (and waits for it) right before the next transaction on `db` starts. */
function beforeNextTransaction(db: JobTrackerDB, write: () => Promise<void>): void {
  const start = db.transaction.bind(db);
  let armed = true;
  (db as unknown as { transaction: unknown }).transaction = (...args: unknown[]) => {
    if (!armed) return (start as (...a: unknown[]) => unknown)(...args);
    armed = false;
    return write().then(() => (start as (...a: unknown[]) => unknown)(...args));
  };
}

const app = (company: string, extra: Record<string, unknown> = {}) => ({
  company, companyKey: company.toLowerCase(), role: "Dev", roleKey: "dev", stage: "Applied" as const, stageAt: null, appliedAt: null,
  lastActivity: "2026-10-01T00:00:00Z", locked: false, manual: false, ...extra,
});

describe("mergeApplications with a second writer", () => {
  it("keeps a newer lastActivity that was written just before the merge started", async () => {
    const { db } = await dbWithAccount();
    const from = await db.applications.add(app("A"));
    const into = await db.applications.add(app("B"));
    const tab = secondTab(db);
    beforeNextTransaction(db, async () => void (await tab.applications.update(into, { lastActivity: "2026-11-01T00:00:00Z" })));
    await mergeApplications(db, from, into);
    expect((await db.applications.get(into))!.lastActivity).toBe("2026-11-01T00:00:00Z");
  });

  it("refuses, and leaves everything where it was, when the target was deleted just before the merge started", async () => {
    const { db, acct } = await dbWithAccount();
    const from = await db.applications.add(app("A"));
    const into = await db.applications.add(app("B"));
    await db.emails.add({
      accountId: acct, providerMsgId: "m", threadId: "t", receivedAt: "2026-10-02T00:00:00Z", related: true, needsReview: false, applicationId: from,
      subject: "s", sender: "x", body: "b", event: "applied", confidence: "high", reason: "", hold: false, bulk: false, webLink: null,
    });
    const tab = secondTab(db);
    beforeNextTransaction(db, () => deleteApplication(tab, into));
    await expect(mergeApplications(db, from, into)).rejects.toThrow(/another application/);
    expect((await db.emails.toArray()).map((e) => e.applicationId)).toEqual([from]);
    expect(await db.applications.get(from)).toBeDefined();
  });

  it("never leaves an email pointing at an application that is gone", async () => {
    const { db, acct } = await dbWithAccount();
    const from = await db.applications.add(app("A"));
    const into = await db.applications.add(app("B"));
    await db.emails.add({
      accountId: acct, providerMsgId: "m", threadId: "t", receivedAt: "2026-10-02T00:00:00Z", related: true, needsReview: false, applicationId: from,
      subject: "s", sender: "x", body: "b", event: "applied", confidence: "high", reason: "", hold: false, bulk: false, webLink: null,
    });
    const tab = secondTab(db);
    // the other tab deletes the target while the merge is starting: whichever of the two wins, nothing is left dangling
    beforeNextTransaction(db, () => deleteApplication(tab, into));
    await mergeApplications(db, from, into).catch(() => undefined);
    const alive = new Set((await db.applications.toArray()).map((a) => a.id));
    for (const e of await db.emails.toArray()) expect(e.applicationId === null || alive.has(e.applicationId)).toBe(true);
  });
});

describe("recheck with a second writer", () => {
  async function newsletterApplication() {
    const { db, acct } = await dbWithAccount();
    // an application a sync made from one email; then a rule says that sender was never a job
    await processMessage(db, acct, mail("Hello", "Thank you for applying to Acme for the Analyst role. We received your application.", "Acme Careers <jobs@acme.com>", "a", 1, "t1"));
    expect([await db.applications.count(), (await db.emails.toArray()).filter((e) => e.related).length]).toEqual([1, 1]);
    await db.learnedRules.add({ kind: "block_sender", value: "jobs@acme.com", evidence: 3, active: true, createdAt: "2026-10-02T00:00:00Z" });
    return { db };
  }

  it("removes an application nobody touched", async () => {
    const { db } = await newsletterApplication();
    expect((await recheck(db)).removed).toBe(1);
    expect(await db.applications.count()).toBe(0);
  });

  it("keeps an application, and its note, when the note was added just before the recheck's transaction started", async () => {
    const { db } = await newsletterApplication();
    const tab = secondTab(db);
    beforeNextTransaction(db, () => seedNote(tab, 1, "Spoke to Sam, send CV Friday"));
    const result = await recheck(db);
    expect([result.cleared, result.removed]).toEqual([0, 0]);
    expect(await db.applications.count()).toBe(1);
    expect((await db.activity.toArray()).map((r) => r.body)).toEqual(["Spoke to Sam, send CV Friday"]);
    expect((await db.emails.toArray())[0].related).toBe(true);
  });

  it("keeps an application whose stage was locked just before the transaction started", async () => {
    const { db } = await newsletterApplication();
    const tab = secondTab(db);
    beforeNextTransaction(db, () => setStage(tab, 1, "Interview").then(() => undefined));
    expect((await recheck(db)).removed).toBe(0);
    expect((await db.applications.get(1))!.stage).toBe("Interview");
  });

  it("leaves an email alone that you settled yourself while it ran", async () => {
    const { db } = await newsletterApplication();
    const tab = secondTab(db);
    beforeNextTransaction(db, () => tab.emails.update(1, { related: false }).then(() => undefined));
    expect((await recheck(db)).cleared).toBe(0);
  });
});

describe("single-row actions", () => {
  it("say the application is gone, rather than doing nothing, when it was deleted just before they wrote", async () => {
    const { db } = await dbWithAccount();
    const id = await db.applications.add(app("A"));
    const tab = secondTab(db);
    for (const act of [
      () => editApplication(db, id, "B", "Dev"),
      () => setStage(db, id, "Interview"),
      () => unlockStage(db, id),
    ]) {
      await db.applications.put({ ...app("A"), id });
      beforeNextTransaction(db, () => deleteApplication(tab, id));
      await expect(act()).rejects.toBeInstanceOf(MissingRecordError);
      expect(await db.applications.count()).toBe(0);
    }
  });
});

describe("the same email read by two tabs", () => {
  it("counts as already saved for the one that is second, not as an unreadable email", async () => {
    const { db, acct } = await dbWithAccount();
    const msg = mail("Hello", "Thank you for applying to Acme for the Analyst role. We received your application.", "Acme Careers <jobs@acme.com>", "a", 1, "t1");
    const tab = secondTab(db);
    beforeNextTransaction(db, async () => void (await processMessage(tab, acct, msg)));
    expect(await processMessage(db, acct, msg)).toBe("duplicate");
    expect(await db.emails.count()).toBe(1);
    expect(await db.applications.count()).toBe(1);
  });
});

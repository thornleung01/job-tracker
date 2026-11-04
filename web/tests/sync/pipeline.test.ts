// Port of tests/test_pipeline.py: the whole read path, over the real classifier.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { processMessage, processMessages } from "../../src/sync/sync";
import { upsertAccount } from "../../src/db/repo";
import { closeAll, dbWithAccount, freshDb, mk } from "./helpers";

afterEach(closeAll);

const apps = (db: Awaited<ReturnType<typeof freshDb>>) => db.applications.orderBy("id").toArray();

describe("pipeline", () => {
  it("runs a full lifecycle in one thread", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessages(db, acct, [
      mk("1", "Thank you for applying to Acme", "", undefined, "T", 1),
      mk("2", "Interview invitation", "We'd like to schedule an interview.", undefined, "T", 5),
      mk("3", "Offer of employment", "We are pleased to offer you the role.", undefined, "T", 9),
    ]);
    const [a] = await apps(db);
    expect([a.company, a.stage]).toEqual(["Acme", "Offer"]);
    expect(a.appliedAt).toBe("2026-10-01T09:00:00Z");
    expect(a.lastActivity).toBe("2026-10-09T09:00:00Z");
  });

  it("processes by date, not arrival order", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessages(db, acct, [
      mk("3", "Offer", "We are pleased to offer you the role.", undefined, "T", 9),
      mk("1", "Thank you for applying to Acme", "", undefined, "T", 1),
    ]);
    expect((await apps(db))[0].stage).toBe("Offer");
  });

  it("never moves a stage backwards", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessages(db, acct, [
      mk("1", "Thank you for applying to Acme", "", undefined, "T", 1),
      mk("2", "Interview", "Please select a time for your interview.", undefined, "T", 3),
    ]);
    await processMessage(db, acct, mk("3", "Application received", "We received your application.", undefined, "T", 4));
    expect((await apps(db))[0].stage).toBe("Interview");
  });

  it("moves to Rejected after an interview", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessages(db, acct, [
      mk("1", "Thank you for applying to Acme", "", undefined, "T", 1),
      mk("2", "Interview", "Please select a time for your interview.", undefined, "T", 3),
      mk("3", "Update", "Unfortunately we will not be moving forward with your application.", undefined, "T", 8),
    ]);
    expect((await apps(db))[0].stage).toBe("Rejected");
  });

  it("does not let an older rejection overwrite a newer offer", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessages(db, acct, [
      mk("1", "Thank you for applying to Acme", "", undefined, "T", 1),
      mk("2", "Update", "We will not be moving forward with your application.", undefined, "T", 3),
      mk("3", "Offer", "We are pleased to offer you the role.", undefined, "T", 8),
    ]);
    expect((await apps(db))[0].stage).toBe("Offer");
  });

  it("is idempotent when rerun", async () => {
    const { db, acct } = await dbWithAccount();
    const batch = [mk("1", "Thank you for applying to Acme"), mk("2", "Your receipt", "thanks", "Shop <a@shop.com>")];
    await processMessages(db, acct, batch);
    expect(await processMessages(db, acct, batch)).toEqual({ duplicate: 2 });
    expect(await db.applications.count()).toBe(1);
    expect(await db.emails.count()).toBe(2);
  });

  it("keeps no content for unrelated mail", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessage(db, acct, mk("9", "Your receipt", "secret order details", "Shop <a@shop.com>"));
    const row = (await db.emails.toArray())[0];
    expect([row.related, row.subject, row.body, row.sender]).toEqual([false, null, null, null]);
  });

  it("caps the stored body", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessage(db, acct, mk("1", "Thank you for applying to Acme", "x".repeat(10_000)));
    expect((await db.emails.toArray())[0].body).toHaveLength(4096);
  });

  it("keeps a locked application's stage but still records the activity", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessage(db, acct, mk("1", "Thank you for applying to Acme", "", undefined, "T", 1));
    await db.applications.toCollection().modify({ stage: "Interview", locked: true });
    await processMessage(db, acct, mk("2", "Offer", "We are pleased to offer you the role.", undefined, "T", 9));
    const a = (await apps(db))[0];
    expect(a.stage).toBe("Interview");
    expect(a.lastActivity).toBe("2026-10-09T09:00:00Z");
  });

  it("keeps two roles at one company separate", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessages(db, acct, [
      mk("1", "Your application to Data Analyst at Globex", "", "LinkedIn <jobs@linkedin.com>", undefined, 1),
      mk("2", "Your application to Data Engineer at Globex", "", "LinkedIn <jobs@linkedin.com>", undefined, 2),
    ]);
    expect((await apps(db)).map((a) => a.role).sort()).toEqual(["Data Analyst", "Data Engineer"]);
  });

  it("matches a reply to the one open application at the company", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessages(db, acct, [
      mk("1", "Thank you for applying to Acme", "", undefined, "A", 1),
      mk("2", "Interview", "Please select a time for your interview.", undefined, "B", 4),
    ]);
    const all = await apps(db);
    expect(all).toHaveLength(1);
    expect(all[0].stage).toBe("Interview");
  });

  it("sends an ambiguous reply to review without changing a stage", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessages(db, acct, [
      mk("1", "Your application to Data Analyst at Globex", "", "LinkedIn <jobs@linkedin.com>", undefined, 1),
      mk("2", "Your application to Data Engineer at Globex", "", "LinkedIn <jobs@linkedin.com>", undefined, 2),
    ]);
    const result = await processMessage(db, acct, mk("3", "Update from Globex",
      "Unfortunately we will not be moving forward with your application.", "Globex <hr@globex.com>", undefined, 6));
    expect(result).toBe("review");
    expect(new Set((await apps(db)).map((a) => a.stage))).toEqual(new Set(["Applied"]));
    const row = await db.emails.where("[accountId+providerMsgId]").equals([acct, "3"]).first();
    expect(row?.needsReview).toBe(true);
  });

  it("sends low confidence mail to review", async () => {
    const { db, acct } = await dbWithAccount();
    const result = await processMessage(db, acct, mk("1", "Re: your application", "Quick question about your CV.", "Sam <sam@acme.com>"));
    expect(result).toBe("review");
    expect(await apps(db)).toEqual([]);
  });

  it("starts a new application after a rejection at the same company", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessages(db, acct, [
      mk("1", "Thank you for applying to Acme", "", undefined, undefined, 1),
      mk("2", "Update", "We will not be moving forward with your application.", undefined, "2", 3),
      mk("3", "Thank you for applying to Acme", "", undefined, "3", 20),
    ]);
    expect((await apps(db)).map((a) => a.stage)).toEqual(["Rejected", "Applied"]);
  });

  it("does not mix threads across two accounts", async () => {
    const db = freshDb();
    const g = await upsertAccount(db, "gmail", "me@gmail.com");
    const o = await upsertAccount(db, "outlook", "me@outlook.com");
    await processMessage(db, g, mk("1", "Thank you for applying to Acme", "", undefined, "same"));
    await processMessage(db, o, mk("1", "Thank you for applying to Initech", "", "Initech <no-reply@lever.co>", "same"));
    expect((await apps(db)).map((a) => a.company).sort()).toEqual(["Acme", "Initech"]);
  });

  it("marks one unreadable message as seen and carries on", async () => {
    const { db, acct } = await dbWithAccount();
    const bad = { ...mk("bad", "Thank you for applying to Initech", "", undefined, undefined, 2), body: null as unknown as string };
    const counts = await processMessages(db, acct, [mk("good", "Thank you for applying to Acme"), bad]);
    expect(counts).toEqual({ "applied-to-application": 1, error: 1 });
    expect(await db.emails.where("[accountId+providerMsgId]").equals([acct, "bad"]).count()).toBe(1);
  });

  it("treats LinkedIn job alerts as non-applications", async () => {
    const { db, acct } = await dbWithAccount();
    const result = await processMessage(db, acct, mk("al", "Data Analyst: new jobs for you", "Apply now", "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>"));
    expect(result).toBe("job-alert");
    expect(await db.applications.count()).toBe(0);
  });

  it("stores times as ISO seconds, whatever the provider gives", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessage(db, acct, { ...mk("1", "Thank you for applying to Acme"), receivedAt: "2026-10-01T09:00:00.123Z" });
    expect((await db.emails.toArray())[0].receivedAt).toBe("2026-10-01T09:00:00Z");
  });
});

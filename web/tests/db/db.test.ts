import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  allApplicationsFor, applyEvent, clearEmail, createApplication, emailSeen, listAccounts, recordFeedback, senderAddress,
  threadApplication, upsertAccount,
} from "../../src/db/repo";
import { dbNameFor } from "../../src/auth/user";
import { deleteDatabase, openDatabase } from "../../src/db/schema";
import { idleDaysSince, isDayString, iso, localToday, roundHalfEven } from "../../src/db/time";
import { exportAll } from "../../src/portability";
import { closeAll, freshDb } from "../sync/helpers";

afterEach(closeAll);

const newApp = (db: ReturnType<typeof freshDb>, stage: "Applied" | "Interview" = "Applied", when = "2026-10-01T09:00:00Z", company = "Acme") =>
  createApplication(db, { company, companyKey: company.toLowerCase(), role: "Analyst", roleKey: "analyst", stage, when });

describe("accounts", () => {
  it("is unique on provider and address, and switching back on clears the error", async () => {
    const db = freshDb();
    const a = await upsertAccount(db, "gmail", "me@gmail.com");
    expect(await upsertAccount(db, "gmail", "me@gmail.com")).toBe(a);
    expect(await upsertAccount(db, "outlook", "me@gmail.com")).not.toBe(a);
    await db.accounts.update(a, { active: false, lastError: "boom" });
    await upsertAccount(db, "gmail", "me@gmail.com");
    const row = (await db.accounts.get(a))!;
    expect([row.active, row.lastError]).toEqual([true, null]);
    expect(await listAccounts(db)).toHaveLength(2);
  });

  it("refuses a duplicate row at the database level", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "me@gmail.com");
    await expect(db.accounts.add({ provider: "gmail", address: "me@gmail.com", lastSync: null, lastError: null, active: true })).rejects.toThrow();
  });
});

describe("emails", () => {
  const email = (accountId: number, providerMsgId: string, extra: Record<string, unknown> = {}) => ({
    accountId, providerMsgId, threadId: null, receivedAt: "2026-10-01T09:00:00Z", sender: null, subject: null, body: null, related: false,
    event: null, confidence: null, applicationId: null, needsReview: false, webLink: null, bulk: false, hold: false, reason: null, ...extra,
  });

  it("is unique per account and message id", async () => {
    const db = freshDb();
    const g = await upsertAccount(db, "gmail", "me@gmail.com");
    const o = await upsertAccount(db, "outlook", "me@outlook.com");
    await db.emails.add(email(g, "m1"));
    await expect(db.emails.add(email(g, "m1"))).rejects.toThrow();
    await db.emails.add(email(o, "m1")); // the same id in another mailbox is a different email
    expect(await emailSeen(db, g, "m1")).toBe(true);
    expect(await emailSeen(db, g, "m2")).toBe(false);
  });

  it("finds the application of a thread, newest first, within one account", async () => {
    const db = freshDb();
    const g = await upsertAccount(db, "gmail", "me@gmail.com");
    const o = await upsertAccount(db, "outlook", "me@outlook.com");
    const a = await newApp(db);
    const b = await newApp(db, "Applied", "2026-10-02T09:00:00Z", "Initech");
    await db.emails.add(email(g, "1", { threadId: "T", applicationId: a, receivedAt: "2026-10-01T09:00:00Z" }));
    await db.emails.add(email(g, "2", { threadId: "T", applicationId: b, receivedAt: "2026-10-05T09:00:00Z" }));
    await db.emails.add(email(g, "3", { threadId: "T", applicationId: null, receivedAt: "2026-10-09T09:00:00Z" }));
    expect(await threadApplication(db, g, "T")).toBe(b);
    expect(await threadApplication(db, o, "T")).toBeNull();
    expect(await threadApplication(db, g, "")).toBeNull();
  });

  it("clears an email down to its id and date", async () => {
    const db = freshDb();
    const g = await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await db.emails.add(email(g, "1", { related: true, subject: "s", body: "b", sender: "x <x@y.co>", needsReview: true, hold: true, reason: "r" }));
    await clearEmail(db, id);
    const row = (await db.emails.get(id))!;
    expect([row.related, row.subject, row.body, row.sender, row.needsReview, row.hold, row.reason]).toEqual([false, null, null, null, false, false, null]);
  });
});

describe("applyEvent", () => {
  it("only moves forward through the progression", async () => {
    const db = freshDb();
    const a = await newApp(db);
    expect(await applyEvent(db, a, "interview", "2026-10-03T00:00:00Z")).toBe(true);
    expect(await applyEvent(db, a, "heard_back", "2026-10-04T00:00:00Z")).toBe(false);
    expect((await db.applications.get(a))!.stage).toBe("Interview");
    expect((await db.applications.get(a))!.lastActivity).toBe("2026-10-04T00:00:00Z");
  });

  it("lets a terminal event land only if it is newer than the current stage", async () => {
    const db = freshDb();
    const a = await newApp(db);
    await applyEvent(db, a, "offer", "2026-10-08T00:00:00Z");
    expect(await applyEvent(db, a, "rejected", "2026-10-03T00:00:00Z")).toBe(false);
    expect(await applyEvent(db, a, "rejected", "2026-10-09T00:00:00Z")).toBe(true);
    expect(await applyEvent(db, a, "rejected", "2026-10-10T00:00:00Z")).toBe(false); // already there
  });

  it("does not change the stage of a locked application but still moves last activity", async () => {
    const db = freshDb();
    const a = await newApp(db);
    await db.applications.update(a, { locked: true });
    expect(await applyEvent(db, a, "offer", "2026-10-08T00:00:00Z")).toBe(false);
    const row = (await db.applications.get(a))!;
    expect([row.stage, row.lastActivity]).toEqual(["Applied", "2026-10-08T00:00:00Z"]);
  });

  it("backfills an earlier applied date and never moves it later", async () => {
    const db = freshDb();
    const a = await newApp(db, "Applied", "2026-10-05T00:00:00Z");
    await applyEvent(db, a, "applied", "2026-10-02T00:00:00Z");
    expect((await db.applications.get(a))!.appliedAt).toBe("2026-10-02T00:00:00Z");
    await applyEvent(db, a, "applied", "2026-10-07T00:00:00Z");
    expect((await db.applications.get(a))!.appliedAt).toBe("2026-10-02T00:00:00Z");
  });

  it("lists a company's applications, oldest first", async () => {
    const db = freshDb();
    const a = await newApp(db);
    const b = await newApp(db);
    await applyEvent(db, a, "rejected", "2026-10-03T00:00:00Z");
    expect((await allApplicationsFor(db, "acme")).map((x) => x.id)).toEqual([a, b]);
  });
});

describe("feedback and helpers", () => {
  it("fingerprints an email by its sender address", async () => {
    const db = freshDb();
    await recordFeedback(db, "not_job", { sender: "Coach <Hi@CoachCo.io>", subject: "Tips", reason: "body: x" });
    const fb = (await db.feedback.toArray())[0];
    expect([fb.senderEmail, fb.senderDomain, fb.subject, fb.reason]).toEqual(["hi@coachco.io", "coachco.io", "Tips", "body: x"]);
    expect(senderAddress("plain@x.io")).toBe("plain@x.io");
  });

  it("writes times as ISO seconds", () => {
    expect(iso("2026-10-01T09:00:00.456Z")).toBe("2026-10-01T09:00:00Z");
    expect(iso(new Date(Date.UTC(2026, 9, 1, 9)))).toBe("2026-10-01T09:00:00Z");
    expect(() => iso("nope")).toThrow();
  });

  it("counts whole calendar days since, never below zero", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(idleDaysSince("2026-10-10T08:00:00Z", now, "UTC")).toBe(0);
    expect(idleDaysSince("2026-10-09T13:00:00Z", now, "UTC")).toBe(1);
    expect(idleDaysSince("2026-10-08T12:00:00Z", now, "UTC")).toBe(2);
    expect(idleDaysSince("2026-10-11T12:00:00Z", now, "UTC")).toBe(0);
    expect(idleDaysSince(null, now)).toBeNull();
  });

  it("validates a day string and rounds half to even", () => {
    expect(isDayString("2026-10-21")).toBe(true);
    expect(["2026-02-30", "21/10/2026", "2026-1-1", ""].some(isDayString)).toBe(false);
    expect([0.5, 1.5, 2.5, 12.5, 37.5, 66.6].map(roundHalfEven)).toEqual([0, 2, 2, 12, 38, 67]);
    expect(localToday(new Date(2026, 9, 5))).toBe("2026-10-05");
  });
});

describe("per-user databases", () => {
  it("never shows one database's rows to another", async () => {
    const alice = openDatabase(dbNameFor({ iss: "https://accounts.google.com", sub: "alice" }));
    const bob = openDatabase(dbNameFor({ iss: "https://accounts.google.com", sub: "bob" }));
    try {
      const acct = await upsertAccount(alice, "gmail", "alice@gmail.com");
      await createApplication(alice, { company: "Acme", companyKey: "acme", role: "R", roleKey: "r", stage: "Applied", when: "2026-10-01T00:00:00Z" });
      await alice.settings.put({ key: "appearance", value: { theme: "dark" } });
      expect(acct).toBeGreaterThan(0);
      expect(await bob.accounts.count()).toBe(0);
      expect(await bob.applications.count()).toBe(0);
      expect(await bob.settings.count()).toBe(0);
      expect((await exportAll(bob)).data.applications).toEqual([]);
      expect(await alice.applications.count()).toBe(1);
    } finally {
      alice.close();
      bob.close();
      await deleteDatabase(dbNameFor({ iss: "https://accounts.google.com", sub: "alice" }));
      await deleteDatabase(dbNameFor({ iss: "https://accounts.google.com", sub: "bob" }));
    }
  });

  it("names the database jobtracker:{iss}:{sub}", () => {
    expect(dbNameFor({ iss: "https://accounts.google.com", sub: "123" })).toBe("jobtracker:https://accounts.google.com:123");
  });

  it("is gone after deleteDatabase", async () => {
    const name = dbNameFor({ iss: "iss", sub: "wipe" });
    const db = openDatabase(name);
    await upsertAccount(db, "gmail", "x@y.co");
    db.close();
    await deleteDatabase(name);
    const again = openDatabase(name);
    try {
      expect(await again.accounts.count()).toBe(0);
    } finally {
      again.close();
      await deleteDatabase(name);
    }
  });
});

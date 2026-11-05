// syncAccount: windows, saved progress, errors and the review settle pass, against a fake provider.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MailProvider, Message } from "../../src/types";
import { NotConnected } from "../../src/types";
import { syncAccount } from "../../src/sync/sync";
import { saveSettings } from "../../src/sync/settings";
import { closeAll, dbWithAccount, mk } from "./helpers";

afterEach(closeAll);

function provider(messages: Message[], opts: { failAfter?: number; error?: Error; seen?: { since?: Date } } = {}): MailProvider {
  return {
    name: "gmail",
    address: "me@gmail.com",
    async *fetch(since, skip) {
      if (opts.seen) opts.seen.since = since;
      let n = 0;
      for (const m of messages) {
        if (skip(m.id)) continue;
        if (opts.failAfter !== undefined && n >= opts.failAfter) throw opts.error ?? new Error("connection lost");
        n++;
        yield m;
      }
      if (opts.failAfter === 0 && opts.error) throw opts.error;
    },
  };
}

const now = new Date("2026-10-20T12:00:00Z");

describe("syncAccount", () => {
  it("reads new mail and records the sync time", async () => {
    const { db, acct } = await dbWithAccount();
    const counts = await syncAccount(db, acct, provider([mk("1", "Thank you for applying to Acme")]), { now });
    expect(counts).toEqual({ "applied-to-application": 1 });
    expect(await db.applications.count()).toBe(1);
    const row = (await db.accounts.get(acct))!;
    expect([row.lastSync, row.lastError]).toEqual(["2026-10-20T12:00:00Z", null]);
  });

  it("does not fetch bodies it already has", async () => {
    const { db, acct } = await dbWithAccount();
    const p = provider([mk("1", "Thank you for applying to Acme")]);
    await syncAccount(db, acct, p, { now });
    expect(await syncAccount(db, acct, p, { now })).toEqual({});
  });

  it("uses the lookback setting on a first sync, and a day of overlap after", async () => {
    const { db, acct } = await dbWithAccount();
    await saveSettings(db, "sync", { lookbackDays: 180 });
    const seen: { since?: Date } = {};
    await syncAccount(db, acct, provider([], { seen }), { now });
    expect(Math.round((now.getTime() - seen.since!.getTime()) / 86_400_000)).toBe(180);
    await syncAccount(db, acct, provider([], { seen }), { now: new Date("2026-10-25T00:00:00Z") });
    expect(seen.since!.toISOString()).toBe("2026-10-19T12:00:00.000Z");
    await syncAccount(db, acct, provider([], { seen }), { now, days: 90 });
    expect(Math.round((now.getTime() - seen.since!.getTime()) / 86_400_000)).toBe(90);
  });

  it("records a provider error on the account and rethrows", async () => {
    const { db, acct } = await dbWithAccount();
    await expect(syncAccount(db, acct, provider([], { failAfter: 0, error: new NotConnected("Log in again") }), { now })).rejects.toThrow("Log in again");
    const row = (await db.accounts.get(acct))!;
    expect(row.lastError).toBe("Log in again");
    expect(row.lastSync).toBeNull();
  });

  it("keeps what an incremental sync read before it failed, and does not advance the watermark", async () => {
    const { db, acct } = await dbWithAccount();
    const msgs = [mk("1", "Thank you for applying to Acme"), mk("2", "Thank you for applying to Initech", "", "Initech <no-reply@lever.co>", undefined, 2)];
    await expect(syncAccount(db, acct, provider(msgs, { failAfter: 1 }), { now, incremental: true })).rejects.toThrow("connection lost");
    expect(await db.applications.count()).toBe(1);
    expect((await db.accounts.get(acct))!.lastSync).toBeNull();
    await syncAccount(db, acct, provider(msgs), { now, incremental: true });
    expect(await db.applications.count()).toBe(2);
  });

  it("without incremental, a failed sync saves nothing", async () => {
    const { db, acct } = await dbWithAccount();
    const msgs = [mk("1", "Thank you for applying to Acme"), mk("2", "Thank you for applying to Initech", "", "Initech <no-reply@lever.co>", undefined, 2)];
    await expect(syncAccount(db, acct, provider(msgs, { failAfter: 1 }), { now })).rejects.toThrow();
    expect(await db.applications.count()).toBe(0);
  });

  it("notes unreadable messages without failing", async () => {
    const { db, acct } = await dbWithAccount();
    const bad = { ...mk("bad", "Thank you for applying to Initech"), body: null as unknown as string };
    const counts = await syncAccount(db, acct, provider([mk("good", "Thank you for applying to Acme"), bad]), { now });
    expect(counts.error).toBe(1);
    expect((await db.accounts.get(acct))!.lastError).toBe("Skipped 1 unreadable email.");
  });

  it("settles review mail that new mail has made clear", async () => {
    const { db, acct } = await dbWithAccount();
    const early = { ...mk("early", "Next steps", "We would like to schedule an interview with you for the Analyst role at Acme.", "Pat Lee <pat@acme.com>", undefined, 1) };
    await syncAccount(db, acct, provider([early]), { now });
    expect((await db.emails.toArray()).filter((e) => e.needsReview)).toHaveLength(1);
    await syncAccount(db, acct, provider([mk("later", "Thank you for applying to Acme", "We received your application for the Analyst role.", "Acme <jobs@acme.com>", undefined, 3)]), { now });
    expect((await db.emails.toArray()).filter((e) => e.needsReview)).toHaveLength(0);
  });

  it("reports progress", async () => {
    const { db, acct } = await dbWithAccount();
    const events: string[] = [];
    await syncAccount(db, acct, provider([mk("1", "Thank you for applying to Acme")]), { now, progress: (p) => events.push(`${p.phase}:${p.done}`) });
    expect(events).toEqual(["finding:0", "reading:1"]);
  });
});

describe("pressing Stop", () => {
  it("is not logged and leaves no error on the account", async () => {
    const { db, acct } = await dbWithAccount();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(syncAccount(db, acct, provider([], { failAfter: 0, error: new DOMException("Aborted", "AbortError") }), { now })).rejects.toThrow("Aborted");
      expect(logged).not.toHaveBeenCalled();
      expect((await db.accounts.get(acct))!.lastError).toBeNull();
    } finally {
      logged.mockRestore();
    }
  });

  it("still records a real failure, and reports that failure even when saving the note about it fails", async () => {
    const { db, acct } = await dbWithAccount();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(syncAccount(db, acct, provider([], { failAfter: 0, error: new Error("token expired") }), { now })).rejects.toThrow("token expired");
      expect((await db.accounts.get(acct))!.lastError).toBe("Sync stopped because something went wrong. Try again.");
      const update = vi.spyOn(db.accounts, "update").mockRejectedValue(new Error("database closed"));
      await expect(syncAccount(db, acct, provider([], { failAfter: 0, error: new Error("token expired") }), { now })).rejects.toThrow("token expired");
      update.mockRestore();
    } finally {
      logged.mockRestore();
    }
  });
});

// PERF-3: the Outlook provider reads oldest first and the sync saves in batches (BATCH) instead of holding the whole mailbox.
// What must stay true: batches go in date order, a run that stops part-way keeps what it read but does not move lastSync (so the
// next run starts from the same window), and the classifier gives the same answer as when everything was collected first.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import type { JobTrackerDB } from "../../src/db/schema";
import { BATCH, syncAccount } from "../../src/sync/sync";
import type { MailProvider, Message } from "../../src/types";
import { closeAll, dbWithAccount } from "./helpers";

afterEach(closeAll);

const now = new Date("2026-10-20T12:00:00Z");
const OLD_SYNC = "2026-10-10T12:00:00Z";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 0, minute)).toISOString();
const msg = (id: string, subject: string, sender: string, minute: number, body = "", thread = id): Message => {
  const [name, rest] = sender.split("<");
  return { id, threadId: thread, senderName: name.trim(), senderEmail: rest.replace(">", ""), subject, receivedAt: at(minute), body, webLink: null };
};

/** A mailbox with a few companies going through applied, interview and rejected, plus mail that is not about jobs. Every time is unique. */
function mailbox(): Message[] {
  const out: Message[] = [];
  let minute = 0;
  for (let i = 0; i < 32; i++) {
    const co = `Company${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`;
    const sender = `${co} Careers <no-reply@${co.toLowerCase()}.com>`;
    out.push(msg(`${co}-applied`, `Thank you for applying to ${co}`, sender, minute++, `We received your application for the Analyst role at ${co}.`));
    out.push(msg(`${co}-news`, `Your weekly digest ${i}`, "News <news@example.org>", minute++, "ten jobs you may like"));
    if (i % 2 === 0) out.push(msg(`${co}-interview`, `Interview invitation from ${co}`, sender, minute++, `We would like to schedule an interview with you for the Analyst role at ${co}.`));
    if (i % 4 === 0) out.push(msg(`${co}-reject`, `Update on your application to ${co}`, sender, minute++, "Unfortunately we will not be moving forward with your application."));
  }
  return out;
}

/** Like the real providers: skips what is stored, honours the signal, and yields in the order it was given. */
function provider(messages: Message[], hooks: { onYield?: (n: number, m: Message) => void | Promise<void>; since?: { at?: Date } } = {}): MailProvider {
  return {
    name: "outlook",
    address: "me@outlook.com",
    async *fetch(since, skip, signal) {
      if (hooks.since) hooks.since.at = since;
      let n = 0;
      for (const m of messages) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (skip(m.id)) continue;
        await hooks.onYield?.(n++, m);
        yield m;
      }
    },
  };
}

const ascending = (m: Message[]) => [...m].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

/** Everything the classifier and matcher decided, without clocks or row ids that only follow insertion order. */
async function snapshot(db: JobTrackerDB) {
  const apps = (await db.applications.toArray()).map((a) => ({ id: a.id, company: a.company, role: a.role, stage: a.stage, locked: a.locked }));
  const emails = (await db.emails.toArray()).map((e) => ({
    id: e.providerMsgId, related: e.related, event: e.event, confidence: e.confidence, needsReview: e.needsReview, reason: e.reason, app: e.applicationId,
  }));
  const bySort = <T extends { id: unknown }>(a: T, b: T) => String(a.id).localeCompare(String(b.id));
  return { apps: apps.sort(bySort), emails: emails.sort(bySort) };
}

describe("saving in batches (PERF-3)", () => {
  it("saves each batch as it is read, in date order", async () => {
    const { db, acct } = await dbWithAccount();
    const msgs = ascending(mailbox());
    expect(msgs.length).toBeGreaterThan(BATCH * 2);
    const savedWhenReading: number[] = [];
    await syncAccount(db, acct, provider(msgs, { onYield: async (n) => { savedWhenReading[n] = await db.emails.count(); } }), { now, incremental: true });
    // Nothing is saved while the first batch is still being read; by the time the third batch is read, the first two are in.
    expect(savedWhenReading[0]).toBe(0);
    expect(savedWhenReading[BATCH - 1]).toBe(0);
    expect(savedWhenReading[BATCH]).toBeGreaterThan(0);
    expect(savedWhenReading[BATCH * 2]).toBeGreaterThan(savedWhenReading[BATCH]);
    // The related emails went in oldest first.
    const stored = (await db.emails.orderBy("id").toArray()).filter((e) => e.related);
    expect(stored.map((e) => e.receivedAt)).toEqual([...stored.map((e) => e.receivedAt)].sort());
  });

  it("a stop part-way keeps what was read, leaves lastSync where it was, and the next run finishes from the same window", async () => {
    const { db, acct } = await dbWithAccount();
    await db.accounts.update(acct, { lastSync: OLD_SYNC });
    const msgs = ascending(mailbox());
    const stop = new AbortController();
    const first: { at?: Date } = {};
    await expect(
      syncAccount(db, acct, provider(msgs, { since: first, onYield: (n) => { if (n === BATCH + 5) stop.abort(); } }), { now, incremental: true, signal: stop.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    const row = (await db.accounts.get(acct))!;
    expect([row.lastSync, row.lastError]).toEqual([OLD_SYNC, null]);        // not advanced, and Stop is not an error
    const kept = await db.emails.count();
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan((await snapshotAfterFullRun(msgs)).emails.length);

    const second: { at?: Date } = {};
    await syncAccount(db, acct, provider(msgs, { since: second }), { now, incremental: true });
    expect(second.at!.toISOString()).toBe(first.at!.toISOString());          // same window start: nothing between the two runs is missed
    expect((await db.accounts.get(acct))!.lastSync).toBe("2026-10-20T12:00:00Z");
    expect(await snapshot(db)).toEqual(await snapshotAfterFullRun(msgs));    // and the end state is the one an uninterrupted run gives
  });

  it("a failure part-way does not move lastSync either", async () => {
    const { db, acct } = await dbWithAccount();
    await db.accounts.update(acct, { lastSync: OLD_SYNC });
    const msgs = ascending(mailbox());
    await expect(
      syncAccount(db, acct, provider(msgs, { onYield: (n) => { if (n === BATCH + 5) throw new Error("connection lost"); } }), { now, incremental: true }),
    ).rejects.toThrow("connection lost");
    expect((await db.accounts.get(acct))!.lastSync).toBe(OLD_SYNC);
  });

  it("decides the same as collecting the whole mailbox first, for newest-first and oldest-first order", async () => {
    const msgs = mailbox();
    const oldWay = await dbWithAccount();       // what the sync did before: provider newest first, everything collected, then processed
    const oldCounts = await syncAccount(oldWay.db, oldWay.acct, provider([...ascending(msgs)].reverse()), { now });
    const newWay = await dbWithAccount();       // what it does now: oldest first, saved in batches
    const newCounts = await syncAccount(newWay.db, newWay.acct, provider(ascending(msgs)), { now, incremental: true });
    expect(newCounts).toEqual(oldCounts);
    const before = await snapshot(oldWay.db);
    expect(await snapshot(newWay.db)).toEqual(before);
    // Not an empty comparison: several applications, some past Applied, some rejected, and unrelated mail set aside.
    expect(before.apps.length).toBeGreaterThanOrEqual(10);
    expect(new Set(before.apps.map((a) => a.stage)).size).toBeGreaterThanOrEqual(3);
    expect(before.emails.some((e) => !e.related)).toBe(true);
  });
});

async function snapshotAfterFullRun(msgs: Message[]) {
  const { db, acct } = await dbWithAccount();
  await syncAccount(db, acct, provider(ascending(msgs)), { now, incremental: true });
  return snapshot(db);
}

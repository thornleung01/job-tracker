import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportError } from "../../src/portability";
import {
  connectMailbox, connectedAddress, describeImport, describeSync, exportFilename, forgetConnections, isConnected, parseImportText, runSync,
} from "../../src/pages/settings/actions";
import { listAccounts, upsertAccount } from "../../src/db/repo";
import { NotConnected, type MailProvider } from "../../src/types";
import { ada, closeDbs, freshDb } from "../app/helpers";
import type { SyncReport } from "../../src/pages/settings/actions";
import type { AccountRow } from "../../src/db/schema";

beforeEach(forgetConnections);
afterEach(closeDbs);

const mail = { gmail: true, outlook: false };

describe("connectMailbox", () => {
  it("connects, reads the address, saves the account and remembers which mailbox this tab holds", async () => {
    const db = freshDb();
    const connectMail = vi.fn(async () => {});
    const getAddress = vi.fn(async () => "me@gmail.com");
    const tokenSource = vi.fn(async () => "t");
    const r = await connectMailbox(db, ada, "gmail", { connectMail, getAddress, tokenSource, createProvider: vi.fn() });
    expect(r.address).toBe("me@gmail.com");
    expect(connectMail).toHaveBeenCalledWith("gmail");
    expect(getAddress).toHaveBeenCalledWith("gmail", tokenSource);
    expect((await listAccounts(db)).map((a) => a.address)).toEqual(["me@gmail.com"]);
    expect(connectedAddress(ada, "gmail")).toBe("me@gmail.com");
    expect(isConnected(ada, { provider: "gmail", address: "me@gmail.com" }, mail)).toBe(true);
    expect(isConnected(ada, { provider: "gmail", address: "other@gmail.com" }, mail)).toBe(false);
    expect(isConnected(ada, { provider: "gmail", address: "me@gmail.com" }, { gmail: false, outlook: false })).toBe(false);
  });

  it("saves nothing when access is refused", async () => {
    const db = freshDb();
    const connectMail = vi.fn(async () => {
      throw new NotConnected("no");
    });
    await expect(
      connectMailbox(db, ada, "outlook", { connectMail, getAddress: vi.fn(), tokenSource: vi.fn(), createProvider: vi.fn() }),
    ).rejects.toBeInstanceOf(NotConnected);
    expect(await listAccounts(db)).toEqual([]);
    expect(connectedAddress(ada, "outlook")).toBeNull();
  });
});

describe("runSync", () => {
  const empty = (name: "gmail" | "outlook"): MailProvider => ({ name, address: "x", async *fetch() {} });

  it("syncs connected accounts and sets aside the rest", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "a@gmail.com");
    await upsertAccount(db, "outlook", "b@outlook.com");
    const createProvider = vi.fn((name: "gmail" | "outlook", ..._rest: unknown[]) => empty(name));
    const report = await runSync(db, {
      tokenSource: vi.fn(), createProvider: createProvider as never, isConnected: (a) => a.provider === "gmail",
    });
    expect(report.synced.map((s) => s.account.address)).toEqual(["a@gmail.com"]);
    expect(report.needConnect.map((a) => a.address)).toEqual(["b@outlook.com"]);
    expect(createProvider).toHaveBeenCalledTimes(1);
  });

  it("reports progress and passes oldestFirst to Gmail only", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "a@gmail.com");
    await upsertAccount(db, "outlook", "b@outlook.com");
    const createProvider = vi.fn((name: "gmail" | "outlook", ..._rest: unknown[]) => empty(name));
    const labels: string[] = [];
    await runSync(db, { tokenSource: vi.fn(), createProvider: createProvider as never, isConnected: () => true }, { onAccount: (l) => labels.push(l) });
    expect(labels).toEqual(["Gmail a@gmail.com", "Outlook b@outlook.com"]);
    expect(createProvider.mock.calls[0][2]).toMatchObject({ oldestFirst: true });
    expect(createProvider.mock.calls[1][2]).toEqual({});
  });

  it("skips inactive accounts and stops when aborted", async () => {
    const db = freshDb();
    const id = await upsertAccount(db, "gmail", "a@gmail.com");
    await db.accounts.update(id, { active: false });
    const none = await runSync(db, { tokenSource: vi.fn(), createProvider: vi.fn() as never, isConnected: () => true });
    expect(none).toEqual({ synced: [], needConnect: [], failed: [], stopped: false });
    await db.accounts.update(id, { active: true });
    const c = new AbortController();
    c.abort();
    expect((await runSync(db, { tokenSource: vi.fn(), createProvider: vi.fn() as never, isConnected: () => true }, { signal: c.signal })).stopped).toBe(true);
  });

  it("treats NotConnected from the provider as needing a connection, and keeps the other failures", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "a@gmail.com");
    await upsertAccount(db, "outlook", "b@outlook.com");
    const createProvider = (name: "gmail" | "outlook"): MailProvider => ({
      name, address: "x",
      async *fetch() {
        throw name === "gmail" ? new NotConnected("expired") : new Error("Graph answered 500");
      },
    });
    const report = await runSync(db, { tokenSource: vi.fn(), createProvider: createProvider as never, isConnected: () => true });
    expect(report.needConnect.map((a) => a.provider)).toEqual(["gmail"]);
    expect(report.failed.map((f) => [f.account.provider, f.message])).toEqual([["outlook", "Graph answered 500"]]);
  });
});

describe("describeSync", () => {
  const acct = (provider: "gmail" | "outlook", address: string) => ({ provider, address }) as AccountRow;
  const base: SyncReport = { synced: [], needConnect: [], failed: [], stopped: false };

  it("summarises", () => {
    const r = describeSync({ ...base, synced: [{ account: acct("gmail", "a"), counts: { "applied-to-application": 2, review: 1 } }, { account: acct("outlook", "b"), counts: {} }] });
    expect(r).toEqual({ ok: true, lines: ["Synced 2 accounts. 2 added to applications, 1 need review."] });
  });

  it("asks to connect again, names failures and never uses a dash", () => {
    const r = describeSync({ ...base, needConnect: [acct("outlook", "b@o.com")], failed: [{ account: acct("gmail", "a@g.com"), message: "boom" }], stopped: true });
    expect(r.ok).toBe(false);
    expect(r.lines).toEqual(["Connect Outlook b@o.com again, then sync.", "Gmail a@g.com: boom", "Sync stopped."]);
    expect(r.lines.join(" ")).not.toMatch(/[–—]/);
  });

  it("says so when there is nothing to sync", () => {
    expect(describeSync(base).lines).toEqual(["There are no accounts to sync."]);
  });
});

describe("import helpers", () => {
  it("tells the two file kinds apart and rejects non-JSON", () => {
    expect(parseImportText(JSON.stringify({ format: "jobtracker-python-export" })).kind).toBe("python");
    expect(parseImportText(JSON.stringify({ format: "jobtracker-export" })).kind).toBe("web");
    expect(parseImportText("null").kind).toBe("web");
    expect(() => parseImportText("{oops")).toThrow(ImportError);
  });

  it("words the result and names the file", () => {
    expect(describeImport({ applications: 1, emails: 2 } as never)).toBe("Imported 1 application and 2 emails.");
    expect(exportFilename(new Date("2026-11-03T12:00:00Z"))).toBe("job-tracker-2026-11-03.json");
  });
});

// An import that passes validation but fails while it is being written must leave the old data exactly as it was.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportError, MAX_IMPORT_BYTES, exportAll, importAll, importAllIfEmpty } from "../../src/portability";
import { MAX_EMAIL_ROWS, MAX_ROWS, parseExportData } from "../../src/portability/validate";
import { readFileText } from "../../src/pages/settings/actions";
import { saveCoverLetter } from "../../src/sync/documents";
import { createApplication } from "../../src/db/repo";
import { closeAll, dbWithAccount, freshDb } from "../sync/helpers";

afterEach(() => {
  vi.restoreAllMocks();
  return closeAll();
});

async function withData(company: string) {
  const { db } = await dbWithAccount();
  const id = await createApplication(db, { company, companyKey: company.toLowerCase(), role: "Analyst", roleKey: "analyst", stage: "Applied", when: "2026-10-01T00:00:00Z" });
  await saveCoverLetter(db, id, [{ id: "", heading: "", items: [{ id: "", text: "Dear team" }] }], "paste");
  return db;
}

const counts = async (db: ReturnType<typeof freshDb>) => Promise.all(db.tables.map((t) => t.count()));

describe("a failed write rolls back", () => {
  it("importAll keeps every table as it was when a later table fails to write", async () => {
    const incoming = await exportAll(await withData("Incoming"));
    const target = await withData("Existing");
    const before = await exportAll(target, new Date(0));
    vi.spyOn(target.documents, "bulkAdd").mockRejectedValue(new Error("QuotaExceededError"));
    await expect(importAll(target, incoming)).rejects.toThrow(/Quota/);
    vi.restoreAllMocks();
    expect(await exportAll(target, new Date(0))).toEqual(before);
    expect((await target.applications.toArray()).map((a) => a.company)).toEqual(["Existing"]);
  });

  it("importAllIfEmpty leaves an empty database empty", async () => {
    const incoming = await exportAll(await withData("Incoming"));
    const target = freshDb();
    vi.spyOn(target.documents, "bulkAdd").mockRejectedValue(new Error("QuotaExceededError"));
    await expect(importAllIfEmpty(target, incoming)).rejects.toThrow(/Quota/);
    vi.restoreAllMocks();
    expect((await counts(target)).every((n) => n === 0)).toBe(true);
  });
});

describe("size caps", () => {
  it("refuses a table with more rows than a real job search can have", async () => {
    const incoming = await exportAll(await withData("Incoming"));
    const row = { id: 1, kind: "block_sender", value: "a@b.co", evidence: 1, active: true, createdAt: "2026-10-01T00:00:00Z" };
    const big = { ...incoming, data: { ...incoming.data, learnedRules: Array.from({ length: MAX_ROWS + 1 }, (_, i) => ({ ...row, id: i + 1 })) } };
    const target = await withData("Existing");
    await expect(importAll(target, big)).rejects.toThrow(/too many rows/);
    expect((await target.applications.toArray()).map((a) => a.company)).toEqual(["Existing"]);
  });

  it("keeps the row cap well below 500,000 for every table but emails", () => expect(MAX_ROWS).toBeLessThanOrEqual(100_000));

  it("lets emails go far past that, to what a heavy mailbox keeps", () => expect(MAX_EMAIL_ROWS).toBeGreaterThanOrEqual(500_000));

  it("refuses more email rows than that", async () => {
    const { data } = await exportAll(await withData("Incoming"));
    await expect(importAll(freshDb(), { ...(await exportAll(await withData("X"))), data: { ...data, emails: Array.from({ length: MAX_EMAIL_ROWS + 1 }, () => ({})) } }))
      .rejects.toThrow(/"emails" has too many rows/);
  });

  it("accepts a large but real export: 60,000 emails (mostly stubs, some with text) fit the file cap and the row cap", async () => {
    const { data } = await exportAll(await withData("Incoming"));
    const accountId = data.accounts[0].id;
    const stub = (i: number) => ({ id: i, accountId, providerMsgId: `18f3a9c0b7d2e${i.toString(16).padStart(6, "0")}`, threadId: null, receivedAt: "2026-10-01T09:00:00.000Z",
      sender: null, subject: null, body: null, related: false, event: null, confidence: null, applicationId: null, needsReview: false, webLink: null, bulk: false, hold: false, reason: null });
    const full = (i: number) => ({ ...stub(i), threadId: `18f3a9c0b7d2e${i.toString(16).padStart(6, "0")}`, sender: "Acme Careers <no-reply@greenhouse.io>", subject: "Thank you for applying to Acme",
      body: "x".repeat(4096), related: true, event: "applied", confidence: "high", webLink: "https://mail.google.com/mail/u/0/#all/18f3a9c0b7d2e", reason: "applied: thank you for applying" });
    const emails = Array.from({ length: 60_000 }, (_, i) => (i % 10 === 0 ? full(i + 1) : stub(i + 1)));
    const bytes = JSON.stringify({ ...data, emails }).length;
    expect(bytes).toBeLessThan(MAX_IMPORT_BYTES);
    const parsed = parseExportData({ ...data, emails });
    expect(parsed.emails).toHaveLength(60_000);
  });

  it("refuses to read a file over the size cap, before reading it", () => {
    const text = vi.fn();
    const huge = { size: MAX_IMPORT_BYTES + 1, text } as unknown as Blob;
    expect(() => readFileText(huge)).toThrow(ImportError);
    expect(text).not.toHaveBeenCalled();
  });
});

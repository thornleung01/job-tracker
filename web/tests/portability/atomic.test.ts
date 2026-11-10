// An import that passes validation but fails while it is being written must leave the old data exactly as it was.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportError, MAX_IMPORT_BYTES, exportAll, importAll, importAllIfEmpty } from "../../src/portability";
import { MAX_ROWS } from "../../src/portability/validate";
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

  it("keeps the row cap well below 500,000", () => expect(MAX_ROWS).toBeLessThanOrEqual(100_000));

  it("refuses to read a file over the size cap, before reading it", () => {
    const text = vi.fn();
    const huge = { size: MAX_IMPORT_BYTES + 1, text } as unknown as Blob;
    expect(() => readFileText(huge)).toThrow(ImportError);
    expect(text).not.toHaveBeenCalled();
  });
});

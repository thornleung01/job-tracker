// A tailored resume (a resume with an applicationId) in the export file.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { ImportError, exportAllAsJson, importAll } from "../../src/portability";
import { createApplication } from "../../src/db/repo";
import { saveMaster, saveTailored, getTailored } from "../../src/sync/documents";
import { closeAll, freshDb } from "../sync/helpers";

afterEach(closeAll);

const lines = [{ id: "s1", heading: "Skills", items: [{ id: "i1", text: "SQL" }] }];
const app = (db: ReturnType<typeof freshDb>, company: string) =>
  createApplication(db, { company, companyKey: company.toLowerCase(), role: "Analyst", roleKey: "analyst", stage: "Applied", when: "2026-11-01T12:00:00Z" });

async function seeded() {
  const from = freshDb();
  await saveMaster(from, lines, "paste");
  const a = await app(from, "Acme");
  await saveTailored(from, a, lines, "ai");
  return { from, a, file: JSON.parse(await exportAllAsJson(from)) };
}

describe("tailored resumes in the export", () => {
  it("round-trips, keeping the application link, the pointer and the master with none", async () => {
    const { from, a, file } = await seeded();
    expect(file.version).toBe(3);
    const to = freshDb();
    await importAll(to, file);
    expect(await to.documents.toArray()).toEqual(await from.documents.toArray());
    expect(await to.applications.toArray()).toEqual(await from.applications.toArray());
    expect((await getTailored(to, a))!.applicationId).toBe(a);
    expect((await to.documents.toArray()).find((d) => d.master)!.applicationId).toBeNull();
  });

  it("drops an application link on the master", async () => {
    const { a, file } = await seeded();
    file.data.documents.find((d: { master: boolean }) => d.master).applicationId = a;
    const to = freshDb();
    await importAll(to, file);
    expect((await to.documents.toArray()).find((d) => d.master)!.applicationId).toBeNull();
  });

  it("refuses a tailored resume for an application that isn't in the file", async () => {
    const { file } = await seeded();
    file.data.documents.find((d: { master: boolean }) => !d.master).applicationId = 999;
    await expect(importAll(freshDb(), file)).rejects.toThrow(/applicationId 999 is not in applications/);
  });

  it("refuses a second live tailored resume for one application, but allows a deleted one", async () => {
    const { a, file } = await seeded();
    const tailored = file.data.documents.find((d: { master: boolean }) => !d.master);
    const extra = { ...tailored, id: 99, title: "Another" };
    file.data.documents.push(extra);
    const error = await importAll(freshDb(), file).catch((e) => e);
    expect(error).toBeInstanceOf(ImportError);
    expect(String(error.problems?.join(" ") ?? error.message)).toContain(`more than one tailored resume for application ${a}`);
    extra.deletedAt = "2026-11-02T00:00:00.000Z";
    const to = freshDb();
    await importAll(to, file);
    expect(await to.documents.count()).toBe(3);
  });
});

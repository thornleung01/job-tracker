import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { EXPORT_VERSION, exportAll, exportAllAsJson, importAll, importFromPythonExport } from "../../src/portability";
import { addApplication } from "../../src/sync/actions";
import { closeAll, freshDb } from "../sync/helpers";
import fixture from "../fixtures/python-export.json";

afterEach(closeAll);

const NOW = new Date("2026-10-10T15:00:00Z");

async function withLinks() {
  const db = freshDb();
  await addApplication(db, { company: "Acme", role: "Analyst", url: "https://boards.greenhouse.io/acme/jobs/1" }, NOW);
  await addApplication(db, { company: "Beta", role: "Engineer" }, NOW);
  return db;
}

describe("export format version 2", () => {
  it("is version 2 and carries the link on the applications that have one", async () => {
    const db = await withLinks();
    const file = await exportAll(db, NOW);
    expect(EXPORT_VERSION).toBe(2);
    expect(file.version).toBe(2);
    expect(file.data.applications.map((a) => a.postingUrl)).toEqual(["https://boards.greenhouse.io/acme/jobs/1", undefined]);
  });

  it("round-trips through JSON text", async () => {
    const db = await withLinks();
    const copy = freshDb();
    await importAll(copy, await exportAllAsJson(db, NOW));
    expect(await exportAll(copy, NOW)).toEqual(await exportAll(db, NOW));
    expect((await copy.applications.toArray()).map((a) => a.postingUrl)).toEqual(["https://boards.greenhouse.io/acme/jobs/1", undefined]);
  });

  it("still reads a version 1 file, which has no link", async () => {
    const db = await withLinks();
    const v1 = JSON.parse(await exportAllAsJson(db, NOW));
    v1.version = 1;
    for (const a of v1.data.applications) delete a.postingUrl;
    const copy = freshDb();
    const summary = await importAll(copy, v1);
    expect(summary.applications).toBe(2);
    for (const a of await copy.applications.toArray()) expect("postingUrl" in a).toBe(false);
  });

  it("refuses a version newer than 2", async () => {
    const db = await withLinks();
    const x = JSON.parse(await exportAllAsJson(db, NOW));
    x.version = 3;
    await expect(importAll(freshDb(), x)).rejects.toThrow(/version 3/);
  });
});

describe("a hostile link in an imported file", () => {
  const hostile = [
    "javascript:alert(document.cookie)", "data:text/html,<script>alert(1)</script>", "https://user:pw@example.com/x", "ftp://example.com/x",
    "https://example.com/" + "a".repeat(600), 42, { href: "https://example.com" }, ["https://example.com"], "  ", "<img src=x onerror=alert(1)>",
  ];

  it("is dropped, without failing the import or touching the rest of the row", async () => {
    const db = await withLinks();
    const file = JSON.parse(await exportAllAsJson(db, NOW));
    for (const bad of hostile) {
      file.data.applications[0].postingUrl = bad;
      const copy = freshDb();
      const summary = await importAll(copy, file);
      expect(summary.applications).toBe(2);
      const row = (await copy.applications.get(1))!;
      expect("postingUrl" in row).toBe(false);
      expect(row.company).toBe("Acme");
    }
  });

  it("keeps a good link next to a dropped one, cleaned like a typed one", async () => {
    const db = await withLinks();
    const file = JSON.parse(await exportAllAsJson(db, NOW));
    file.data.applications[0].postingUrl = " https://example.com/job#apply ";
    file.data.applications[1].postingUrl = "javascript:alert(1)";
    const copy = freshDb();
    await importAll(copy, file);
    expect((await copy.applications.toArray()).map((a) => a.postingUrl)).toEqual(["https://example.com/job", undefined]);
  });
});

describe("the local edition's export with a url column", () => {
  const python = () => {
    const f = JSON.parse(JSON.stringify(fixture));
    f.tables.applications[0].url = "https://jobs.lever.co/tyrell/abc#apply";
    f.tables.applications[1].url = "javascript:alert(1)";
    f.tables.applications[2].url = "";
    // the others have no url column at all, as in an export from before the column existed
    return f;
  };

  it("reads url into the posting link and drops the dangerous one", async () => {
    const db = freshDb();
    await importFromPythonExport(db, python());
    const rows = await db.applications.orderBy("id").toArray();
    expect(rows[0].postingUrl).toBe("https://jobs.lever.co/tyrell/abc");
    for (const r of rows.slice(1)) expect("postingUrl" in r).toBe(false);
    expect(rows.every((r) => !("url" in r))).toBe(true);
  });

  it("still imports the fixture unchanged when there is no url column", async () => {
    const db = freshDb();
    await importFromPythonExport(db, fixture);
    for (const r of await db.applications.toArray()) expect("postingUrl" in r).toBe(false);
  });

  it("does not mistake a url column on another table for a posting link", async () => {
    const f = python();
    f.tables.feedback[0] && (f.tables.feedback[0].url = "https://example.com");
    const db = freshDb();
    await importFromPythonExport(db, f);
    expect(await db.applications.count()).toBe(fixture.tables.applications.length);
  });
});

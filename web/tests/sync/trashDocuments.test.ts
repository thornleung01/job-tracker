// Recently deleted with resumes and cover letters: listing, Empty, the 30-day purge, and erasing one for good.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication } from "../../src/db/repo";
import type { JobTrackerDB } from "../../src/db/schema";
import { DAY_MS } from "../../src/db/time";
import { deleteApplication } from "../../src/sync/actions";
import { createVersion, deleteDocument, restoreDocument, saveCoverLetter, setApplicationResume } from "../../src/sync/documents";
import { deleteDocumentForever, emptyTrash, listDeleted, listTrash, purgeExpired, purgeOncePerSession } from "../../src/sync/trash";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const NOW = new Date("2026-11-05T15:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
const body = [{ id: "", heading: "Experience", items: [{ id: "", text: "Built a thing" }] }];

async function app(db: JobTrackerDB, company: string, role = "Analyst"): Promise<number> {
  return createApplication(db, { company, companyKey: company.toLowerCase(), role, roleKey: role.toLowerCase(), stage: "Applied", when: "2026-11-01T12:00:00Z" });
}

/** Acme with a resume version and a cover letter, both deleted at different times, plus a deleted Beta application. */
async function seed() {
  const db = freshDb();
  const acme = await app(db, "Acme");
  const beta = await app(db, "Beta", "Engineer");
  const resume = await createVersion(db, { title: "Resume for Acme, Analyst", sections: body }, NOW);
  await setApplicationResume(db, acme, resume);
  const cover = await saveCoverLetter(db, acme, body, undefined, NOW);
  await deleteDocument(db, resume, ago(2));
  await deleteDocument(db, cover, ago(5));
  await deleteApplication(db, beta, "clear", ago(10));
  return { db, acme, beta, resume, cover };
}

describe("listTrash", () => {
  it("lists applications, resumes and cover letters together, most recently deleted first, each with its kind and days left", async () => {
    const { db } = await seed();
    const list = await listTrash(db, NOW);
    expect(list.map((e) => [e.kind, e.kind === "application" ? e.company : e.label, e.daysLeft])).toEqual([
      ["resume", "Resume for Acme, Analyst", 28], ["cover", "Acme, Analyst", 25], ["application", "Beta", 20],
    ]);
  });

  it("names a resume by its title and a cover letter by its application's company and role", async () => {
    const { db } = await seed();
    const docs = (await listTrash(db, NOW)).filter((e) => e.kind !== "application");
    expect(docs.map((e) => e.kind === "resume" ? e.label : `cover:${e.label}`)).toEqual(["Resume for Acme, Analyst", "cover:Acme, Analyst"]);
  });

  it("names a cover letter by its title when it has no role", async () => {
    const db = freshDb();
    const a = await app(db, "Acme", "");
    const cover = await saveCoverLetter(db, a, body, undefined, NOW);
    await deleteDocument(db, cover, ago(1));
    expect((await listTrash(db, NOW)).map((e) => e.kind === "cover" ? e.label : "")).toEqual(["Acme"]);
  });

  it("leaves the applications-only list as it was", async () => {
    const { db } = await seed();
    expect((await listDeleted(db, NOW)).map((e) => e.company)).toEqual(["Beta"]);
  });

  it("skips live documents", async () => {
    const db = freshDb();
    await createVersion(db, { title: "Analyst v2", sections: body }, NOW);
    expect(await listTrash(db, NOW)).toEqual([]);
  });
});

describe("emptyTrash with documents", () => {
  it("erases every kind and counts every row it listed", async () => {
    const { db, acme, resume, cover } = await seed();
    expect(await emptyTrash(db)).toBe(3);
    expect(await db.documents.get(resume)).toBeUndefined();
    expect(await db.documents.get(cover)).toBeUndefined();
    expect((await db.applications.get(acme))?.resumeId).toBeUndefined();   // erasing a resume clears the pointer
    expect(await db.applications.get(acme)).toBeDefined();                 // a live application stays
    expect(await listTrash(db, NOW)).toEqual([]);
  });

  it("leaves live documents alone", async () => {
    const { db } = await seed();
    const keep = await createVersion(db, { title: "Analyst v3", sections: body }, NOW);
    await emptyTrash(db);
    expect(await db.documents.get(keep)).toBeDefined();
  });

  it("counts a deleted cover letter once when its application is in Recently deleted too", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    const cover = await saveCoverLetter(db, a, body, undefined, NOW);
    await deleteDocument(db, cover, ago(1));
    await deleteApplication(db, a, "clear", ago(1));
    expect(await emptyTrash(db)).toBe(2);
    expect(await db.documents.count()).toBe(0);
  });
});

describe("purging after 30 days with documents", () => {
  it("erases documents that have waited 30 days and keeps younger ones", async () => {
    const { db, resume, cover } = await seed();
    // resume deleted 2 days before NOW, cover 5, Beta 10: 25 days on, the cover letter is at 30 days and Beta at 35, the resume at 27
    expect(await purgeExpired(db, new Date(NOW.getTime() + 25 * DAY_MS))).toBe(2);
    expect(await db.documents.get(cover)).toBeUndefined();
    expect(await db.documents.get(resume)).toBeDefined();
    expect(await purgeExpired(db, new Date(NOW.getTime() + 40 * DAY_MS))).toBe(1);
    expect(await db.documents.get(resume)).toBeUndefined();
  });

  it("purgeOncePerSession erases an old deleted resume once, and never throws", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    const v = await createVersion(db, { title: "Analyst v2", sections: body }, ago(40));
    await setApplicationResume(db, a, v);
    await deleteDocument(db, v, ago(31));
    await purgeOncePerSession(db, NOW);
    expect(await db.documents.get(v)).toBeUndefined();
    expect((await db.applications.get(a))?.resumeId).toBeUndefined();
  });
});

describe("deleteDocumentForever", () => {
  it("erases a deleted document and returns true", async () => {
    const { db, resume } = await seed();
    expect(await deleteDocumentForever(db, resume)).toBe(true);
    expect(await db.documents.get(resume)).toBeUndefined();
  });

  it("returns false for one that was restored or is already gone, and never touches a live one", async () => {
    const { db, resume } = await seed();
    await restoreDocument(db, resume);
    expect(await deleteDocumentForever(db, resume)).toBe(false);
    expect(await db.documents.get(resume)).toBeDefined();
    expect(await deleteDocumentForever(db, 9999)).toBe(false);
  });
});

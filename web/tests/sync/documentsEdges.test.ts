// Edge cases for documents: merging applications that both have letters, the refusals and limits in sync/documents.ts,
// and a purge where one document won't erase. The main flows are in documents.test.ts and trashDocuments.test.ts.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplication } from "../../src/db/repo";
import { MissingRecordError } from "../../src/db/errors";
import { MAX_RESUME_VERSIONS } from "../../src/db/limits";
import type { JobTrackerDB } from "../../src/db/schema";
import { DAY_MS } from "../../src/db/time";
import { deleteApplication, mergeApplications } from "../../src/sync/actions";
import {
  DocumentError, createVersion, deleteDocument, eraseDocument, getCoverLetter, listDeletedDocuments, purgeExpiredDocuments,
  restoreDocument, saveCoverLetter, setApplicationResume, setPostingText, updateDocument,
} from "../../src/sync/documents";
import { purgeExpired } from "../../src/sync/trash";
import { closeAll, freshDb } from "./helpers";

afterEach(async () => {
  vi.restoreAllMocks();
  await closeAll();
});

const NOW = new Date("2026-11-05T15:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
const text = (line: string) => [{ id: "", heading: "Experience", items: [{ id: "", text: line }] }];

async function app(db: JobTrackerDB, company: string, role = "Analyst"): Promise<number> {
  return createApplication(db, { company, companyKey: company.toLowerCase(), role, roleKey: role.toLowerCase(), stage: "Applied", when: "2026-11-01T12:00:00Z" });
}
const version = (db: JobTrackerDB, title = "Version") => createVersion(db, { title, sections: text(title) }, NOW);

describe("merging applications that have documents", () => {
  it("moves the source's live letter over a target that only has a deleted one, and the old one stays in Recently deleted", async () => {
    const db = freshDb();
    const [src, dst] = [await app(db, "Acme"), await app(db, "Acme")];
    const old = await saveCoverLetter(db, dst, text("old"), undefined, NOW);
    await deleteDocument(db, old, ago(3));
    const fresh = await saveCoverLetter(db, src, text("fresh"), undefined, NOW);
    await mergeApplications(db, src, dst, NOW);
    expect((await getCoverLetter(db, dst))!.id).toBe(fresh);
    expect((await listDeletedDocuments(db, NOW)).map((d) => [d.id, d.applicationId])).toEqual([[old, dst]]);
  });

  it("moves a deleted letter over a target with none and keeps it deleted", async () => {
    const db = freshDb();
    const [src, dst] = [await app(db, "Acme"), await app(db, "Acme")];
    const letter = await saveCoverLetter(db, src, text("x"), undefined, NOW);
    await deleteDocument(db, letter, ago(2));
    await mergeApplications(db, src, dst, NOW);
    expect(await getCoverLetter(db, dst)).toBeUndefined();
    const [row] = await listDeletedDocuments(db, NOW);
    expect([row.id, row.applicationId, row.deletedAt, row.daysLeft]).toEqual([letter, dst, "2026-11-03T15:00:00Z", 28]);
  });

  it("sends the source's live letter to Recently deleted when the target has a live one, and refuses to restore it over the target's", async () => {
    const db = freshDb();
    const [src, dst] = [await app(db, "Acme"), await app(db, "Acme")];
    const keep = await saveCoverLetter(db, dst, text("target"), undefined, NOW);
    const moved = await saveCoverLetter(db, src, text("source"), undefined, NOW);
    await mergeApplications(db, src, dst, NOW);
    expect((await getCoverLetter(db, dst))!.id).toBe(keep);
    const deleted = await listDeletedDocuments(db, NOW);
    expect(deleted.map((d) => [d.id, d.applicationId, d.daysLeft])).toEqual([[moved, dst, 30]]);
    await expect(restoreDocument(db, moved)).rejects.toThrow("That application has a newer cover letter already.");
    expect((await db.documents.get(moved))!.deletedAt).toBeTruthy();
  });

  it("adopts the source's resume and posting text when the target has neither", async () => {
    const db = freshDb();
    const [src, dst] = [await app(db, "Acme"), await app(db, "Acme")];
    const resume = await version(db);
    await setApplicationResume(db, src, resume);
    await setPostingText(db, src, "We are hiring.");
    await mergeApplications(db, src, dst, NOW);
    expect(await db.applications.get(dst)).toMatchObject({ resumeId: resume, postingText: "We are hiring." });
  });

  it("keeps the target's resume and posting text when it has its own", async () => {
    const db = freshDb();
    const [src, dst] = [await app(db, "Acme"), await app(db, "Acme")];
    const [a, b] = [await version(db, "A"), await version(db, "B")];
    await setApplicationResume(db, src, a);
    await setApplicationResume(db, dst, b);
    await setPostingText(db, src, "source text");
    await setPostingText(db, dst, "target text");
    await mergeApplications(db, src, dst, NOW);
    expect(await db.applications.get(dst)).toMatchObject({ resumeId: b, postingText: "target text" });
  });

  it("adopts a resumeId that points at a deleted resume, and restoring that resume makes it live again", async () => {
    const db = freshDb();
    const [src, dst] = [await app(db, "Acme"), await app(db, "Acme")];
    const resume = await version(db);
    await setApplicationResume(db, src, resume);
    await deleteDocument(db, resume, ago(1));
    await mergeApplications(db, src, dst, NOW);
    expect((await db.applications.get(dst))!.resumeId).toBe(resume);
    expect((await listDeletedDocuments(db, NOW)).map((d) => d.id)).toEqual([resume]);
    await restoreDocument(db, resume);
    expect((await db.documents.get(resume))!.deletedAt).toBeUndefined();
  });
});

describe("refusals", () => {
  it("deletes, updates and restores only what is there", async () => {
    const db = freshDb();
    const live = await version(db);
    const gone = await version(db, "Gone");
    await deleteDocument(db, gone, NOW);
    await expect(deleteDocument(db, 999)).rejects.toThrow(MissingRecordError);
    await expect(deleteDocument(db, gone)).rejects.toThrow(MissingRecordError);
    await expect(updateDocument(db, 999, { title: "x" })).rejects.toThrow(MissingRecordError);
    await expect(updateDocument(db, gone, { title: "x" })).rejects.toThrow(MissingRecordError);
    await expect(restoreDocument(db, 999)).rejects.toThrow(MissingRecordError);
    await expect(restoreDocument(db, live)).rejects.toThrow(/No deleted document/);
  });

  it("refuses a title-only update on a deleted document and leaves it unchanged", async () => {
    const db = freshDb();
    const id = await version(db, "Before");
    await deleteDocument(db, id, NOW);
    await expect(updateDocument(db, id, { title: "After" })).rejects.toThrow(/No document/);
    expect((await db.documents.get(id))!.title).toBe("Before");
  });

  it("allows a cover letter to be emptied but not a resume", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    const letter = await saveCoverLetter(db, a, text("x"), undefined, NOW);
    await updateDocument(db, letter, { sections: [] });
    expect((await db.documents.get(letter))!.sections).toEqual([]);
    const resume = await version(db);
    await expect(updateDocument(db, resume, { sections: [] })).rejects.toThrow("A resume needs some text.");
  });

  it("refuses to restore a resume version when all the places are taken", async () => {
    const db = freshDb();
    const first = await version(db, "First");
    await deleteDocument(db, first, NOW);
    for (let i = 0; i < MAX_RESUME_VERSIONS; i++) await version(db, `V${i}`);
    await expect(restoreDocument(db, first)).rejects.toThrow("Delete one to restore this.");
    expect((await db.documents.get(first))!.deletedAt).toBeTruthy();
  });

  it("refuses to restore a cover letter while its application is deleted", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    const letter = await saveCoverLetter(db, a, text("x"), undefined, NOW);
    await deleteDocument(db, letter, NOW);
    await deleteApplication(db, a, "clear", NOW);
    await expect(restoreDocument(db, letter)).rejects.toThrow("Restore the application first.");
  });

  it("refuses a missing application for setApplicationResume and setPostingText", async () => {
    const db = freshDb();
    const resume = await version(db);
    await expect(setApplicationResume(db, 999, resume)).rejects.toThrow(MissingRecordError);
    await expect(setApplicationResume(db, 999, null)).rejects.toThrow(MissingRecordError);
    await expect(setPostingText(db, 999, "x")).rejects.toThrow(MissingRecordError);
  });

  it("refuses an empty cover letter", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    await expect(saveCoverLetter(db, a, [])).rejects.toThrow("Write something first.");
    await expect(saveCoverLetter(db, a, [{ id: "", heading: " ", items: [{ id: "", text: "   " }] }])).rejects.toThrow(DocumentError);
    expect(await db.documents.count()).toBe(0);
  });
});

describe("limits", () => {
  it("allows the last resume version and refuses the next", async () => {
    const db = freshDb();
    for (let i = 0; i < MAX_RESUME_VERSIONS - 1; i++) await version(db, `V${i}`);
    await expect(version(db, "Last")).resolves.toBeGreaterThan(0);
    await expect(version(db, "One too many")).rejects.toThrow(`You can keep ${MAX_RESUME_VERSIONS} resume versions.`);
  });

  it("counts 30 days left on the day of deletion, and 30 (not more) for a deletion time in the future", async () => {
    const db = freshDb();
    const today = await version(db, "Today");
    const future = await version(db, "Future");
    await deleteDocument(db, today, NOW);
    await deleteDocument(db, future, new Date(NOW.getTime() + 3 * DAY_MS));
    expect((await listDeletedDocuments(db, NOW)).map((d) => [d.id, d.daysLeft]).sort()).toEqual([[today, 30], [future, 30]]);
    expect(await purgeExpiredDocuments(db, NOW)).toBe(0);
    expect(await db.documents.count()).toBe(2);
  });

  it("erasing a cover letter leaves an application alone, even one whose resumeId was edited by hand to the letter's id", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    const letter = await saveCoverLetter(db, a, text("x"), undefined, NOW);
    await db.applications.update(a, { resumeId: letter });
    await eraseDocument(db, letter);
    expect(await db.documents.get(letter)).toBeUndefined();
    expect((await db.applications.get(a))!.resumeId).toBe(letter);
  });
});

/** Makes erasing one document fail, as a storage error would. */
function failErase(db: JobTrackerDB, badId: number) {
  const real = db.documents.delete.bind(db.documents);
  return vi.spyOn(db.documents, "delete").mockImplementation(((id: number) => {
    if (id === badId) throw new Error("disk is full");
    return real(id);
  }) as never);
}

describe("a purge where one document won't erase", () => {
  it("erases the others, then throws the first error", async () => {
    const db = freshDb();
    const ids = [await version(db, "A"), await version(db, "B"), await version(db, "C")];
    for (const id of ids) await deleteDocument(db, id, ago(40));
    const spy = failErase(db, ids[0]);
    await expect(purgeExpiredDocuments(db, NOW)).rejects.toThrow("disk is full");
    spy.mockRestore();
    expect((await db.documents.toArray()).map((d) => d.id)).toEqual([ids[0]]);
  });

  it("reports the number erased once the failing one works again", async () => {
    const db = freshDb();
    const ids = [await version(db, "A"), await version(db, "B")];
    for (const id of ids) await deleteDocument(db, id, ago(40));
    const spy = failErase(db, ids[1]);
    await expect(purgeExpiredDocuments(db, NOW)).rejects.toThrow();
    spy.mockRestore();
    expect(await purgeExpiredDocuments(db, NOW)).toBe(1);
    expect(await db.documents.count()).toBe(0);
  });

  it("still erases an expired application in purgeExpired, and the error surfaces", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = freshDb();
    const a = await app(db, "Acme");
    await deleteApplication(db, a, "clear", ago(40));
    const resume = await version(db);
    await deleteDocument(db, resume, ago(40));
    const spy = failErase(db, resume);
    await expect(purgeExpired(db, NOW)).rejects.toThrow("disk is full");
    spy.mockRestore();
    expect(await db.applications.get(a)).toBeUndefined();
    expect(await db.documents.get(resume)).toBeDefined();
  });
});

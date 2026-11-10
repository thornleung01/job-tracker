// A tailored resume belongs to one application: it is not a reusable version, goes with the application, and can be promoted.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication } from "../../src/db/repo";
import { MAX_RESUME_VERSIONS } from "../../src/db/limits";
import type { JobTrackerDB } from "../../src/db/schema";
import { addApplication, deleteApplication, mergeApplications } from "../../src/sync/actions";
import { bulkSetResume } from "../../src/sync/bulk";
import { documentLine } from "../../src/sync/documentLine";
import {
  createVersion, deleteDocument, eraseDocument, getTailored, isTailored, liveDocuments, liveResumes, liveTailored, promoteTailored,
  restoreDocument, resumesForApplication, saveCoverLetter, saveMaster, saveTailored, setApplicationResume,
} from "../../src/sync/documents";
import { listApplications, tailoredPage } from "../../src/sync/queries";
import { deleteForever, emptyTrash, listTrash, restoreApplication } from "../../src/sync/trash";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const NOW = new Date("2026-11-05T15:00:00Z");
const body = (t = "Built a thing") => [{ id: "", heading: "Experience", items: [{ id: "", text: t }] }];
const app = (db: JobTrackerDB, company: string, role = "Analyst") =>
  createApplication(db, { company, companyKey: company.toLowerCase(), role, roleKey: role.toLowerCase(), stage: "Applied", when: "2026-11-01T12:00:00Z" });

describe("saveTailored", () => {
  it("creates one tailored resume, based on the master, and points the application at it", async () => {
    const db = freshDb();
    const master = await saveMaster(db, body(), "paste");
    const a = await app(db, "Acme");
    const id = await saveTailored(db, a, body("Tailored"), "ai", NOW);
    const doc = (await db.documents.get(id))!;
    expect(doc).toMatchObject({ kind: "resume", master: false, applicationId: a, title: "Resume for Acme, Analyst (tailored)", basedOn: master, source: "ai" });
    expect(isTailored(doc)).toBe(true);
    expect((await db.applications.get(a))!.resumeId).toBe(id);
    expect((await getTailored(db, a))!.id).toBe(id);
  });

  it("replaces the one it has instead of adding another", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    const first = await saveTailored(db, a, body("one"), "ai", NOW);
    const second = await saveTailored(db, a, body("two"), "ai", NOW);
    expect(second).toBe(first);
    expect(await liveTailored(db)).toHaveLength(1);
    expect((await db.documents.get(first))!.sections[0].items[0].text).toBe("two");
  });

  it("has no basedOn without a master, and refuses empty text or a missing application", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    expect("basedOn" in (await db.documents.get(await saveTailored(db, a, body(), "ai")))!).toBe(false);
    await expect(saveTailored(db, a, [], "ai")).rejects.toThrow(/text/);
    await expect(saveTailored(db, 999, body(), "ai")).rejects.toThrow();
  });

  it("never counts against the cap, and is left out of the reusable list", async () => {
    const db = freshDb();
    await saveMaster(db, body(), "paste");
    for (let i = 0; i < MAX_RESUME_VERSIONS; i++) await createVersion(db, { title: `v${i}`, sections: body() });
    const a = await app(db, "Acme");
    const t = await saveTailored(db, a, body(), "ai");
    expect((await liveResumes(db)).map((d) => d.id)).not.toContain(t);
    expect(await liveResumes(db)).toHaveLength(MAX_RESUME_VERSIONS + 1);
    expect((await liveDocuments(db)).map((d) => d.id)).toContain(t);
    await expect(createVersion(db, { title: "extra", sections: body() })).rejects.toThrow(/resume versions/);
  });
});

describe("resumesForApplication", () => {
  it("is the master, the versions, then only that application's tailored resume", async () => {
    const db = freshDb();
    const master = await saveMaster(db, body(), "paste");
    const v = await createVersion(db, { title: "v", sections: body() });
    const a = await app(db, "Acme");
    const b = await app(db, "Beta");
    const ta = await saveTailored(db, a, body(), "ai");
    const tb = await saveTailored(db, b, body(), "ai");
    expect((await resumesForApplication(db, a)).map((d) => d.id)).toEqual([master, v, ta]);
    expect((await resumesForApplication(db, b)).map((d) => d.id)).toEqual([master, v, tb]);
    expect((await liveTailored(db)).map((d) => d.id)).toEqual([ta, tb]);
  });

  it("refuses to point another application, a bulk set or a new application at someone's tailored resume", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    const b = await app(db, "Beta");
    const ta = await saveTailored(db, a, body(), "ai");
    await expect(setApplicationResume(db, b, ta)).rejects.toThrow(/another application/);
    await expect(bulkSetResume(db, [a, b], ta)).rejects.toThrow(/one application/);
    await expect(addApplication(db, { company: "Gamma", resumeId: ta })).rejects.toThrow(/one application/);
    await setApplicationResume(db, a, ta);
  });
});

describe("promoteTailored", () => {
  it("makes it a reusable version the application keeps pointing at", async () => {
    const db = freshDb();
    await saveMaster(db, body(), "paste");
    const a = await app(db, "Acme");
    const t = await saveTailored(db, a, body(), "ai");
    await promoteTailored(db, t, "  Data   roles ", NOW);
    expect(await db.documents.get(t)).toMatchObject({ applicationId: null, title: "Data roles", master: false });
    expect((await liveResumes(db)).map((d) => d.id)).toContain(t);
    expect(await getTailored(db, a)).toBeUndefined();
    expect((await db.applications.get(a))!.resumeId).toBe(t);
    expect(await saveTailored(db, a, body("again"), "ai")).not.toBe(t);
  });

  it("keeps its title without one, is refused at the cap, and refuses a document that isn't tailored", async () => {
    const db = freshDb();
    await saveMaster(db, body(), "paste");
    const a = await app(db, "Acme");
    const t = await saveTailored(db, a, body(), "ai");
    for (let i = 0; i < MAX_RESUME_VERSIONS; i++) await createVersion(db, { title: `v${i}`, sections: body() });
    await expect(promoteTailored(db, t)).rejects.toThrow(/resume versions/);
    expect((await db.documents.get(t))!.applicationId).toBe(a);
    const v = (await liveResumes(db)).find((d) => !d.master)!;
    await expect(promoteTailored(db, v.id)).rejects.toThrow();
    await deleteDocument(db, v.id);
    await promoteTailored(db, t);
    expect((await db.documents.get(t))!.title).toBe("Resume for Acme, Analyst (tailored)");
  });
});

describe("with its application", () => {
  it("stays with a deleted application, is hidden from the page, and comes back when the application is restored", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    const t = await saveTailored(db, a, body(), "ai");
    expect((await tailoredPage(db)).map((r) => r.doc.id)).toEqual([t]);
    await deleteApplication(db, a, "clear", NOW);
    expect(await tailoredPage(db)).toEqual([]);
    expect((await listTrash(db, NOW)).map((e) => e.kind)).toEqual(["application"]);
    await restoreApplication(db, a);
    expect((await tailoredPage(db)).map((r) => r.doc.id)).toEqual([t]);
    expect((await db.applications.get(a))!.resumeId).toBe(t);
  });

  it("is erased when the application is erased", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    await saveTailored(db, a, body(), "ai");
    await deleteApplication(db, a, "clear", NOW);
    await deleteForever(db, a);
    expect(await db.documents.count()).toBe(0);
    const b = await app(db, "Beta");
    await saveTailored(db, b, body(), "ai");
    await deleteApplication(db, b, "clear", NOW);
    await emptyTrash(db);
    expect(await db.documents.count()).toBe(0);
  });

  it("deleted alone goes to Recently deleted as a resume, and is restored only for a live application with no tailored resume", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    const t = await saveTailored(db, a, body("old"), "ai");
    await deleteDocument(db, t, NOW);
    expect((await listTrash(db, NOW)).map((e) => [e.kind, e.id])).toEqual([["resume", t]]);
    expect(await tailoredPage(db)).toEqual([]);
    const t2 = await saveTailored(db, a, body("new"), "ai");
    await expect(restoreDocument(db, t)).rejects.toThrow(/newer tailored resume/);
    await deleteDocument(db, t2, NOW);
    await deleteApplication(db, a, "clear", NOW);
    await expect(restoreDocument(db, t)).rejects.toThrow(/Restore the application first/);
    await restoreApplication(db, a);
    await restoreDocument(db, t);
    expect((await getTailored(db, a))!.id).toBe(t);
  });

  it("is restored even when the reusable versions are at the cap", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    const t = await saveTailored(db, a, body(), "ai");
    await deleteDocument(db, t, NOW);
    for (let i = 0; i < MAX_RESUME_VERSIONS; i++) await createVersion(db, { title: `v${i}`, sections: body() });
    await restoreDocument(db, t);
    expect((await getTailored(db, a))!.id).toBe(t);
  });

  it("erasing it un-points the application", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    const t = await saveTailored(db, a, body(), "ai");
    await eraseDocument(db, t);
    expect((await db.applications.get(a))!.resumeId).toBeUndefined();
  });
});

describe("mergeApplications", () => {
  it("keeps the target's tailored resume and sends the source's to Recently deleted", async () => {
    const db = freshDb();
    const src = await app(db, "Acme");
    const dst = await app(db, "Acme Corp");
    const ts = await saveTailored(db, src, body("src"), "ai");
    const td = await saveTailored(db, dst, body("dst"), "ai");
    await mergeApplications(db, src, dst, NOW);
    expect((await getTailored(db, dst))!.id).toBe(td);
    expect((await db.documents.get(ts))!.deletedAt).toBeTruthy();
    expect((await db.applications.get(dst))!.resumeId).toBe(td);
    expect((await listTrash(db, NOW)).map((e) => [e.kind, e.id])).toEqual([["resume", ts]]);
  });

  it("treats the cover letter and the tailored resume separately", async () => {
    const db = freshDb();
    const src = await app(db, "Acme");
    const dst = await app(db, "Acme Corp");
    const ts = await saveTailored(db, src, body(), "ai");
    const cd = await saveCoverLetter(db, dst, body());
    await mergeApplications(db, src, dst, NOW);
    expect((await getTailored(db, dst))!.id).toBe(ts);
    expect((await db.documents.get(cd))!.deletedAt).toBeUndefined();
    expect(await listTrash(db, NOW)).toEqual([]);
  });

  it("moves the source's tailored resume to a target without one, and points the target at it", async () => {
    const db = freshDb();
    const src = await app(db, "Acme");
    const dst = await app(db, "Acme Corp");
    const ts = await saveTailored(db, src, body(), "ai");
    await mergeApplications(db, src, dst, NOW);
    expect((await getTailored(db, dst))!.id).toBe(ts);
    expect((await db.applications.get(dst))!.resumeId).toBe(ts);
    expect((await resumesForApplication(db, dst)).map((d) => d.id)).toContain(ts);
  });

  it("does not point the target at a tailored resume that went to Recently deleted", async () => {
    const db = freshDb();
    const src = await app(db, "Acme");
    const dst = await app(db, "Acme Corp");
    await saveTailored(db, src, body(), "ai");
    await saveTailored(db, dst, body(), "ai");
    const { resumeId: _drop, ...rest } = (await db.applications.get(dst))!;
    await db.applications.put(rest);
    await mergeApplications(db, src, dst, NOW);
    expect((await db.applications.get(dst))!.resumeId).toBeUndefined();
  });
});

describe("what the lists show", () => {
  it("tailoredPage lists live tailored resumes of live applications, newest first, with the application", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    const b = await app(db, "Beta", "Engineer");
    const ta = await saveTailored(db, a, body(), "ai", new Date("2026-11-01T00:00:00Z"));
    const tb = await saveTailored(db, b, body(), "ai", new Date("2026-11-03T00:00:00Z"));
    expect(await tailoredPage(db)).toEqual([
      { doc: expect.objectContaining({ id: tb }), app: { id: b, company: "Beta", role: "Engineer" } },
      { doc: expect.objectContaining({ id: ta }), app: { id: a, company: "Acme", role: "Analyst" } },
    ]);
  });

  it("the application list says hasPosting and tailored", async () => {
    const db = freshDb();
    await saveMaster(db, body(), "paste");
    const a = await app(db, "Acme");
    const b = await app(db, "Beta");
    await db.applications.update(a, { postingText: "Posting" });
    await saveTailored(db, a, body(), "ai");
    const byId = new Map((await listApplications(db)).map((r) => [r.id, r]));
    expect([byId.get(a)!.hasPosting, byId.get(a)!.tailored, byId.get(b)!.hasPosting, byId.get(b)!.tailored]).toEqual([true, true, false, false]);
    expect(byId.get(a)!.resumeTitle).toBe("Resume for Acme, Analyst (tailored)");
    expect("postingText" in byId.get(a)!).toBe(false);
  });

  it("documentLine says hasPosting and tailored", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    expect(await documentLine(db, a)).toBeNull();
    await db.applications.update(a, { postingText: "Posting" });
    await saveTailored(db, a, body(), "ai");
    expect(await documentLine(db, a)).toEqual({ resume: "Resume for Acme, Analyst (tailored)", cover: false, hasPosting: true, tailored: true });
  });
});

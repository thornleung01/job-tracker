// Resumes and cover letters: storage, limits, Recently deleted, and what follows an application when it is merged or erased.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication } from "../../src/db/repo";
import { newItemId, normalizeSections, sectionsToText } from "../../src/db/documentShape";
import { MAX_DOC_ITEM_CHARS, MAX_DOC_ITEMS, MAX_DOC_SECTIONS, MAX_POSTING_CHARS, MAX_RESUME_VERSIONS } from "../../src/db/limits";
import type { JobTrackerDB } from "../../src/db/schema";
import { mergeApplications } from "../../src/sync/actions";
import {
  DocumentError, createVersion, deleteDocument, eraseDocument, getCoverLetter, getMaster, listDeletedDocuments,
  liveDocuments, purgeExpiredDocuments, restoreDocument, saveCoverLetter, saveMaster, setApplicationResume, setPostingText, updateDocument,
} from "../../src/sync/documents";
import { removeApplicationRow } from "../../src/sync/recheck";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const NOW = new Date("2026-11-05T15:00:00Z");
const text = (heading: string, ...lines: string[]) => [{ id: "", heading, items: lines.map((t) => ({ id: "", text: t })) }];

async function app(db: JobTrackerDB, company: string, role = "Analyst"): Promise<number> {
  return createApplication(db, { company, companyKey: company.toLowerCase(), role, roleKey: role.toLowerCase(), stage: "Applied", when: "2026-11-01T12:00:00Z" });
}

describe("normalizeSections", () => {
  it("trims, drops empty lines and sections, and gives every line a unique id", () => {
    const out = normalizeSections([
      { id: "a", heading: "  Experience ", items: [{ id: "x", text: " Built a thing " }, { id: "x", text: "Ran a team" }, { text: "   " }] },
      { id: "a", heading: "", items: [] },
      { heading: "Skills", items: [{ text: "SQL" }] },
    ]);
    expect(out.map((s) => s.heading)).toEqual(["Experience", "Skills"]);
    expect(out[0].items.map((i) => i.text)).toEqual(["Built a thing", "Ran a team"]);
    const ids = out.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(Boolean)).toBe(true);
    expect(out[0].id).toBe("a");
    expect(out[0].items[0].id).toBe("x");
  });

  it("cuts to the limits and never throws on junk", () => {
    expect(normalizeSections("nope")).toEqual([]);
    expect(normalizeSections([null, 3, "x", { items: "no" }])).toEqual([]);
    const long = normalizeSections([{ heading: "H", items: [{ text: "y".repeat(MAX_DOC_ITEM_CHARS + 50) }] }]);
    expect(long[0].items[0].text).toHaveLength(MAX_DOC_ITEM_CHARS);
    const many = normalizeSections(Array.from({ length: MAX_DOC_SECTIONS + 5 }, (_, i) => ({ heading: `S${i}`, items: [{ text: "a" }] })));
    expect(many).toHaveLength(MAX_DOC_SECTIONS);
    const items = normalizeSections([{ heading: "H", items: Array.from({ length: MAX_DOC_ITEMS + 5 }, (_, i) => ({ text: `l${i}` })) }]);
    expect(items[0].items).toHaveLength(MAX_DOC_ITEMS);
  });

  it("makes ids that don't repeat", () => {
    expect(new Set(Array.from({ length: 500 }, newItemId)).size).toBe(500);
  });

  it("turns sections into plain text", () => {
    expect(sectionsToText(normalizeSections(text("Skills", "SQL", "Excel")))).toBe("Skills\nSQL\nExcel");
  });
});

describe("the master resume", () => {
  it("is created once and then replaced, keeping its id", async () => {
    const db = freshDb();
    const a = await saveMaster(db, text("Experience", "Built a thing"), "paste", NOW);
    const b = await saveMaster(db, text("Experience", "Built another thing"), "upload", NOW);
    expect(b).toBe(a);
    expect((await getMaster(db))!.sections[0].items[0].text).toBe("Built another thing");
    expect(await db.documents.count()).toBe(1);
  });

  it("needs some text", async () => {
    await expect(saveMaster(freshDb(), [], "paste")).rejects.toBeInstanceOf(DocumentError);
  });

  it("can't be deleted", async () => {
    const db = freshDb();
    const id = await saveMaster(db, text("A", "b"), "paste");
    await expect(deleteDocument(db, id)).rejects.toThrow(/can't be deleted/);
  });
});

describe("resume versions", () => {
  it("stop at the limit, and a deleted one frees a place", async () => {
    const db = freshDb();
    const ids: number[] = [];
    for (let i = 0; i < MAX_RESUME_VERSIONS; i++) ids.push(await createVersion(db, { title: `v${i}`, sections: text("A", "b") }));
    await expect(createVersion(db, { title: "one more", sections: text("A", "b") })).rejects.toThrow(/5 resume versions/);
    await deleteDocument(db, ids[0], NOW);
    await expect(createVersion(db, { title: "one more", sections: text("A", "b") })).resolves.toBeGreaterThan(0);
  });

  it("are chosen for an application, and cleared with null", async () => {
    const db = freshDb();
    const v = await createVersion(db, { title: "v1", sections: text("A", "b") });
    const appId = await app(db, "Acme");
    await setApplicationResume(db, appId, v);
    expect((await db.applications.get(appId))!.resumeId).toBe(v);
    await setApplicationResume(db, appId, null);
    expect("resumeId" in (await db.applications.get(appId))!).toBe(false);
  });

  it("can't be chosen once deleted, or when it is a cover letter", async () => {
    const db = freshDb();
    const v = await createVersion(db, { title: "v1", sections: text("A", "b") });
    const appId = await app(db, "Acme");
    const letter = await saveCoverLetter(db, appId, text("", "Dear team"), "paste", NOW);
    await expect(setApplicationResume(db, appId, letter)).rejects.toBeInstanceOf(DocumentError);
    await deleteDocument(db, v, NOW);
    await expect(setApplicationResume(db, appId, v)).rejects.toBeInstanceOf(DocumentError);
  });

  it("are renamed and edited, and a resume can't be emptied", async () => {
    const db = freshDb();
    const v = await createVersion(db, { title: "v1", sections: text("A", "b") }, NOW);
    await updateDocument(db, v, { title: "  Data roles  ", sections: text("A", "c") }, NOW);
    expect(await db.documents.get(v)).toMatchObject({ title: "Data roles" });
    await expect(updateDocument(db, v, { sections: [] })).rejects.toBeInstanceOf(DocumentError);
  });
});

describe("cover letters", () => {
  it("belong to one application and are replaced, not duplicated", async () => {
    const db = freshDb();
    const appId = await app(db, "Acme");
    const a = await saveCoverLetter(db, appId, text("", "Dear team"), "paste", NOW);
    const b = await saveCoverLetter(db, appId, text("", "Hello team"), "paste", NOW);
    expect(b).toBe(a);
    expect((await getCoverLetter(db, appId))!.title).toBe("Cover letter for Acme, Analyst");
    expect(await db.documents.count()).toBe(1);
  });
});

describe("the job posting text", () => {
  it("is kept, cut to the limit, and removed when empty", async () => {
    const db = freshDb();
    const appId = await app(db, "Acme");
    await setPostingText(db, appId, `  ${"x".repeat(MAX_POSTING_CHARS + 10)}  `);
    expect((await db.applications.get(appId))!.postingText).toHaveLength(MAX_POSTING_CHARS);
    await setPostingText(db, appId, "  ");
    expect("postingText" in (await db.applications.get(appId))!).toBe(false);
  });
});

describe("Recently deleted", () => {
  it("hides a deleted document, restores it, and erases it for good", async () => {
    const db = freshDb();
    const v = await createVersion(db, { title: "v1", sections: text("A", "b") }, NOW);
    const appId = await app(db, "Acme");
    await setApplicationResume(db, appId, v);
    await deleteDocument(db, v, NOW);
    expect((await liveDocuments(db)).map((d) => d.id)).toEqual([]);
    expect((await listDeletedDocuments(db, NOW)).map((d) => [d.id, d.daysLeft])).toEqual([[v, 30]]);
    expect((await db.applications.get(appId))!.resumeId).toBe(v); // the application keeps pointing at it, so a restore puts it back
    await restoreDocument(db, v);
    expect((await liveDocuments(db)).map((d) => d.id)).toEqual([v]);
    await deleteDocument(db, v, NOW);
    await eraseDocument(db, v);
    expect(await db.documents.count()).toBe(0);
    expect("resumeId" in (await db.applications.get(appId))!).toBe(false);
  });

  it("erases what has been there 30 days and keeps the rest", async () => {
    const db = freshDb();
    const old = await createVersion(db, { title: "old", sections: text("A", "b") }, NOW);
    const recent = await createVersion(db, { title: "recent", sections: text("A", "b") }, NOW);
    await deleteDocument(db, old, new Date("2026-10-05T15:00:00Z"));
    await deleteDocument(db, recent, new Date("2026-11-04T15:00:00Z"));
    expect(await purgeExpiredDocuments(db, NOW)).toBe(1);
    expect((await db.documents.toArray()).map((d) => d.id)).toEqual([recent]);
  });

  it("won't restore a cover letter whose application is gone or has a newer one", async () => {
    const db = freshDb();
    const appId = await app(db, "Acme");
    const first = await saveCoverLetter(db, appId, text("", "one"), "paste", NOW);
    await deleteDocument(db, first, NOW);
    await saveCoverLetter(db, appId, text("", "two"), "paste", NOW);
    await expect(restoreDocument(db, first)).rejects.toThrow(/newer cover letter/);
  });
});

describe("what follows an application", () => {
  it("is erased with it: the cover letter goes, the resume versions stay", async () => {
    const db = freshDb();
    const v = await createVersion(db, { title: "v1", sections: text("A", "b") });
    const appId = await app(db, "Acme");
    await setApplicationResume(db, appId, v);
    await saveCoverLetter(db, appId, text("", "Dear team"), "paste", NOW);
    await removeApplicationRow(db, appId);
    expect((await db.documents.toArray()).map((d) => d.kind)).toEqual(["resume"]);
  });

  it("moves to the target on a merge, which keeps its own resume, posting and cover letter", async () => {
    const db = freshDb();
    const v1 = await createVersion(db, { title: "v1", sections: text("A", "b") });
    const v2 = await createVersion(db, { title: "v2", sections: text("A", "c") });
    const keep = await app(db, "Acme");
    const gone = await app(db, "Acme Corp");
    await setApplicationResume(db, keep, v1);
    await setApplicationResume(db, gone, v2);
    await setPostingText(db, gone, "the posting");
    await saveCoverLetter(db, gone, text("", "from gone"), "paste", NOW);
    await mergeApplications(db, gone, keep);
    const row = (await db.applications.get(keep))!;
    expect(row.resumeId).toBe(v1);
    expect(row.postingText).toBe("the posting");
    expect((await getCoverLetter(db, keep))!.sections[0].items[0].text).toBe("from gone");

    const other = await app(db, "Beta");
    await saveCoverLetter(db, other, text("", "from other"), "paste", NOW);
    await mergeApplications(db, keep, other);
    expect((await getCoverLetter(db, other))!.sections[0].items[0].text).toBe("from other");
  });
});

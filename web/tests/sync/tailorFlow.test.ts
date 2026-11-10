// The Resume page's last step: finding the job in Applications (strict), what saving would replace, and saving the application, the
// tailored resume and the letter together, all or nothing.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { ActionError } from "../../src/db/errors";
import type { DocSection, JobTrackerDB } from "../../src/db/schema";
import { addApplication } from "../../src/sync/actions";
import { createVersion, deleteDocument, getCoverLetter, getTailored, saveCoverLetter, saveMaster, saveTailored } from "../../src/sync/documents";
import { draftFromBaseline } from "../../src/sync/tailor";
import { existingDocs, jobMatches, saveTailoredJob } from "../../src/sync/tailorFlow";
import { markDeleted } from "../../src/sync/trash";
import { MASTER } from "../ai/tailorFixture";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const NOW = new Date("2026-11-05T15:00:00Z");
const POSTING = "Gringotts is hiring a Product Analyst to own vault reporting.";
const URL = "https://boards.greenhouse.io/gringotts/jobs/123";
const letter = (...lines: string[]): DocSection[] => [{ id: "c", heading: "", items: lines.map((text, i) => ({ id: `c${i}`, text })) }];

async function setup() {
  const db = freshDb();
  const master = await saveMaster(db, MASTER, "paste", NOW);
  const draft = { resume: MASTER, cover: letter("Dear hiring team at Gringotts,", "I'd like to apply."), baselineId: master };
  return { db, master, draft };
}
const counts = async (db: JobTrackerDB) => ({ apps: await db.applications.count(), docs: await db.documents.count() });

describe("jobMatches", () => {
  it("finds the job by its link first, then by company and role, and only live applications", async () => {
    const { db } = await setup();
    const byLink = await addApplication(db, { company: "Gringotts Bank", role: "Analyst", url: URL }, NOW);
    const byName = await addApplication(db, { company: "Gringotts", role: "Product Analyst" }, NOW);
    const gone = await addApplication(db, { company: "Gringotts", role: "Product Analyst" }, NOW);
    await markDeleted(db, gone, NOW);
    await addApplication(db, { company: "Gringotts", role: "Teller" }, NOW);
    const found = await jobMatches(db, { company: "gringotts", role: "Product analyst", url: URL });
    expect(found.map((a) => a.id)).toEqual([byLink, byName]);
    expect(found[1]).toMatchObject({ company: "Gringotts", role: "Product Analyst", stage: "Applied", appliedAt: expect.any(String) });
  });

  it("is strict: the same company with no role to compare is not a match", async () => {
    const { db } = await setup();
    await addApplication(db, { company: "Gringotts", role: "Product Analyst" }, NOW);
    expect(await jobMatches(db, { company: "Gringotts", role: "" })).toEqual([]);
    expect(await jobMatches(db, { company: "", role: "Product Analyst" })).toEqual([]);
    expect(await jobMatches(db, { company: "Hooli", role: "Product Analyst" })).toEqual([]);
  });
});

describe("existingDocs", () => {
  it("says whether saving would replace a tailored resume or a letter", async () => {
    const { db } = await setup();
    const appId = await addApplication(db, { company: "Gringotts", role: "Product Analyst" }, NOW);
    expect(await existingDocs(db, appId)).toEqual({ tailored: false, cover: false });
    await saveCoverLetter(db, appId, letter("Hello"), "paste", NOW);
    expect(await existingDocs(db, appId)).toEqual({ tailored: false, cover: true });
    await saveTailored(db, appId, MASTER, "ai", NOW);
    expect(await existingDocs(db, appId)).toEqual({ tailored: true, cover: true });
  });
});

describe("saveTailoredJob", () => {
  it("adds the application with the posting and its link, then saves the resume and the letter to it", async () => {
    const { db, master, draft } = await setup();
    const out = await saveTailoredJob(db, { draft, company: "Gringotts", role: "Product Analyst", url: URL, posting: `  ${POSTING}\r\n` }, NOW);
    expect(out.created).toBe(true);
    const app = (await db.applications.get(out.appId))!;
    expect(app).toMatchObject({ company: "Gringotts", role: "Product Analyst", stage: "Applied", postingText: POSTING, postingUrl: URL, manual: true, resumeId: out.resumeId });
    expect(await db.documents.get(out.resumeId)).toMatchObject({ kind: "resume", applicationId: out.appId, basedOn: master, source: "ai", sections: MASTER });
    expect(out.coverId).not.toBeNull();
    expect(await db.documents.get(out.coverId!)).toMatchObject({ kind: "cover", applicationId: out.appId, source: "ai" });
    expect((await getCoverLetter(db, out.appId))?.sections[0].items.map((i) => i.text)).toEqual(["Dear hiring team at Gringotts,", "I'd like to apply."]);
  });

  it("saves a hand-started draft as a copy, with no key", async () => {
    const { db, master } = await setup();
    const draft = await draftFromBaseline(db, master, "Gringotts");
    const out = await saveTailoredJob(db, { draft: { ...draft, source: "copy" }, company: "Gringotts", role: "Product Analyst", posting: POSTING }, NOW);
    expect(await db.documents.get(out.resumeId)).toMatchObject({ source: "copy", basedOn: master });
    expect((await db.documents.get(out.coverId!))?.sections[0].items.map((i) => i.text)).toEqual(["Dear hiring team at Gringotts,"]);
  });

  it("reuses the chosen application, replacing its documents, and fills only the posting and link it lacks", async () => {
    const { db, draft } = await setup();
    const appId = await addApplication(db, { company: "Gringotts", role: "Product Analyst" }, NOW);
    const oldResume = await saveTailored(db, appId, MASTER.slice(0, 1), "copy", NOW);
    const oldCover = await saveCoverLetter(db, appId, letter("Old letter"), "paste", NOW);
    const out = await saveTailoredJob(db, { draft, company: "Ignored", role: "Ignored", url: URL, posting: POSTING, useId: appId }, NOW);
    expect(out).toEqual({ appId, resumeId: oldResume, coverId: oldCover, created: false });
    expect(await db.applications.count()).toBe(1);
    expect(await db.applications.get(appId)).toMatchObject({ company: "Gringotts", postingText: POSTING, postingUrl: URL, resumeId: oldResume });
    expect((await getTailored(db, appId))?.sections).toEqual(MASTER);
    expect((await getCoverLetter(db, appId))?.sections[0].items[0].text).toBe("Dear hiring team at Gringotts,");

    // what the application already has is kept
    const other = await addApplication(db, { company: "Hooli", role: "Analyst", url: "https://hooli.example/jobs/1", postingText: "Hooli's own posting." }, NOW);
    await saveTailoredJob(db, { draft, company: "Hooli", role: "Analyst", url: URL, posting: POSTING, useId: other }, NOW);
    expect(await db.applications.get(other)).toMatchObject({ postingText: "Hooli's own posting.", postingUrl: "https://hooli.example/jobs/1" });
  });

  it("keeps an existing letter when the draft has none, and saves none for an empty one", async () => {
    const { db, draft } = await setup();
    const appId = await addApplication(db, { company: "Gringotts", role: "Product Analyst" }, NOW);
    const kept = await saveCoverLetter(db, appId, letter("Keep me"), "paste", NOW);
    expect((await saveTailoredJob(db, { draft: { ...draft, cover: null }, company: "", role: "", posting: POSTING, useId: appId }, NOW)).coverId).toBeNull();
    expect((await db.documents.get(kept))?.sections[0].items[0].text).toBe("Keep me");
    const fresh = await saveTailoredJob(db, { draft: { ...draft, cover: letter(" ", "") }, company: "Hooli", role: "Analyst", posting: POSTING }, NOW);
    expect(fresh.coverId).toBeNull();
    expect(await getCoverLetter(db, fresh.appId)).toBeUndefined();
  });

  it("refuses a deleted or unknown application with a plain sentence, and saves nothing", async () => {
    const { db, draft } = await setup();
    const appId = await addApplication(db, { company: "Gringotts", role: "Product Analyst" }, NOW);
    await markDeleted(db, appId, NOW);
    const before = await counts(db);
    for (const useId of [appId, 9999]) {
      const err = await saveTailoredJob(db, { draft, company: "Gringotts", role: "Product Analyst", posting: POSTING, useId }, NOW).catch((e) => e);
      expect(err).toBeInstanceOf(ActionError);
      expect(err.message).toBe("That application isn't there any more.");
    }
    expect(await counts(db)).toEqual(before);
  });

  it("adds no application when the resume can't be saved (a gone baseline, an empty resume, a bad link)", async () => {
    const { db, draft } = await setup();
    const version = await createVersion(db, { title: "Old", sections: MASTER }, NOW);
    await deleteDocument(db, version, NOW);
    const before = await counts(db);
    const input = { company: "Gringotts", role: "Product Analyst", posting: POSTING };
    await expect(saveTailoredJob(db, { ...input, draft: { ...draft, baselineId: version } }, NOW)).rejects.toMatchObject({ message: "That resume isn't there any more." });
    await expect(saveTailoredJob(db, { ...input, draft: { ...draft, resume: [] } }, NOW)).rejects.toBeInstanceOf(ActionError);
    await expect(saveTailoredJob(db, { ...input, url: "javascript:alert(1)", draft }, NOW)).rejects.toBeInstanceOf(ActionError);
    expect(await counts(db)).toEqual(before);
  });

  it("refuses a bad link for a reused application too, even one that keeps its own, and changes nothing", async () => {
    const { db, draft } = await setup();
    const bare = await addApplication(db, { company: "Gringotts", role: "Product Analyst" }, NOW);
    const linked = await addApplication(db, { company: "Hooli", role: "Analyst", url: "https://hooli.example/jobs/1" }, NOW);
    const before = await counts(db);
    for (const useId of [bare, linked]) {
      const err = await saveTailoredJob(db, { draft, company: "x", role: "y", url: "linkedin.com/jobs/123", posting: POSTING, useId }, NOW).catch((e) => e);
      expect(err).toBeInstanceOf(ActionError);
      expect(err.message).toBe("That link doesn't look right. Use a web address that starts with https://.");
    }
    expect(await counts(db)).toEqual(before);
    expect((await db.applications.get(bare))?.postingText).toBeUndefined();
  });

  it("rolls everything back when the last write fails", async () => {
    const { db, draft } = await setup();
    const used = await addApplication(db, { company: "Hooli", role: "Analyst" }, NOW);
    const before = { ...(await counts(db)), app: await db.applications.get(used) };
    // the letter is the last write: make it fail after the application and the resume were written
    db.documents.hook("creating", (_key, doc) => {
      if (doc.kind === "cover") throw new Error("disk full");
    });
    await expect(saveTailoredJob(db, { draft, company: "Gringotts", role: "Product Analyst", url: URL, posting: POSTING }, NOW)).rejects.toThrow("disk full");
    await expect(saveTailoredJob(db, { draft, company: "Hooli", role: "Analyst", url: URL, posting: POSTING, useId: used }, NOW)).rejects.toThrow("disk full");
    expect({ ...(await counts(db)), app: await db.applications.get(used) }).toEqual(before);
    expect(await db.applications.where("companyKey").equals("gringotts").count()).toBe(0);
    expect(await getTailored(db, used)).toBeUndefined();
  });
});

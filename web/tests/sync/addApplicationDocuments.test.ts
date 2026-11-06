// Logging an application can carry the job posting's text and the resume sent.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_POSTING_CHARS } from "../../src/db/limits";
import { ActionError, addApplication } from "../../src/sync/actions";
import { createVersion, deleteDocument, saveMaster } from "../../src/sync/documents";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const sections = [{ heading: "Skills", items: [{ text: "SQL" }] }];

describe("addApplication with postingText and resumeId", () => {
  it("saves the posting text, trimmed and cut to the limit", async () => {
    const db = freshDb();
    const id = await addApplication(db, { company: "Acme", postingText: `  ${"x".repeat(MAX_POSTING_CHARS + 50)}  ` });
    expect((await db.applications.get(id))!.postingText).toHaveLength(MAX_POSTING_CHARS);
    const blank = await addApplication(db, { company: "Beta", postingText: "   " });
    expect(await db.applications.get(blank)).not.toHaveProperty("postingText");
  });

  it("points the application at a live resume", async () => {
    const db = freshDb();
    const master = await saveMaster(db, sections, "paste");
    const version = await createVersion(db, { title: "Analyst", sections, basedOn: master });
    const id = await addApplication(db, { company: "Acme", resumeId: version });
    expect((await db.applications.get(id))!.resumeId).toBe(version);
  });

  it("refuses a resume that is deleted or isn't a resume, and saves nothing", async () => {
    const db = freshDb();
    const master = await saveMaster(db, sections, "paste");
    const version = await createVersion(db, { title: "Analyst", sections, basedOn: master });
    await deleteDocument(db, version);
    await expect(addApplication(db, { company: "Acme", resumeId: version })).rejects.toBeInstanceOf(ActionError);
    await expect(addApplication(db, { company: "Acme", resumeId: 9999 })).rejects.toBeInstanceOf(ActionError);
    expect(await db.applications.count()).toBe(0);
  });
});

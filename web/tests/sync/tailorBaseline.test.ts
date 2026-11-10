// Tailoring from a baseline: a chosen version instead of the master, lines that keep their baseline ids, starting a copy by hand, and basedOn.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL, type AiDeps, type AiRequest, type Vault, type VaultStatus } from "../../src/ai";
import { compareToBaseline } from "../../src/documents/compare";
import { createApplication } from "../../src/db/repo";
import { MAX_RESUME_VERSIONS } from "../../src/db/limits";
import type { JobTrackerDB } from "../../src/db/schema";
import {
  baselineChoices, createVersion, deleteDocument, getTailored, liveResumes, saveMaster, saveTailored, setPostingText, startTailoredFromBaseline,
} from "../../src/sync/documents";
import { TailorError, saveTailorDraft, tailorForApplication } from "../../src/sync/tailor";
import { MASTER, goodReply } from "../ai/tailorFixture";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const NOW = new Date("2026-11-05T15:00:00Z");
const app = (db: JobTrackerDB, company = "Acme Corp") =>
  createApplication(db, { company, companyKey: company.toLowerCase(), role: "Data Analyst", roleKey: "data analyst", stage: "Applied", when: "2026-11-01T12:00:00Z" });

function deps(json: unknown) {
  const status: VaultStatus = { state: "unlocked", last4: "test", model: DEFAULT_MODEL };
  const vault = { status: () => status, key: () => "sk-ant-test", save: vi.fn(), unlock: vi.fn(), lock: vi.fn(), setModel: vi.fn(), forget: vi.fn() } as unknown as Vault;
  const complete = vi.fn(async (_k: string, _r: AiRequest, _o?: { signal?: AbortSignal }) => ({ json, model: "m" }));
  return { ai: { vault, complete } satisfies AiDeps, complete };
}

describe("startTailoredFromBaseline", () => {
  it("copies the master keeping every id, marks it a copy based on it, and points the application at it", async () => {
    const db = freshDb();
    const master = await saveMaster(db, MASTER, "paste", NOW);
    const a = await app(db);
    const id = await startTailoredFromBaseline(db, a, master, NOW);
    const doc = (await db.documents.get(id))!;
    expect(doc).toMatchObject({ kind: "resume", master: false, applicationId: a, source: "copy", basedOn: master, title: "Resume for Acme Corp, Data Analyst (tailored)" });
    expect(doc.sections).toEqual(MASTER);
    expect((await db.applications.get(a))?.resumeId).toBe(id);
    expect(await getTailored(db, a)).toMatchObject({ id });
    // untouched, so every line compares as the same
    const { lines, leftOut } = compareToBaseline(doc.sections, MASTER);
    expect(Object.values(lines).every((l) => l.status === "same")).toBe(true);
    expect(leftOut).toEqual([]);
  });

  it("can start from a reusable version, and a copy is not one of the versions or counted toward the cap", async () => {
    const db = freshDb();
    await saveMaster(db, MASTER, "paste", NOW);
    const version = await createVersion(db, { title: "Data", sections: MASTER.slice(0, 2) }, NOW);
    const a = await app(db);
    const id = await startTailoredFromBaseline(db, a, version, NOW);
    expect((await db.documents.get(id))?.basedOn).toBe(version);
    expect((await liveResumes(db)).map((d) => d.id)).not.toContain(id);
    for (let n = 1; n < MAX_RESUME_VERSIONS; n++) await createVersion(db, { title: `v${n}`, sections: MASTER }, NOW);
    await expect(createVersion(db, { title: "one too many", sections: MASTER }, NOW)).rejects.toThrow(/resume versions/);
  });

  it("doesn't share the baseline's objects, so editing the copy leaves the baseline alone", async () => {
    const db = freshDb();
    const master = await saveMaster(db, MASTER, "paste", NOW);
    const a = await app(db);
    const id = await startTailoredFromBaseline(db, a, master, NOW);
    const copy = (await db.documents.get(id))!;
    copy.sections[1].items[0].text = "Edited";
    await db.documents.put(copy);
    expect((await db.documents.get(master))!.sections[1].items[0].text).toBe(MASTER[1].items[0].text);
  });

  it("refuses when the application already has a tailored resume, keeping it", async () => {
    const db = freshDb();
    const master = await saveMaster(db, MASTER, "paste", NOW);
    const a = await app(db);
    const first = await startTailoredFromBaseline(db, a, master, NOW);
    await expect(startTailoredFromBaseline(db, a, master, NOW)).rejects.toThrow("This application already has a tailored resume.");
    expect((await getTailored(db, a))?.id).toBe(first);
    expect(await db.documents.count()).toBe(2);
  });

  it("refuses a deleted baseline, a cover letter, a missing one, and another application's tailored resume", async () => {
    const db = freshDb();
    await saveMaster(db, MASTER, "paste", NOW);
    const version = await createVersion(db, { title: "Old", sections: MASTER }, NOW);
    const a = await app(db);
    const b = await app(db, "Globex");
    await deleteDocument(db, version, NOW);
    await expect(startTailoredFromBaseline(db, a, version, NOW)).rejects.toThrow(/isn't there any more/);
    await expect(startTailoredFromBaseline(db, a, 9999, NOW)).rejects.toThrow(/isn't there any more/);
    const cover = await db.documents.add({ kind: "cover", master: false, applicationId: a, title: "Cover letter", sections: MASTER, createdAt: "x", updatedAt: "x" });
    await expect(startTailoredFromBaseline(db, a, cover, NOW)).rejects.toThrow(/isn't there any more/);
    const theirs = await saveTailored(db, b, MASTER, "ai", NOW);
    await expect(startTailoredFromBaseline(db, a, theirs, NOW)).rejects.toThrow("That resume was tailored for another application.");
    expect(await getTailored(db, a)).toBeUndefined();
  });
});

describe("baselineChoices", () => {
  it("lists the master first, then the live versions oldest first, never a tailored copy, a cover letter or a deleted one", async () => {
    const db = freshDb();
    const v1 = await createVersion(db, { title: "One", sections: MASTER }, NOW);
    const master = await saveMaster(db, MASTER, "paste", NOW);
    const v2 = await createVersion(db, { title: "Two", sections: MASTER }, NOW);
    const gone = await createVersion(db, { title: "Gone", sections: MASTER }, NOW);
    await deleteDocument(db, gone, NOW);
    const a = await app(db);
    await saveTailored(db, a, MASTER, "ai", NOW);
    await db.documents.add({ kind: "cover", master: false, applicationId: a, title: "Cover letter", sections: MASTER, createdAt: "x", updatedAt: "x" });
    const rows = [...(await db.documents.toArray())].reverse();
    expect(baselineChoices(rows).map((d) => d.id)).toEqual([master, v1, v2]);
    expect(baselineChoices(rows).map((d) => d.id)).toEqual((await liveResumes(db)).map((d) => d.id));
  });
});

describe("saveTailored basedOn", () => {
  it("defaults to the master, and records the baseline when given", async () => {
    const db = freshDb();
    const master = await saveMaster(db, MASTER, "paste", NOW);
    const version = await createVersion(db, { title: "V", sections: MASTER }, NOW);
    const a = await app(db);
    const b = await app(db, "Globex");
    expect((await db.documents.get(await saveTailored(db, a, MASTER, "ai", NOW)))?.basedOn).toBe(master);
    expect((await db.documents.get(await saveTailored(db, b, MASTER, "ai", NOW, version)))?.basedOn).toBe(version);
  });

  it("keeps the baseline of a copy it replaces unless a new one is given", async () => {
    const db = freshDb();
    await saveMaster(db, MASTER, "paste", NOW);
    const version = await createVersion(db, { title: "V", sections: MASTER }, NOW);
    const a = await app(db);
    const id = await saveTailored(db, a, MASTER, "ai", NOW, version);
    await saveTailored(db, a, MASTER, "ai", NOW);
    expect((await db.documents.get(id))?.basedOn).toBe(version);
    await saveTailored(db, a, MASTER, "ai", NOW, (await liveResumes(db))[0].id);
    expect((await db.documents.get(id))?.basedOn).not.toBe(version);
  });

  it("refuses a baseline that is deleted, missing, a cover letter or tailored, and saves nothing", async () => {
    const db = freshDb();
    await saveMaster(db, MASTER, "paste", NOW);
    const version = await createVersion(db, { title: "V", sections: MASTER }, NOW);
    const a = await app(db);
    const b = await app(db, "Globex");
    const theirs = await saveTailored(db, b, MASTER, "ai", NOW);
    await deleteDocument(db, version, NOW);
    for (const bad of [version, theirs, 9999]) {
      await expect(saveTailored(db, a, MASTER, "ai", NOW, bad)).rejects.toThrow("That resume isn't there any more.");
    }
    expect(await getTailored(db, a)).toBeUndefined();
  });

  it("has no basedOn when there is no master and none is given", async () => {
    const db = freshDb();
    const a = await app(db);
    expect((await db.documents.get(await saveTailored(db, a, MASTER, "ai", NOW)))?.basedOn).toBeUndefined();
  });
});

describe("tailorForApplication with a baseline", () => {
  const VERSION = MASTER.map((s) => (s.id === "sec-s" ? { ...s, items: [{ id: "sum1", text: "Analyst focused on reporting." }] } : s));
  async function setup() {
    const db = freshDb();
    const master = await saveMaster(db, MASTER, "paste", NOW);
    const version = await createVersion(db, { title: "Reporting", sections: VERSION }, NOW);
    const a = await app(db);
    await setPostingText(db, a, "Acme needs a data analyst who can report weekly.");
    return { db, a, master, version };
  }

  it("reads the chosen version instead of the master, and says which baseline it used", async () => {
    const { db, a, master, version } = await setup();
    const d = deps(goodReply());
    const draft = await tailorForApplication(db, a, d, { baselineId: version });
    expect(draft.baselineId).toBe(version);
    expect(d.complete.mock.calls[0][1].user).toContain("Analyst focused on reporting.");
    const plain = await tailorForApplication(db, a, deps(goodReply()));
    expect(plain.baselineId).toBe(master);
  });

  it("saves with the baseline as basedOn, and a saved draft compares to its baseline", async () => {
    const { db, a, version } = await setup();
    const draft = await tailorForApplication(db, a, deps(goodReply()), { baselineId: version });
    const { resumeId } = await saveTailorDraft(db, a, { resume: draft.resume, cover: draft.cover, baselineId: draft.baselineId }, NOW);
    const saved = (await db.documents.get(resumeId))!;
    expect(saved.basedOn).toBe(version);
    const { lines } = compareToBaseline(saved.sections, VERSION);
    expect(lines.sum1.status).toBe("changed");
    expect(lines.b2.status).toBe("same");
    expect(lines.k1.status).toBe("changed");
  });

  it("gives a line that maps one-to-one its baseline id, and keeps ids unique when the model repeats a source or merges lines", async () => {
    const { db, a } = await setup();
    const r = goodReply();
    r.jobs[0].bullets.push({ sourceId: "b2", label: "Reporting", text: "Automated the weekly report and saved 500 hours a year." });
    const draft = await tailorForApplication(db, a, deps(r));
    const all = draft.resume.flatMap((s) => s.items.map((i) => i.id));
    expect(new Set(all).size).toBe(all.length);
    expect(draft.lines.every((l) => all.includes(l.id))).toBe(true);
    expect(draft.lines.filter((l) => l.sourceId === "b2").map((l) => l.id).filter((id) => id === "b2")).toHaveLength(1);
  });

  it("doesn't give a multi-line summary the id of one of its lines", async () => {
    const db = freshDb();
    const two = MASTER.map((s) => (s.id === "sec-s" ? { ...s, items: [...s.items, { id: "sum2", text: "Also mentors two juniors." }] } : s));
    await saveMaster(db, two, "paste", NOW);
    const a = await app(db);
    await setPostingText(db, a, "Acme needs a data analyst who can report weekly.");
    const draft = await tailorForApplication(db, a, deps(goodReply()));
    const summary = draft.lines.find((l) => l.sourceId === "sum1")!;
    expect(summary.sourceIds).toEqual(["sum1", "sum2"]);
    expect(["sum1", "sum2"]).not.toContain(summary.id);
  });

  it("refuses a baseline that is deleted, tailored, a cover letter or missing, and still needs a master by default", async () => {
    const { db, a, version } = await setup();
    const own = await saveTailored(db, a, MASTER, "ai", NOW);
    await expect(tailorForApplication(db, a, deps(goodReply()), { baselineId: own })).rejects.toThrow(TailorError);
    await expect(tailorForApplication(db, a, deps(goodReply()), { baselineId: 9999 })).rejects.toThrow(/isn't there any more/);
    await deleteDocument(db, version, NOW);
    await expect(tailorForApplication(db, a, deps(goodReply()), { baselineId: version })).rejects.toThrow(/isn't there any more/);
    const empty = freshDb();
    const b = await app(empty);
    await setPostingText(empty, b, "A posting.");
    await expect(tailorForApplication(empty, b, deps(goodReply()))).rejects.toThrow("Add your master resume first.");
  });
});

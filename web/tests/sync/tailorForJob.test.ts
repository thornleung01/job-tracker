// Tailoring for a pasted job that isn't an application yet, and "Start by hand" from a baseline with no AI.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError, DEFAULT_MODEL, type AiDeps, type AiRequest, type Vault, type VaultStatus } from "../../src/ai";
import { createVersion, deleteDocument, saveMaster, saveTailored } from "../../src/sync/documents";
import { TailorError, draftFromBaseline, tailorForJob } from "../../src/sync/tailor";
import { createApplication } from "../../src/db/repo";
import { MASTER, goodReply } from "../ai/tailorFixture";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const NOW = new Date("2026-11-05T15:00:00Z");
const JOB = { company: "Acme Corp", role: "Data Analyst", posting: "Acme needs a data analyst who can report weekly." };

function deps(json: unknown, key: string | null = "sk-ant-test") {
  const status: VaultStatus = key ? { state: "unlocked", last4: "test", model: DEFAULT_MODEL } : { state: "none" };
  const vault = { status: () => status, key: () => key, save: vi.fn(), unlock: vi.fn(), lock: vi.fn(), setModel: vi.fn(), forget: vi.fn() } as unknown as Vault;
  const complete = vi.fn(async (_k: string, _r: AiRequest, _o?: { signal?: AbortSignal }) => ({ json, model: "m" }));
  return { ai: { vault, complete } satisfies AiDeps, complete };
}
const itemsOf = (sections: { items: { id: string; text: string }[] }[]) => sections.flatMap((s) => s.items);

describe("tailorForJob", () => {
  it("tailors with no application, greets the company's hiring team, and saves nothing", async () => {
    const db = freshDb();
    await saveMaster(db, MASTER, "paste", NOW);
    const d = deps(goodReply());
    const draft = await tailorForJob(db, JOB, d, { tone: "formal" });
    const user = JSON.parse(d.complete.mock.calls[0][1].user);
    expect(user).toMatchObject({ task: "tailor", tone: "formal", job: { company: "Acme Corp", role: "Data Analyst", posting: JOB.posting } });
    expect(draft.cover[0].items.map((i) => i.text)).toEqual(["Dear hiring team at Acme Corp,", ...goodReply().cover.paragraphs]);
    expect(draft.lines.map((l) => l.id)).toEqual(["sum1", "k2", "k1", "b2", "b1", "b4"]);
    expect(await db.documents.count()).toBe(1);
    expect(await db.applications.count()).toBe(0);
  });

  it("greets the people it is given, and the plain hiring team when none of them can be greeted", async () => {
    const db = freshDb();
    await saveMaster(db, MASTER, "paste", NOW);
    const jane = await tailorForJob(db, { ...JOB, people: [{ name: "Jane Doe", kind: "recruiter", mentionedOnly: false }] }, deps(goodReply()));
    expect(jane.cover[0].items[0].text).toBe("Dear Jane,");
    const nobody = await tailorForJob(db, { ...JOB, people: [] }, deps(goodReply()));
    expect(nobody.cover[0].items[0].text).toBe("Dear hiring team,");
  });

  it("tailors from the baseline it is given, from the job or the options", async () => {
    const db = freshDb();
    await saveMaster(db, MASTER, "paste", NOW);
    const version = await createVersion(db, { title: "Analytics", sections: MASTER }, NOW);
    expect((await tailorForJob(db, { ...JOB, baselineId: version }, deps(goodReply()))).baselineId).toBe(version);
    expect((await tailorForJob(db, JOB, deps(goodReply()), { baselineId: version })).baselineId).toBe(version);
  });

  it("refuses with a plain sentence: no master, a gone baseline, no company, no posting, no key", async () => {
    const db = freshDb();
    const d = deps(goodReply());
    await expect(tailorForJob(db, JOB, d)).rejects.toMatchObject({ name: "TailorError", message: "Add your master resume first." });
    await saveMaster(db, MASTER, "paste", NOW);
    const version = await createVersion(db, { title: "Old", sections: MASTER }, NOW);
    await deleteDocument(db, version, NOW);
    await expect(tailorForJob(db, { ...JOB, baselineId: version }, d)).rejects.toMatchObject({ message: "That resume isn't there any more." });
    await expect(tailorForJob(db, { ...JOB, company: "  " }, d)).rejects.toMatchObject({ name: "TailorError", message: "Enter a company name." });
    await expect(tailorForJob(db, { ...JOB, posting: " \n " }, d)).rejects.toMatchObject({ name: "TailorError", message: "Add the job posting first." });
    expect(d.complete).not.toHaveBeenCalled();
    const err = await tailorForJob(db, JOB, deps(goodReply(), null)).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe("noKey");
  });
});

describe("draftFromBaseline", () => {
  it("copies the master with every id kept, starts the letter with the greeting only, and needs no key", async () => {
    const db = freshDb();
    const master = await saveMaster(db, MASTER, "paste", NOW);
    const draft = await draftFromBaseline(db, master, "Gringotts");
    expect(draft.baselineId).toBe(master);
    expect(draft.resume).toEqual(MASTER);
    expect(itemsOf(draft.resume).map((i) => i.id)).toEqual(itemsOf(MASTER).map((i) => i.id));
    expect(draft.cover).toHaveLength(1);
    expect(draft.cover[0].items.map((i) => i.text)).toEqual(["Dear hiring team at Gringotts,"]);
    expect(draft).toMatchObject({ lines: [], coverFlags: [], unused: [] });
    expect(await db.documents.count()).toBe(1);
  });

  it("copies a version, and greets the plain hiring team when there is no company yet", async () => {
    const db = freshDb();
    await saveMaster(db, MASTER, "paste", NOW);
    const version = await createVersion(db, { title: "Analytics", sections: MASTER.slice(0, 2) }, NOW);
    const draft = await draftFromBaseline(db, version, " ");
    expect(draft.resume.map((s) => s.id)).toEqual(["sec-h", "sec-s"]);
    expect(draft.cover[0].items[0].text).toBe("Dear hiring team,");
  });

  it("refuses a deleted, missing or tailored baseline", async () => {
    const db = freshDb();
    await saveMaster(db, MASTER, "paste", NOW);
    const version = await createVersion(db, { title: "Old", sections: MASTER }, NOW);
    await deleteDocument(db, version, NOW);
    const appId = await createApplication(db, { company: "Acme", companyKey: "acme", role: "Analyst", roleKey: "analyst", stage: "Applied", when: "2026-11-01T12:00:00Z" });
    const tailored = await saveTailored(db, appId, MASTER, "ai", NOW);
    for (const id of [version, 9999, tailored]) {
      const err = await draftFromBaseline(db, id, "Acme").catch((e) => e);
      expect(err).toBeInstanceOf(TailorError);
      expect(err.message).toBe("That resume isn't there any more.");
    }
  });
});

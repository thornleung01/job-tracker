// What the resume adds to the Applications list: the filter, the sort and title, bulk Set resume, search in the posting and the cover
// letter, saved views, the column setting and the CSV column. Page flows are in tests/pages/applications/resume.test.ts.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { ActionError } from "../../src/db/errors";
import type { JobTrackerDB } from "../../src/db/schema";
import { applicationsToCsv, CSV_HEADERS } from "../../src/portability/csv";
import { bulkRestoreResumes, bulkSetResume } from "../../src/sync/bulk";
import { bulkAdd } from "../../src/sync/bulkAdd";
import { createVersion, deleteDocument, eraseDocument, saveCoverLetter, saveMaster, saveTailored, setApplicationResume, setPostingText } from "../../src/sync/documents";
import { listApplications, SORT_COLUMNS, DEFAULT_DIR } from "../../src/sync/queries";
import { cleanFilters, describeFilters, loadSavedViews, sanitizeSavedViews, saveView } from "../../src/sync/savedViews";
import { searchApplications, whyMatched } from "../../src/sync/search";
import { COLUMNS, DEFAULTS, sanitize } from "../../src/sync/settings";
import { EMPTY_DRAFT } from "../../src/jobs/types";
import { addApp } from "../pages/applications/harness";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const SECTIONS = [{ heading: "Experience", items: [{ text: "Built dashboards" }] }];

/** Acme and Beta sent the master, Cora sent "Analyst v2", Dana sent nothing. */
async function seed(db: JobTrackerDB = freshDb()) {
  const master = await saveMaster(db, SECTIONS, "paste");
  const v2 = await createVersion(db, { title: "Analyst v2", sections: SECTIONS, basedOn: master, source: "copy" });
  const acme = await addApp(db, "Acme", { last: 1 });
  const beta = await addApp(db, "Beta", { last: 2 });
  const cora = await addApp(db, "Cora", { last: 3 });
  const dana = await addApp(db, "Dana", { last: 4 });
  await setApplicationResume(db, acme, master);
  await setApplicationResume(db, beta, master);
  await setApplicationResume(db, cora, v2);
  return { db, master, v2, acme, beta, cora, dana };
}
const names = (rows: { company: string }[]) => rows.map((r) => r.company);

describe("the resume filter", () => {
  it("keeps the applications that sent one version", async () => {
    const { db, master, v2 } = await seed();
    expect(names(await listApplications(db, { resume: String(master) }))).toEqual(["Acme", "Beta"]);
    expect(names(await listApplications(db, { resume: String(v2) }))).toEqual(["Cora"]);
  });

  it("keeps the applications with no resume set, including one whose resume was deleted", async () => {
    const { db, v2 } = await seed();
    expect(names(await listApplications(db, { resume: "none" }))).toEqual(["Dana"]);
    await deleteDocument(db, v2);
    expect(names(await listApplications(db, { resume: "none" }))).toEqual(["Cora", "Dana"]);
  });

  it("shows an empty list, not an error, for an id that is unknown, deleted or erased", async () => {
    const { db, v2 } = await seed();
    expect(await listApplications(db, { resume: "9999" })).toEqual([]);
    await deleteDocument(db, v2);
    expect(await listApplications(db, { resume: String(v2) })).toEqual([]);
    await eraseDocument(db, v2);
    expect(await listApplications(db, { resume: String(v2) })).toEqual([]);
  });

  it("ignores a value that is not an id, and works with the other filters", async () => {
    const { db, master } = await seed();
    expect(await listApplications(db, { resume: "abc" })).toHaveLength(4);
    expect(await listApplications(db, { resume: "-1" })).toHaveLength(4);
    expect(names(await listApplications(db, { resume: String(master), q: "beta" }))).toEqual(["Beta"]);
    expect(await listApplications(db, { resume: String(master), stage: "Interview" })).toEqual([]);
  });

  it("puts the resume's title on each row, null when there is none or it was deleted", async () => {
    const { db, v2 } = await seed();
    const by = async () => Object.fromEntries((await listApplications(db)).map((r) => [r.company, r.resumeTitle]));
    expect(await by()).toEqual({ Acme: "Master resume", Beta: "Master resume", Cora: "Analyst v2", Dana: null });
    await deleteDocument(db, v2);
    expect((await by()).Cora).toBeNull();
  });
});

describe("sorting by resume", () => {
  it("sorts by title with no resume last, whichever way", async () => {
    const { db } = await seed();
    const order = async (dir: string) => names(await listApplications(db, { sort: "resume", dir }));
    expect(await order("asc")).toEqual(["Cora", "Acme", "Beta", "Dana"]);
    expect(await order("desc")).toEqual(["Acme", "Beta", "Cora", "Dana"]);
    expect(SORT_COLUMNS).toContain("resume");
    expect(DEFAULT_DIR.resume).toBe("asc");
  });
});

describe("the Resume column setting", () => {
  it("is offered as Resume, off by default and not forced on", () => {
    expect(COLUMNS.resume).toBe("Resume");
    expect(DEFAULTS.appearance.columns).not.toContain("resume");
    expect(sanitize("appearance", { columns: ["role"] }).columns).toEqual(["company", "role", "stage"]);
    expect(sanitize("appearance", { columns: ["resume", "rounds"] }).columns).toEqual(["company", "stage", "rounds", "resume"]);
  });

  it("keeps a column list from before the column existed, such as one imported from the Python edition", () => {
    expect(sanitize("appearance", { columns: ["company", "role", "stage", "applied", "lastActivity", "emails", "rounds"] }).columns)
      .toEqual(["company", "role", "stage", "applied", "lastActivity", "emails", "rounds"]);
  });
});

describe("bulk Set resume", () => {
  it("sets one version on every live application and clears with null", async () => {
    const { db, v2, acme, beta, dana } = await seed();
    expect(await bulkSetResume(db, [acme, beta, dana], v2)).toBe(3);
    expect((await listApplications(db, { resume: String(v2) })).length).toBe(4);
    expect(await bulkSetResume(db, [acme, beta], null)).toBe(2);
    expect("resumeId" in (await db.applications.get(acme))!).toBe(false);
    expect((await db.applications.get(dana))?.resumeId).toBe(v2);
  });

  it("skips ids that are gone or deleted and counts the rest", async () => {
    const { db, v2, acme, beta } = await seed();
    await db.applications.update(beta, { deletedAt: "2026-10-01T00:00:00Z" });
    expect(await bulkSetResume(db, [acme, beta, 9999, 1.5], v2)).toBe(1);
    expect((await db.applications.get(beta))?.resumeId).not.toBe(v2);
    expect(await bulkSetResume(db, [], v2)).toBe(0);
  });

  it("with no ids returns 0 and changes nothing, whether it sets a version or clears", async () => {
    const { db, v2 } = await seed();
    const before = await db.applications.toArray();
    expect(await bulkSetResume(db, [], v2)).toBe(0);
    expect(await bulkSetResume(db, [], null)).toBe(0);
    expect(await db.applications.toArray()).toEqual(before);
  });

  it("changes only the live applications in a selection that also holds deleted ones", async () => {
    const { db, master, v2, acme, beta, cora, dana } = await seed();
    await db.applications.update(acme, { deletedAt: "2026-10-01T00:00:00Z" });
    await db.applications.update(dana, { deletedAt: "2026-10-01T00:00:00Z" });
    expect(await bulkSetResume(db, [acme, beta, cora, dana], v2)).toBe(2);
    const resume = async (id: number) => (await db.applications.get(id))?.resumeId;
    expect([await resume(acme), await resume(beta), await resume(cora), await resume(dana)]).toEqual([master, v2, v2, undefined]);
    expect(await bulkSetResume(db, [acme, beta, dana], null)).toBe(1);
    expect([await resume(acme), await resume(beta)]).toEqual([master, undefined]);
  });

  it("refuses a resume that is deleted, gone or not a resume, and changes nothing", async () => {
    const { db, v2, acme } = await seed();
    const cover = await saveCoverLetter(db, acme, [{ heading: "", items: [{ text: "Dear team" }] }]);
    await deleteDocument(db, v2);
    for (const id of [v2, 9999, cover]) await expect(bulkSetResume(db, [acme], id)).rejects.toThrow(ActionError);
    expect((await db.applications.get(acme))?.resumeId).not.toBeUndefined();
  });

  it("puts every row's own previous value back, including none", async () => {
    const { db, master, v2, acme, cora, dana } = await seed();
    const before = [acme, cora, dana].map((id) => ({ id, resumeId: ((id === acme ? master : id === cora ? v2 : null)) }));
    await bulkSetResume(db, [acme, cora, dana], master);
    expect(await bulkRestoreResumes(db, before)).toBe(3);
    const now = await Promise.all([acme, cora, dana].map(async (id) => (await db.applications.get(id))?.resumeId));
    expect(now).toEqual([master, v2, undefined]);
    expect("resumeId" in (await db.applications.get(dana))!).toBe(false);
  });

  it("leaves a deleted application alone when undoing, and points at none when the version was erased", async () => {
    const { db, v2, cora, dana } = await seed();
    await bulkSetResume(db, [cora, dana], null);
    await eraseDocument(db, v2);
    await db.applications.update(dana, { deletedAt: "2026-10-01T00:00:00Z" });
    expect(await bulkRestoreResumes(db, [{ id: cora, resumeId: v2 }, { id: dana, resumeId: v2 }, { id: 9999, resumeId: null }])).toBe(1);
    expect((await db.applications.get(cora))?.resumeId).toBeUndefined();
    expect((await db.applications.get(dana))?.resumeId).toBeUndefined();
  });
});

describe("searching the posting and the cover letter", () => {
  it("finds an application by its posting text, saying so", async () => {
    const { db, acme } = await seed();
    await setPostingText(db, acme, "Loves Tableau and SQL.");
    const [hit] = await listApplications(db, { q: "tableau" });
    expect(hit.company).toBe("Acme");
    expect(hit.match?.via).toBe("posting");
    expect(whyMatched(hit.match)).toBe("Matched in the job posting: Loves Tableau and SQL.");
  });

  it("finds an application by its cover letter, saying so", async () => {
    const { db, beta } = await seed();
    await saveCoverLetter(db, beta, [{ heading: "", items: [{ text: "Dear team, I admire your marketplace work." }] }]);
    const [hit] = await listApplications(db, { q: "marketplace" });
    expect(hit.company).toBe("Beta");
    expect(whyMatched(hit.match)).toBe("Matched in the cover letter: Dear team, I admire your marketplace work.");
  });

  it("looks at them only for a search that is long enough, like emails", async () => {
    const { db, acme } = await seed();
    await setPostingText(db, acme, "zebra stripes");
    expect(await listApplications(db, { q: "z" })).toEqual([]);
    expect(names(await listApplications(db, { q: "ze" }))).toEqual(["Acme"]);
  });

  it("matches a name first, then an email, a note or step, then the posting, then the cover letter", () => {
    const rows = [{ id: 1, company: "Posting Co", role: "", postingText: "needle in the posting" }, { id: 2, company: "Cover Co", role: "" }, { id: 3, company: "Name needle", role: "" }];
    const covers = [{ applicationId: 2, text: "needle in the letter" }, { applicationId: 1, text: "needle in the letter too" }];
    const hits = searchApplications(rows, [], [], "needle", covers);
    expect(hits.get(1)?.via).toBe("posting");
    expect(hits.get(2)?.via).toBe("cover");
    expect(hits.get(3)?.via).toBe("name");
    const note = [{ applicationId: 1, kind: "note" as const, label: null, body: "a needle in a note" }];
    expect(searchApplications(rows, [], note, "needle", covers).get(1)?.via).toBe("note");
  });

  it("needs every word in one place, ignores a deleted cover letter, and says nothing for a name match", async () => {
    const { db, acme, beta } = await seed();
    await setPostingText(db, acme, "sql and tableau");
    const letter = await saveCoverLetter(db, beta, [{ heading: "", items: [{ text: "python everywhere" }] }]);
    expect(names(await listApplications(db, { q: "sql python" }))).toEqual([]);
    await deleteDocument(db, letter);
    expect(await listApplications(db, { q: "python" })).toEqual([]);
    expect(whyMatched({ via: "name", snippet: "" })).toBe("");
  });
});

describe("saved views and the resume", () => {
  it("keeps a known resume value and drops the rest", () => {
    expect(cleanFilters({ resume: "12" }).resume).toBe("12");
    expect(cleanFilters({ resume: 12 }).resume).toBe("12");
    expect(cleanFilters({ resume: "none" }).resume).toBe("none");
    for (const bad of ["", "0", "-3", "1.5", "abc", "12abc", " 12", null, true, {}, 0, -1, 1.5]) expect(cleanFilters({ resume: bad }).resume).toBe("");
  });

  it("saves, reads back and counts a view that only filters on a resume", async () => {
    const db = freshDb();
    const view = await saveView(db, "Sent v2", { ...cleanFilters({}), resume: "3" });
    expect(view.resume).toBe("3");
    expect((await loadSavedViews(db))[0].resume).toBe("3");
    await expect(saveView(db, "Nothing", cleanFilters({}))).rejects.toThrow(ActionError);
  });

  it("still works for a view saved before resumes", () => {
    const [old] = sanitizeSavedViews([{ id: 1, name: "Old", stage: "Offer", q: "", account: 0, followUp: false, ghosted: false, sort: "", dir: "" }]);
    expect(old).toMatchObject({ name: "Old", stage: "Offer", resume: "" });
  });

  it("describes the resume by its title, as none set, or as deleted", () => {
    const f = (resume: string) => ({ ...cleanFilters({}), resume });
    expect(describeFilters(f("4"), undefined, "Analyst v2")).toBe("Resume: Analyst v2");
    expect(describeFilters(f("none"))).toBe("Resume: none set");
    expect(describeFilters(f("4"))).toBe("Resume: (deleted)");
    expect(describeFilters(f(""))).toBe("");
  });
});

describe("the CSV column", () => {
  it("is last, named Resume sent", () => {
    expect(CSV_HEADERS[CSV_HEADERS.length - 1]).toBe("Resume sent");
  });

  it("writes the title, and nothing for none or a deleted resume", async () => {
    const { db, v2 } = await seed();
    const cell = async (company: string) => {
      const csv = applicationsToCsv(await listApplications(db));
      const line = csv.split("\r\n").find((l) => l.startsWith(`${company},`))!;
      return line.split(",").pop();
    };
    expect(await cell("Cora")).toBe("Analyst v2");
    expect(await cell("Dana")).toBe("");
    await deleteDocument(db, v2);
    expect(await cell("Cora")).toBe("");
  });

  it("writes a tailored resume's title with (tailored) in it", async () => {
    const { db, dana } = await seed();
    await saveTailored(db, dana, SECTIONS, "ai");
    expect(applicationsToCsv(await listApplications(db))).toContain(`"Resume for Dana, Analyst (tailored)"\r\n`);
  });

  it("makes a title that starts like a formula safe", async () => {
    const { db, v2 } = await seed();
    await db.documents.update(v2, { title: "=SUM(A1)" });
    expect(applicationsToCsv(await listApplications(db))).toContain(",'=SUM(A1)\r\n");
  });
});

describe("Add several links with a resume", () => {
  const deps = {
    parseJobUrl: (u: string) => ({ ...EMPTY_DRAFT, company: "Acme", role: "Analyst", url: u, description: "Great job posting text" }),
    enrichJobDraft: async (d: typeof EMPTY_DRAFT) => d,
  };

  it("gives every application in the batch the chosen resume and its draft's posting text", async () => {
    const { db, v2 } = await seed();
    const results = await bulkAdd(
      db, ["https://jobs.example/a/1", "https://jobs.example/a/2"],
      { ...deps, parseJobUrl: (u) => ({ ...deps.parseJobUrl(u), company: u.endsWith("1") ? "Eve" : "Finn" }) },
      { resumeId: v2 },
    );
    expect(results.map((r) => r.outcome.status)).toEqual(["added", "added"]);
    const added = (await db.applications.toArray()).filter((a) => ["Eve", "Finn"].includes(a.company));
    expect(added.map((a) => [a.resumeId, a.postingText])).toEqual([[v2, "Great job posting text"], [v2, "Great job posting text"]]);
  });

  it("sets no resume when none is chosen, and no posting text when the draft has none", async () => {
    const db = freshDb();
    await bulkAdd(db, ["https://jobs.example/a/1"], { ...deps, parseJobUrl: (u) => ({ ...EMPTY_DRAFT, company: "Eve", role: "Analyst", url: u }) });
    const [a] = await db.applications.toArray();
    expect(a.resumeId).toBeUndefined();
    expect(a.postingText).toBeUndefined();
  });
});

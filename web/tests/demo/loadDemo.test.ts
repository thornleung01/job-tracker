import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_RESUME_VERSIONS } from "../../src/db/limits";
import type { DocItem, DocSection, JobTrackerDB } from "../../src/db/schema";
import { itemText } from "../../src/db/documentShape";
import { loadDemoData } from "../../src/demo/loadDemo";
import { readPastedSections } from "../../src/documents/read";
import { getCoverLetter, getMaster, liveResumes } from "../../src/sync/documents";
import { liveApplications } from "../../src/sync/live";
import { exportAllAsJson } from "../../src/portability";
import { createDbPool } from "../support/db";

const pool = createDbPool("demo");
afterEach(() => pool.closeAll());

const NOW = new Date("2026-11-05T12:00:00Z");

const summaryOf = async (db: JobTrackerDB) => {
  const master = (await getMaster(db))!;
  const versions = (await liveResumes(db)).filter((d) => !d.master);
  const apps = await liveApplications(db);
  return { master, versions, apps };
};

describe("demo resumes", () => {
  it("adds a master resume in the template (a header and four sections) and two versions of it", async () => {
    const db = pool.open();
    await loadDemoData(db, NOW);
    const { master, versions } = await summaryOf(db);
    expect(master.title).toBe("Master resume");
    expect(master.sections.map((s) => s.heading)).toEqual(["Header", "Professional summary", "Skills and qualifications", "Work experience", "Education"]);
    const kinds = (d: { sections: { heading: string; items: { kind?: string }[] }[] }, heading: string) => d.sections.find((s) => s.heading === heading)!.items.map((i) => i.kind);
    expect(kinds(master, "Header")).toEqual([undefined, undefined]);
    expect(kinds(master, "Skills and qualifications")).toEqual(["skill", "skill", "skill"]);
    expect(kinds(master, "Work experience").filter((k) => k === "org")).toHaveLength(2);
    expect(kinds(master, "Work experience").filter((k) => k === "title")).toHaveLength(3);
    expect(kinds(master, "Education")).toEqual(["school", undefined]);
    const jobs = master.sections.find((s) => s.heading === "Work experience")!.items;
    expect(jobs.filter((i) => i.kind === "org" || i.kind === "title").every((i) => i.right)).toBe(true);
    expect(jobs.filter((i) => i.kind === "bullet").every((i) => i.label)).toBe(true);
    expect(versions.map((v) => v.title)).toEqual(["Resume for data roles", "Resume for product roles"]);
    expect(versions.every((v) => v.basedOn === master.id && v.source === "copy")).toBe(true);
    expect(versions.length).toBeLessThanOrEqual(MAX_RESUME_VERSIONS);
    // a version is the master's own lines (nothing invented) with every header, organization, title and school kept and only some bullets
    type Doc = { sections: { items: { text: string; kind?: string }[] }[] };
    const lines = (d: Doc, bullets: boolean) => d.sections.flatMap((s) => s.items.filter((i) => (i.kind === "bullet") === bullets).map((i) => i.text));
    for (const v of versions) {
      expect(lines(v, false)).toEqual(lines(master, false));
      expect(lines(v, true).length).toBeGreaterThan(0);
      expect(lines(v, true).length).toBeLessThan(lines(master, true).length);
      for (const b of lines(v, true)) expect(lines(master, true)).toContain(b);
    }
    expect(lines(versions[0], true)).not.toEqual(lines(versions[1], true));
  });

  it("survives being printed as a resume's text and read back, with its jobs, titles, bullets, skills and school recognised", async () => {
    const db = pool.open();
    await loadDemoData(db, NOW);
    const { master } = await summaryOf(db);
    // What a printed or saved-as-PDF copy reads like: the name and contact lines first, capital headings, a gap before the right-hand
    // text and a bullet mark on each bullet. (sectionsToText's own comma form and sentence-case headings are not what the importer reads.)
    const line = (i: DocItem) => (i.kind === "bullet" ? `\u2022 ${itemText({ ...i, kind: undefined })}` : i.right ? `${i.text}\t${i.right}` : itemText(i));
    const printed = master.sections
      .map((s) => (s.heading === "Header" ? s.items.map((i) => i.text) : [s.heading.toUpperCase(), ...s.items.map(line)]).join("\n"))
      .join("\n\n");
    const back = readPastedSections(printed);
    expect(back.map((s) => s.heading)).toEqual(["Header", ...master.sections.slice(1).map((s) => s.heading.toUpperCase())]);
    const pick = (sections: DocSection[], heading: string) => sections.find((s) => s.heading.toLowerCase() === heading.toLowerCase())!.items;
    for (const heading of ["Skills and qualifications", "Work experience", "Education"]) {
      const was = pick(master.sections, heading);
      const now = pick(back, heading);
      expect(now, heading).toHaveLength(was.length);
      was.forEach((item, n) => {
        const got = now[n];
        // Every line comes back as it was, including a job or school whose location spells the province out ("Toronto, Ontario").
        expect({ text: got.text, kind: got.kind, label: got.label, right: got.right }, `${heading} ${n}`).toEqual({ text: item.text, kind: item.kind, label: item.label, right: item.right });
      });
    }
  });

  it("points applications at each version, spread across stages so both have replies", async () => {
    const db = pool.open();
    await loadDemoData(db, NOW);
    const { versions, apps } = await summaryOf(db);
    for (const v of versions) {
      const mine = apps.filter((a) => a.resumeId === v.id);
      expect(mine.length).toBeGreaterThanOrEqual(3);
      expect(mine.filter((a) => a.stage !== "Applied").length).toBeGreaterThanOrEqual(1);
      expect(new Set(mine.map((a) => a.stage)).size).toBeGreaterThanOrEqual(2);
    }
    expect(apps.some((a) => a.resumeId === undefined)).toBe(true);
  });

  it("gives an Interview-stage application a cover letter, dated before now", async () => {
    const db = pool.open();
    await loadDemoData(db, NOW);
    const { apps } = await summaryOf(db);
    const letters = (await db.documents.toArray()).filter((d) => d.kind === "cover");
    expect(letters).toHaveLength(1);
    const app = apps.find((a) => a.id === letters[0].applicationId)!;
    expect(app.stage).toBe("Interview");
    expect(await getCoverLetter(db, app.id)).toBeDefined();
    expect(letters[0].sections[0].items[0].text).toContain(app.company);
    for (const d of await db.documents.toArray()) expect(Date.parse(d.updatedAt)).toBeLessThanOrEqual(NOW.getTime());
  });

  it("gives the same documents every time, and replaces the ones from an earlier load", async () => {
    const db = pool.open();
    await loadDemoData(db, NOW);
    const first = await summaryOf(db);
    const strip = (s: Awaited<ReturnType<typeof summaryOf>>) => ({
      titles: s.versions.map((v) => v.title),
      used: s.versions.map((v) => s.apps.filter((a) => a.resumeId === v.id).map((a) => a.company).sort()),
    });
    await loadDemoData(db, NOW);
    const second = await summaryOf(db);
    expect(strip(second)).toEqual(strip(first));
    expect(await db.documents.count()).toBe(4);
  });

  it("is part of the export, so a demo backup carries it", async () => {
    const db = pool.open();
    await loadDemoData(db, NOW);
    const exported = JSON.parse(await exportAllAsJson(db, NOW)) as { data: { documents: unknown[] } };
    expect(exported.data.documents).toHaveLength(4);
  });
});

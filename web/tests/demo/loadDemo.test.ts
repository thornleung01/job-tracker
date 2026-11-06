import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_RESUME_VERSIONS } from "../../src/db/limits";
import type { JobTrackerDB } from "../../src/db/schema";
import { loadDemoData } from "../../src/demo/loadDemo";
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
  it("adds a master resume with four sections and two versions of it", async () => {
    const db = pool.open();
    await loadDemoData(db, NOW);
    const { master, versions } = await summaryOf(db);
    expect(master.title).toBe("Master resume");
    expect(master.sections.map((s) => s.heading)).toEqual(["Summary", "Experience", "Skills", "Education"]);
    expect(versions.map((v) => v.title)).toEqual(["Resume for data roles", "Resume for product roles"]);
    expect(versions.every((v) => v.basedOn === master.id && v.source === "copy")).toBe(true);
    expect(versions.length).toBeLessThanOrEqual(MAX_RESUME_VERSIONS);
    // a version is the master's own text with one line first, nothing invented
    const lines = (d: { sections: { items: { text: string }[] }[] }) => d.sections.flatMap((s) => s.items.map((i) => i.text)).sort();
    for (const v of versions) expect(lines(v)).toEqual(lines(master));
    expect(versions[0].sections[1].items[0].text).not.toBe(versions[1].sections[1].items[0].text);
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

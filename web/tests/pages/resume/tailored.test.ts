import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import ResumePage from "../../../src/pages/resume";
import { MAX_RESUME_VERSIONS } from "../../../src/db/limits";
import type { JobTrackerDB } from "../../../src/db/schema";
import { createVersion, deleteDocument, getTailored, liveResumes, saveMaster, saveTailored } from "../../../src/sync/documents";
import { $, $$, addApp, button, cleanup, click, freshDb, mountPage, text, waitFor } from "../applications/harness";

afterEach(cleanup);

const body = (t: string) => [{ id: "", heading: "Experience", items: [{ id: "", text: t }] }];

async function mount(db: JobTrackerDB, to = "/resume?tab=tailored") {
  const page = await mountPage(ResumePage, db, to);
  await waitFor(() => $(page.container, ".resume-view") !== null, "the page to load");
  return page;
}
const tab = (c: HTMLElement, name: string) => $$(c, "nav[aria-label=Show] a.tab").find((a) => text(a) === name)!;
const panes = (c: HTMLElement) => $$(c, ".resume-view");

describe("the Tailored tab", () => {
  it("is the third tab, selected from the address, with a sentence when empty", async () => {
    const { container } = await mount(freshDb());
    expect(tab(container, "Tailored").getAttribute("aria-current")).toBe("true");
    expect(tab(container, "Resumes").getAttribute("aria-current")).toBeNull();
    expect(panes(container).map((p) => p.hasAttribute("hidden"))).toEqual([true, true, false]);
    expect(text(panes(container)[2])).toBe("No tailored resumes yet. Open an application with its job posting saved to make one.");
  });

  it("lists each tailored resume with its application, Make reusable and Print, and keeps it out of the Resumes tab", async () => {
    const db = freshDb();
    await saveMaster(db, body("Base"), "paste");
    const a = await addApp(db, "Acme", { role: "Analyst" });
    const t = await saveTailored(db, a, body("Tailored"), "ai");
    const { container } = await mount(db);
    const item = $$(container, ".doc-covers li").find((li) => text(li).includes("(tailored)"))!;
    const links = $$(item, "a");
    expect(links.find((l) => text(l) === "Acme, Analyst")!.getAttribute("href")).toBe(`#/app/${a}`);
    expect(links.find((l) => text(l) === "Print")!.getAttribute("href")).toBe(`#/resume/print/${t}`);
    expect(button(item, "Make reusable")).not.toBeNull();
    expect($$(panes(container)[0], ".doc-card h2").map(text).filter((h) => h.includes("tailored"))).toEqual([]);
  });

  it("Make reusable moves it to the Resumes tab, and the application keeps pointing at it", async () => {
    const db = freshDb();
    await saveMaster(db, body("Base"), "paste");
    const a = await addApp(db, "Acme");
    const t = await saveTailored(db, a, body("Tailored"), "ai");
    const { container } = await mount(db);
    await click(button(container, "Make reusable"));
    await waitFor(() => $$(panes(container)[2], "li").length === 0, "the row to leave");
    expect(await getTailored(db, a)).toBeUndefined();
    expect((await liveResumes(db)).some((d) => d.id === t)).toBe(true);
    expect((await db.applications.get(a))!.resumeId).toBe(t);
    await waitFor(() => $$(panes(container)[0], ".doc-card h2").map(text).some((h) => h.includes("(tailored)")), "the Resumes tab to list it");
  });

  it("says in a sentence that the five-version cap is reached, and keeps the row", async () => {
    const db = freshDb();
    await saveMaster(db, body("Base"), "paste");
    for (let i = 0; i < MAX_RESUME_VERSIONS; i++) await createVersion(db, { title: `v${i}`, sections: body("x") });
    const a = await addApp(db, "Acme");
    await saveTailored(db, a, body("Tailored"), "ai");
    const { container } = await mount(db);
    await click(button(container, "Make reusable"));
    await waitFor(() => $(container, ".doc-tailored .notice.err") !== null, "the error");
    expect(text($(container, ".doc-tailored .notice.err"))).toBe(`You can keep ${MAX_RESUME_VERSIONS} resume versions. Delete one to make another.`);
    expect(await getTailored(db, a)).toBeDefined();
  });

  it("leaves out a deleted tailored resume", async () => {
    const db = freshDb();
    const a = await addApp(db, "Acme");
    const t = await saveTailored(db, a, body("Tailored"), "ai");
    await deleteDocument(db, t);
    const { container } = await mount(db);
    expect($$(panes(container)[2], "li")).toHaveLength(0);
  });
});

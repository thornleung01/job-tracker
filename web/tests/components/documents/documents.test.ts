// The pieces of the Documents section that don't need a page: the greeting, the letter text, the stylesheet, and the one line
// under an open application on the list.
import "fake-indexeddb/auto";
import { createElement, type ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { $, $$, addApp, cleanup, freshDb, mountPage, text } from "../../pages/applications/harness";
import type { PageProps } from "../../../src/app/pageProps";
import { ApplicationPanel } from "../../../src/components/ApplicationPanel";
import { greeting, letterSections, letterText } from "../../../src/sync/letter";
import type { JobTrackerDB } from "../../../src/db/schema";
import { documentLine } from "../../../src/sync/documentLine";
import { createVersion, deleteDocument, saveCoverLetter, saveMaster } from "../../../src/sync/documents";

afterEach(cleanup);

const person = (name: string, kind: "recruiter" | "hiring" | "people" | "", mentionedOnly = false) => ({ name, kind, mentionedOnly });

describe("greeting", () => {
  it("greets the first name of a recruiter, hiring or people contact", () => {
    expect(greeting([person("Jane Doe", "recruiter")])).toBe("Dear Jane,");
    expect(greeting([person("Sam Lee", "hiring")])).toBe("Dear Sam,");
    expect(greeting([person("Ana Ruiz", "people")])).toBe("Dear Ana,");
  });

  it("takes the first such person and skips the rest", () => {
    expect(greeting([person("Pat Smith", ""), person("Jane Doe", "recruiter"), person("Sam Lee", "hiring")])).toBe("Dear Jane,");
  });

  it("falls back to the hiring team for nobody, an unknown kind, a mention, or a name that isn't one", () => {
    expect(greeting([])).toBe("Dear hiring team,");
    expect(greeting([person("Pat Smith", "")])).toBe("Dear hiring team,");
    expect(greeting([person("Jane Doe", "recruiter", true)])).toBe("Dear hiring team,");
    expect(greeting([person("", "recruiter"), person("<script>", "hiring"), person("1234", "people")])).toBe("Dear hiring team,");
  });

  it("keeps a hyphen or apostrophe in a first name", () => {
    expect(greeting([person("Jean-Luc Picard", "recruiter")])).toBe("Dear Jean-Luc,");
    expect(greeting([person("O'Brien Smith", "hiring")])).toBe("Dear O'Brien,");
  });
});

describe("the letter as text", () => {
  it("round-trips paragraphs, dropping blank lines and keeping ids when the paragraphs stay", () => {
    const first = letterSections("Dear team,\n\n\nHello.\n  \nBye.");
    expect(first).toHaveLength(1);
    expect(first[0].heading).toBe("");
    expect(first[0].items.map((i) => i.text)).toEqual(["Dear team,", "Hello.", "Bye."]);
    expect(letterText(first)).toBe("Dear team,\n\nHello.\n\nBye.");
    const second = letterSections("Dear team,\n\nHello again.", first);
    expect(second[0].id).toBe(first[0].id);
    expect(second[0].items[0].id).toBe(first[0].items[0].id);
  });
});

describe("documents.css", () => {
  it("follows the stylesheet rules", async () => {
    const fs = await import(/* @vite-ignore */ "node" + ":fs");
    const css: string = fs.readFileSync(`${(globalThis as unknown as { process: { cwd(): string } }).process.cwd()}/src/components/documents/documents.css`, "utf8");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toContain("tabular-nums");
    expect(css).not.toMatch(/text-decoration:\s*underline/);
    expect(css).not.toContain("!important");
    for (const selector of css.split("\n").filter((l: string) => /^[.a-z]/.test(l)).map((l: string) => l.split("{")[0])) expect(selector).toMatch(/^\.documents/);
  });
});

const sections = [{ heading: "Skills", items: [{ text: "SQL" }] }];

describe("documentLine", () => {
  it("is nothing without a resume, a letter or a master", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme");
    expect(await documentLine(db, id)).toBeNull();
  });

  it("offers to write a letter once there is a master", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme");
    await saveMaster(db, sections, "paste");
    expect(await documentLine(db, id)).toEqual({ resume: null, cover: false, hasPosting: false, tailored: false });
  });

  it("names the resume sent and the letter, and (deleted) for a deleted resume", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme");
    const master = await saveMaster(db, sections, "paste");
    const version = await createVersion(db, { title: "Analyst v2", sections, basedOn: master });
    await db.applications.update(id, { resumeId: version });
    await saveCoverLetter(db, id, [{ heading: "", items: [{ text: "Hi" }] }]);
    expect(await documentLine(db, id)).toEqual({ resume: "Analyst v2", cover: true, hasPosting: false, tailored: false });
    await deleteDocument(db, version);
    expect(await documentLine(db, id)).toEqual({ resume: "(deleted)", cover: true, hasPosting: false, tailored: false });
  });
});

describe("the line under an open application", () => {
  async function mount(db: JobTrackerDB, appId: number) {
    const Panel: ComponentType<PageProps> = ({ db: d, navigate }) => createElement(ApplicationPanel, { db: d, appId, includeEmails: true, navigate });
    return mountPage(Panel, db, "/");
  }

  it("shows nothing for someone who doesn't use documents", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme");
    const { container } = await mount(db, id);
    expect($(container, ".panel-docs")).toBeNull();
  });

  it("offers Write a cover letter as a link to the detail page when there is a master", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme");
    await saveMaster(db, sections, "paste");
    const { container } = await mount(db, id);
    expect(text($(container, ".panel-docs"))).toBe("Write a cover letter · Tailor for this job");
    expect($$(container, ".panel-docs a").map((a) => a.getAttribute("href"))).toEqual([`#/app/${id}`, `#/tailor/${id}`]);
  });

  it("shows the resume and the cover letter, each a link to the detail page", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme");
    const master = await saveMaster(db, sections, "paste");
    const version = await createVersion(db, { title: "Analyst v2", sections, basedOn: master });
    await db.applications.update(id, { resumeId: version });
    await saveCoverLetter(db, id, [{ heading: "", items: [{ text: "Hi" }] }]);
    const { container } = await mount(db, id);
    expect(text($(container, ".panel-docs"))).toBe("Resume: Analyst v2 · Cover letter · Tailor for this job");
    expect($$(container, ".panel-docs a").map((a) => a.getAttribute("href"))).toEqual([`#/app/${id}`, `#/app/${id}`, `#/tailor/${id}`]);
  });

  it("shows the resume with a way to write a letter when it has none", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme");
    const master = await saveMaster(db, sections, "paste");
    await db.applications.update(id, { resumeId: master });
    const { container } = await mount(db, id);
    expect(text($(container, ".panel-docs"))).toBe("Resume: Master resume · Write a cover letter · Tailor for this job");
  });

  it("isn't on the detail page's own panel", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme");
    await saveMaster(db, sections, "paste");
    const Panel: ComponentType<PageProps> = ({ db: d, navigate }) => createElement(ApplicationPanel, { db: d, appId: id, includeEmails: false, navigate });
    const { container } = await mountPage(Panel, db, "/");
    expect($(container, ".panel-docs")).toBeNull();
  });
});

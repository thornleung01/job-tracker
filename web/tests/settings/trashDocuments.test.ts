// Settings > Recently deleted with resumes and cover letters: the rows, Restore (and its refusals), Delete now, Empty.
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Lets one test say that another tab erased the document meanwhile. Unset, the real function runs.
const otherTab = vi.hoisted(() => ({ erased: false }));
vi.mock("../../src/sync/documents", async (original) => {
  const real = await original<typeof import("../../src/sync/documents")>();
  return {
    ...real,
    restoreDocument: async (...args: Parameters<typeof real.restoreDocument>) => {
      if (otherTab.erased) throw new MissingRecordError("No deleted document");
      return real.restoreDocument(...args);
    },
  };
});
import { MissingRecordError } from "../../src/db/errors";
import { $, $$, addApp, button, cleanup, click, freshDb, mountPage, text, waitFor } from "../pages/applications/harness";
import type { PageProps } from "../../src/app/pageProps";
import { TrashSection } from "../../src/pages/settings/TrashSection";
import { deleteApplication } from "../../src/sync/actions";
import { createVersion, deleteDocument, saveCoverLetter } from "../../src/sync/documents";
import { DAY_MS } from "../../src/db/time";

afterEach(async () => {
  otherTab.erased = false;
  await cleanup();
});

const Page = (p: PageProps) => createElement(TrashSection, { db: p.db });
const body = [{ id: "", heading: "Experience", items: [{ id: "", text: "Built a thing" }] }];
const rows = (c: HTMLElement) => $$(c, ".trash-row");
const parts = (r: Element) => [text($(r, ".trash-what")), text($(r, ".trash-when")), $$(r, "button").map(text)];

async function setup() {
  const db = freshDb();
  const acme = await addApp(db, "Acme", { role: "Analyst" });
  const resume = await createVersion(db, { title: "Resume for Acme, Analyst", sections: body });
  const cover = await saveCoverLetter(db, acme, body);
  await deleteDocument(db, resume, new Date(Date.now() - 2 * DAY_MS));
  await deleteDocument(db, cover, new Date(Date.now() - 4 * DAY_MS));
  return { db, acme, resume, cover };
}

describe("Recently deleted with documents", () => {
  it("lists a resume and a cover letter with their kind, days left and the same two buttons", async () => {
    const { db } = await setup();
    const { container } = await mountPage(Page, db);
    expect(rows(container).map(parts)).toEqual([
      ["Resume · Resume for Acme, Analyst", "Deleted 2 days ago · 28 days left", ["Restore", "Delete now"]],
      ["Cover letter · Acme, Analyst", "Deleted 4 days ago · 26 days left", ["Restore", "Delete now"]],
    ]);
    expect(text($(container, "section#trash .help"))).toBe("Deleted applications, resumes and cover letters stay here for 30 days, then they are erased.");
  });

  it("mixes in applications, newest deletion first, with their own row layout", async () => {
    const { db, acme } = await setup();
    const beta = await addApp(db, "Beta", { role: "Engineer" });
    await deleteApplication(db, beta, "clear", new Date(Date.now() - 1 * DAY_MS));
    const { container } = await mountPage(Page, db);
    expect(rows(container).map((r) => text($(r, ".trash-what")).replace(/(Beta)(Engineer)(Applied)/, "$1 $2 $3"))).toEqual(["Beta Engineer Applied", "Resume · Resume for Acme, Analyst", "Cover letter · Acme, Analyst"]);
    expect(await db.applications.get(acme)).toBeDefined();
  });

  it("restores a resume, says so, and moves focus to the result", async () => {
    const { db, resume } = await setup();
    const { container } = await mountPage(Page, db);
    await click($(container, "button[aria-label='Restore Resume for Acme, Analyst']"));
    await waitFor(() => rows(container).length === 1, "the row to go");
    expect(text($(container, ".notice"))).toBe("Restored Resume for Acme, Analyst.");
    expect(document.activeElement).toBe($(container, ".notice"));
    expect(await db.documents.get(resume)).not.toHaveProperty("deletedAt");
  });

  it("restores a cover letter whose application is live", async () => {
    const { db, cover } = await setup();
    const { container } = await mountPage(Page, db);
    await click($(container, "button[aria-label='Restore cover letter for Acme, Analyst']"));
    await waitFor(() => rows(container).length === 1, "the row to go");
    expect(text($(container, ".notice"))).toBe("Restored Acme, Analyst.");
    expect(await db.documents.get(cover)).not.toHaveProperty("deletedAt");
  });

  it("shows the refusal in the notice, and keeps the row, when the cover letter's application is deleted", async () => {
    const { db, acme, cover } = await setup();
    await deleteApplication(db, acme, "clear", new Date());
    const { container } = await mountPage(Page, db);
    await click($(container, "button[aria-label='Restore cover letter for Acme, Analyst']"));
    expect(text($(container, ".notice.err"))).toBe("Restore the application first.");
    expect(rows(container)).toHaveLength(3);
    expect((await db.documents.get(cover))?.deletedAt).toBeDefined();
  });

  it("shows the refusal when the application has a newer cover letter", async () => {
    const { db, acme } = await setup();
    await saveCoverLetter(db, acme, body);
    const { container } = await mountPage(Page, db);
    await click($(container, "button[aria-label='Restore cover letter for Acme, Analyst']"));
    expect(text($(container, ".notice.err"))).toBe("That application has a newer cover letter already.");
    expect(rows(container)).toHaveLength(2);
  });

  it("restoring an application doesn't bring its deleted cover letter back", async () => {
    const { db, acme, cover } = await setup();
    await deleteApplication(db, acme, "clear", new Date());
    const { container } = await mountPage(Page, db);
    await click($(container, "button[aria-label='Restore Acme']"));
    await waitFor(() => rows(container).length === 2, "the application row to go");
    expect((await db.documents.get(cover))?.deletedAt).toBeDefined();
  });

  it("asks before Delete now on a document, then erases it and clears the applications that pointed at it", async () => {
    const { db, acme, resume } = await setup();
    await db.applications.update(acme, { resumeId: resume });
    const { container } = await mountPage(Page, db);
    await click($(container, "button[aria-label='Delete Resume for Acme, Analyst now']"));
    const ask = $(container, ".inline-confirm")!;
    expect(text($(ask, ".inline-confirm-q"))).toBe("Delete Resume for Acme, Analyst now?");
    expect(text($(ask, ".help"))).toBe("It's erased from this device. This can't be undone.");
    expect(await db.documents.get(resume)).toBeDefined();
    await click(button(ask, "Delete now"));
    await waitFor(() => rows(container).length === 1, "the row to go");
    expect(text($(container, ".notice"))).toBe("Deleted Resume for Acme, Analyst for good.");
    expect(await db.documents.get(resume)).toBeUndefined();
    expect((await db.applications.get(acme))?.resumeId).toBeUndefined();
  });

  it("empties every kind once confirmed, counting items", async () => {
    const { db, resume, cover } = await setup();
    const { container } = await mountPage(Page, db);
    await click(button(container, "Empty recently deleted"));
    expect(text($(container, ".inline-confirm-q"))).toBe("Delete 2 items for good?");
    await click(button($(container, ".inline-confirm")!, "Empty recently deleted"));
    await waitFor(() => rows(container).length === 0, "the list to empty");
    expect(text($(container, ".notice"))).toBe("Deleted 2 items for good.");
    expect(await db.documents.get(resume)).toBeUndefined();
    expect(await db.documents.get(cover)).toBeUndefined();
    expect(text($(container, "section#trash"))).toContain("Nothing deleted.");
  });

  it("says so when a document was restored or erased elsewhere meanwhile", async () => {
    const { db } = await setup();
    const { container } = await mountPage(Page, db);
    otherTab.erased = true;
    await click($(container, "button[aria-label='Restore Resume for Acme, Analyst']"));
    expect(text($(container, ".notice"))).toBe("Resume for Acme, Analyst is no longer in Recently deleted.");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { $, $$, addApp, button, cleanup, click, freshDb, mountPage, settle, text, type, waitFor } from "./harness";
import { draft, field, openForm, withFakes } from "./paste-helpers";
import { saveMaster, saveTailored, setPostingText } from "../../../src/sync/documents";
import type { JobTrackerDB } from "../../../src/db/schema";

afterEach(cleanup);

const MASTER = [{ id: "", heading: "Experience", items: [{ id: "", text: "Built a reporting model" }] }];
const tailorLinks = (c: HTMLElement) => $$(c, ".notice a").filter((a) => /^Tailor/.test(text(a)));
const withMaster = async (db: JobTrackerDB) => void (await saveMaster(db, MASTER, "paste"));

/** Adds "Shopify" through the form, with posting text from a pasted job text when `posting` is true. */
async function addShopify(db: JobTrackerDB, posting: boolean) {
  const fromText = draft({ company: "Shopify", role: "Data Scientist", source: "paste", description: "Shopify is hiring a Data Scientist", guessed: { company: true, role: true } });
  const { Page } = withFakes({ parsePastedText: vi.fn(() => fromText) });
  const { container } = await mountPage(Page, db);
  await openForm(container);
  if (posting) {
    await click(button(container, "Or paste the job text instead"));
    await type($(container, "#add-paste"), "Shopify is hiring a Data Scientist");
    await click(button(container, "Read the text"));
  } else {
    await type(field(container, "add-company"), "Shopify");
  }
  await click(button(container, "Save application"));
  await waitFor(() => !$(container, "#add-application") && $(container, ".notice") !== null, "the Added notice");
  return container;
}

describe("Tailor your resume link in the Added notice", () => {
  it("offers a link to the new application when it has posting text and a master resume exists", async () => {
    const db = freshDb();
    await withMaster(db);
    const container = await addShopify(db, true);
    const id = (await db.applications.toArray()).find((a) => a.company === "Shopify")!.id;
    const link = $$(container, ".notice a").find((a) => text(a) === "Tailor your resume for this job")!;
    expect(link.getAttribute("href")).toBe(`#/app/${id}`);
  });

  it("says nothing extra without posting text", async () => {
    const db = freshDb();
    await withMaster(db);
    expect(tailorLinks(await addShopify(db, false))).toHaveLength(0);
  });

  it("says nothing extra without a master resume", async () => {
    expect(tailorLinks(await addShopify(freshDb(), true))).toHaveLength(0);
  });
});

describe("Tailor for this job in the open row panel", () => {
  async function open(db: JobTrackerDB) {
    const { Page } = withFakes();
    const { container } = await mountPage(Page, db, "/");
    await waitFor(() => $(container, "tr.app-row .expander") !== null, "the list");
    await click($(container, "tr.app-row .expander"));
    await waitFor(() => $(container, ".panel-inner") !== null, "the panel");
    await settle(80);
    return container;
  }
  const tailorLink = (c: HTMLElement) => $$(c, ".panel-docs a").find((a) => text(a) === "Tailor for this job");

  it("links to the detail page when there is a posting and a master, and no tailored resume", async () => {
    const db = freshDb();
    await withMaster(db);
    const id = await addApp(db, "Acme");
    await setPostingText(db, id, "Acme is hiring");
    expect(tailorLink(await open(db))!.getAttribute("href")).toBe(`#/app/${id}`);
  });

  it("is not there without a posting", async () => {
    const db = freshDb();
    await withMaster(db);
    await addApp(db, "Acme");
    const container = await open(db);
    expect($(container, ".panel-docs")).not.toBeNull();
    expect(tailorLink(container)).toBeUndefined();
  });

  it("is not there once the application has a tailored resume", async () => {
    const db = freshDb();
    await withMaster(db);
    const id = await addApp(db, "Acme");
    await setPostingText(db, id, "Acme is hiring");
    await saveTailored(db, id, MASTER, "ai");
    expect(tailorLink(await open(db))).toBeUndefined();
  });

  it("shows no documents line at all when no resume is used and there is no master", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme");
    await setPostingText(db, id, "Acme is hiring");
    expect($(await open(db), ".panel-docs")).toBeNull();
  });
});

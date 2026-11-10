// What the detail page keeps of tailoring now that the workspace is its own page: the links into it, the labels, and the posting box's Fill from link.
// The review, the AI strip and the baseline compare are tested with the workspace.
import "fake-indexeddb/auto";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageProps } from "../../../src/app/pageProps";
import type { DocumentsDeps } from "../../../src/components/documents/deps";
import type { JobDraft } from "../../../src/jobs/types";
import DetailPage from "../../../src/pages/detail";
import { saveMaster, saveTailored, setPostingText } from "../../../src/sync/documents";
import { MASTER } from "../../ai/tailorFixture";
import { $, $$, addApp, button, cleanup, click, freshDb, mountPage, text, waitFor } from "../applications/harness";

afterEach(cleanup);
beforeEach(() => localStorage.removeItem("jobtracker:resume-editing"));

const POSTING = "Acme needs a data analyst who can report weekly.";
const section = (c: HTMLElement) => $(c, "section.documents") as HTMLElement;
const link = (c: HTMLElement, label: string) => $$(section(c), "a").find((a) => text(a) === label) as HTMLAnchorElement | undefined;

async function setup(o: { master?: boolean; posting?: string | null; stage?: "Applied" | "Interview"; enrich?: DocumentsDeps["enrichJobDraft"] } = {}) {
  const db = freshDb();
  const id = await addApp(db, "Acme", { role: "Data Analyst", stage: o.stage ?? "Applied" });
  if (o.master !== false) await saveMaster(db, MASTER, "paste");
  if (o.posting !== null) await setPostingText(db, id, o.posting ?? POSTING);
  const enrichJobDraft = o.enrich ?? vi.fn(async (d: JobDraft) => d);
  const Page = (props: PageProps) => createElement(DetailPage, { ...props, deps: { documents: { enrichJobDraft } } });
  const page = await mountPage(Page, db, `/app/${id}`, { id: String(id) });
  await waitFor(() => $(page.container, "section.documents select") !== null, "the documents");
  return { db, id, ...page };
}

describe("the Tailor link", () => {
  it("goes to the workspace for this application, even with no posting text", async () => {
    const { id, container } = await setup({ posting: null });
    expect(link(container, "Tailor resume and cover letter")!.getAttribute("href")).toBe(`#/tailor/${id}`);
    expect(button(section(container), "Tailor resume and cover letter")).toBeNull();
    expect($(container, ".tailor-panel")).toBeNull();
  });

  it("is offered only when there is a master resume", async () => {
    const { container } = await setup({ master: false });
    expect(link(container, "Tailor resume and cover letter")).toBeUndefined();
  });
});

describe("the tailored resume on the page", () => {
  it("is marked Tailored in Resume sent, with an Open in Tailor link", async () => {
    const { db, id, container } = await setup();
    await saveTailored(db, id, MASTER, "ai");
    const select = $(section(container), "select[name=resume]") as HTMLSelectElement;
    await waitFor(() => $$(select, "option").some((o) => text(o).includes("(tailored)")), "the tailored option");
    await waitFor(() => select.value !== "", "the choice");
    expect(text($(section(container), ".badge"))).toBe("Tailored");
    expect(link(container, "Open in Tailor")!.getAttribute("href")).toBe(`#/tailor/${id}`);
  });

  it("says in the header that the resume sent is tailored", async () => {
    const { db, id, container } = await setup({ stage: "Interview" });
    await saveTailored(db, id, MASTER, "ai");
    await waitFor(() => text(container).includes("You sent: Resume for Acme, Data Analyst (tailored)"), "the header line");
  });
});

describe("Fill from link", () => {
  it("is offered only when the application has a posting link", async () => {
    const without = await setup({ posting: null });
    expect(button(section(without.container), "Fill from link")).toBeNull();
    await cleanup();
    const withLink = await setup({ posting: null });
    await withLink.db.applications.update(withLink.id, { postingUrl: "https://boards.greenhouse.io/acme/jobs/1" });
    await waitFor(() => button(section(withLink.container), "Fill from link") !== null, "the button");
  });

  it("fills the box with the posting from enrichJobDraft, and saves it only on Save", async () => {
    const enrich = vi.fn(async (d: JobDraft): Promise<JobDraft> => ({ ...d, source: "api", description: "From the board: a data analyst role." }));
    const { db, id, container } = await setup({ posting: null, enrich });
    await db.applications.update(id, { postingUrl: "https://boards.greenhouse.io/acme/jobs/1" });
    await waitFor(() => button(section(container), "Fill from link") !== null, "the button");
    await click(button(section(container), "Fill from link"));
    expect(enrich.mock.calls[0][0]).toMatchObject({ url: "https://boards.greenhouse.io/acme/jobs/1", company: "Acme" });
    expect(($(section(container), "details textarea") as HTMLTextAreaElement).value).toBe("From the board: a data analyst role.");
    expect((await db.applications.get(id))?.postingText).toBeUndefined();
    await click(button($(section(container), "details.doc-posting") as HTMLElement, "Save"));
    await waitFor(() => $(section(container), ".doc-posting-text") !== null);
    expect((await db.applications.get(id))?.postingText).toBe("From the board: a data analyst role.");
  });

  it("says so when the link gave no posting, and leaves the box alone", async () => {
    const { db, id, container } = await setup({ posting: null });
    await db.applications.update(id, { postingUrl: "https://example.com/jobs/1" });
    await waitFor(() => button(section(container), "Fill from link") !== null);
    await click(button(section(container), "Fill from link"));
    expect(text($(container, ".notice"))).toContain("Couldn't read a posting from that link. Paste it instead.");
    expect(($(section(container), "details textarea") as HTMLTextAreaElement).value).toBe("");
  });
});

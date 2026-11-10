// Tailoring from the application's Documents section: the review, the fallback, Stop, Try again, saving, the posting box and the labels.
import "fake-indexeddb/auto";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageProps } from "../../../src/app/pageProps";
import type { AiDeps, AiRequest, Vault, VaultStatus } from "../../../src/ai";
import { DEFAULT_MODEL } from "../../../src/ai";
import type { DocumentsDeps } from "../../../src/components/documents/deps";
import type { JobDraft } from "../../../src/jobs/types";
import DetailPage from "../../../src/pages/detail";
import { getCoverLetter, getTailored, saveMaster, setPostingText } from "../../../src/sync/documents";
import { MASTER, goodReply } from "../../ai/tailorFixture";
import { $, $$, addApp, button, cleanup, click, freshDb, mountPage, text, type, waitFor } from "../applications/harness";

afterEach(cleanup);
beforeEach(() => localStorage.removeItem("jobtracker:resume-editing"));

const POSTING = "Acme needs a data analyst who can report weekly.";
const section = (c: HTMLElement) => $(c, "section.documents") as HTMLElement;
const panel = (c: HTMLElement) => $(c, ".tailor-panel") as HTMLElement | null;
const ASK = "Tailor resume and write cover letter";

/** A reply whose second bullet claims something the master doesn't have, so it is flagged. */
function flaggedReply() {
  const r = goodReply();
  r.jobs[0].bullets[0] = { sourceId: "b2", label: "Reporting", text: "Automated reporting with Snowflake and earned a PhD." };
  return r;
}

function fakeDeps(o: { status?: VaultStatus; replies?: unknown[]; enrich?: DocumentsDeps["enrichJobDraft"] } = {}) {
  const status: VaultStatus = o.status ?? { state: "unlocked", last4: "test", model: DEFAULT_MODEL };
  const key = status.state === "unlocked" ? "sk-ant-test" : null;
  const vault = { status: () => status, key: () => key, save: vi.fn(), unlock: vi.fn(), lock: vi.fn(), setModel: vi.fn(), forget: vi.fn() } as unknown as Vault;
  const replies = [...(o.replies ?? [goodReply()])];
  const complete = vi.fn(async (_k: string, _r: AiRequest, _o?: { signal?: AbortSignal }) => ({ json: replies.length > 1 ? replies.shift() : replies[0], model: "m" }));
  const ai: AiDeps = { vault, complete };
  const enrichJobDraft = o.enrich ?? vi.fn(async (d: JobDraft) => d);
  return { ai, complete, documents: { ai, enrichJobDraft } satisfies Partial<DocumentsDeps> };
}

async function setup(o: { master?: boolean; posting?: string | null; stage?: "Applied" | "Interview"; deps?: Parameters<typeof fakeDeps>[0] } = {}) {
  const db = freshDb();
  const id = await addApp(db, "Acme", { role: "Data Analyst", stage: o.stage ?? "Applied" });
  if (o.master !== false) await saveMaster(db, MASTER, "paste");
  if (o.posting !== null) await setPostingText(db, id, o.posting ?? POSTING);
  const fake = fakeDeps(o.deps);
  const Page = (props: PageProps) => createElement(DetailPage, { ...props, deps: { documents: fake.documents } });
  const page = await mountPage(Page, db, `/app/${id}`, { id: String(id) });
  await waitFor(() => $(page.container, "section.documents select") !== null, "the documents");
  return { db, id, fake, ...page };
}

async function openReview(c: HTMLElement) {
  await click(button(section(c), ASK));
  await click(button(panel(c)!, "Write them"));
  await waitFor(() => $(c, ".tailor-review") !== null, "the review");
}
const useBox = (c: HTMLElement, line: string) => {
  const li = $$(c, ".tailor-line").find((l) => text(l).includes(line))!;
  return $(li, "input[type=checkbox]") as HTMLInputElement;
};
const tickBox = (el: HTMLInputElement) => click(el);

describe("the Tailor button", () => {
  it("is offered only when there is a master resume", async () => {
    const withMaster = await setup();
    expect(button(section(withMaster.container), ASK)).not.toBeNull();
    await cleanup();
    const without = await setup({ master: false });
    expect(button(section(without.container), ASK)).toBeNull();
  });

  it("opens the job posting box first, and says why, when the application has no posting text", async () => {
    const { container } = await setup({ posting: null });
    const box = $(section(container), "details.doc-posting") as HTMLDetailsElement;
    expect(box.open).toBe(false);
    await click(button(section(container), ASK));
    expect(box.open).toBe(true);
    expect(text(box)).toContain("Tailoring reads the job posting. Paste it here first");
    expect(panel(container)).toBeNull();
  });

  it("says the key is missing, with a link to the AI settings, when there is none", async () => {
    const { container, fake } = await setup({ deps: { status: { state: "none" } } });
    await click(button(section(container), ASK));
    expect(text(panel(container))).toContain("Add your Anthropic key in Settings to tailor with AI.");
    expect($(panel(container)!, "a")?.getAttribute("href")).toBe("#/settings/ai");
    expect(button(panel(container)!, "Write them")).toBeNull();
    expect(fake.complete).not.toHaveBeenCalled();
  });

  it("says to unlock the key, with the same link, when it is locked", async () => {
    const { container } = await setup({ deps: { status: { state: "locked", last4: "test", model: DEFAULT_MODEL } } });
    await click(button(section(container), ASK));
    expect(text(panel(container))).toContain("Unlock your Anthropic key in Settings to tailor with AI.");
    expect($(panel(container)!, "a")?.getAttribute("href")).toBe("#/settings/ai");
  });
});

describe("the review", () => {
  it("shows the master's line beside the new one, with the changed words marked", async () => {
    const { container } = await setup({ deps: { replies: [flaggedReply()] } });
    await openReview(container);
    const li = $$(container, ".tailor-line").find((l) => text(l).includes("Snowflake"))!;
    expect(text($$(li, ".tailor-cols > div")[0])).toContain("Reporting: Automated the weekly report and saved 500 hours a year.");
    expect(text($$(li, ".tailor-cols > div")[1])).toContain("Snowflake");
    expect($$(li, ".tailor-cols > div")[1].querySelectorAll("mark").length).toBeGreaterThan(0);
  });

  it("starts flagged lines unticked, shows the flag as a sentence, and lists the unused master lines", async () => {
    const { container } = await setup({ deps: { replies: [flaggedReply()] } });
    await openReview(container);
    expect(useBox(container, "Snowflake").checked).toBe(false);
    expect(useBox(container, "Owned the seasonal plan").checked).toBe(true);
    expect(text($(container, ".tailor-line .tailor-flag"))).toMatch(/Snowflake/);
    expect(text($(container, ".tailor-unused"))).toContain("Built reconciliations for the finance team.");
  });

  it("shows an editable cover letter and a length estimate", async () => {
    const { container } = await setup();
    await openReview(container);
    const cover = $(container, "textarea.tailor-cover") as HTMLTextAreaElement;
    expect(cover.value).toContain("Dear hiring team,");
    expect(cover.value).toContain("I am excited to apply for the Data Analyst role at Acme Corp.");
    expect(text($(container, ".tailor-length"))).toMatch(/one page|over one page/);
  });

  it("saves nothing before Save both, and Cancel closes the panel", async () => {
    const { db, id, container } = await setup();
    await openReview(container);
    expect(await getTailored(db, id)).toBeUndefined();
    await click(button(panel(container)!, "Cancel"));
    expect(panel(container)).toBeNull();
    expect(await getTailored(db, id)).toBeUndefined();
    expect(await getCoverLetter(db, id)).toBeUndefined();
  });

  it("saves the tailored resume, the pointer and the edited letter, marked as made with AI", async () => {
    const { db, id, container } = await setup();
    await openReview(container);
    await type($(container, "textarea.tailor-cover"), "Dear Acme,\n\nMy own words.");
    await click(button(panel(container)!, "Save both"));
    await waitFor(() => panel(container) === null, "the panel to close");
    const tailored = (await getTailored(db, id))!;
    expect(tailored.source).toBe("ai");
    expect(tailored.sections.flatMap((s) => s.items).map((i) => i.text)).toContain("Operations analyst with 3 years in retail who leads reporting work.");
    expect((await db.applications.get(id))?.resumeId).toBe(tailored.id);
    const cover = (await getCoverLetter(db, id))!;
    expect(cover.source).toBe("ai");
    expect(cover.sections[0].items.map((i) => i.text)).toEqual(["Dear Acme,", "My own words."]);
    expect(text(section(container))).toContain("Saved the tailored resume and cover letter.");
  });

  it("falls back to the master's line for an unticked line when saving, and keeps a line that is ticked", async () => {
    const { db, id, container } = await setup({ deps: { replies: [flaggedReply()] } });
    await openReview(container);
    await click(button(panel(container)!, "Save both"));   // the flagged line is still unticked
    await waitFor(() => panel(container) === null, "the panel to close");
    const lines = (await getTailored(db, id))!.sections.flatMap((s) => s.items).map((i) => i.text);
    expect(lines).toContain("Automated the weekly report and saved 500 hours a year.");
    expect(lines.join(" ")).not.toContain("Snowflake");

    await click(button(section(container), ASK));
    await click(button(panel(container)!, "Write them"));
    await waitFor(() => $(container, ".tailor-review") !== null, "the review");
    await tickBox(useBox(container, "Snowflake"));
    await click(button(panel(container)!, "Save both"));
    await waitFor(() => panel(container) === null, "the panel to close");
    expect((await getTailored(db, id))!.sections.flatMap((s) => s.items).map((i) => i.text).join(" ")).toContain("Snowflake");
    expect(await db.documents.filter((d) => d.applicationId === id && d.kind === "resume").count()).toBe(1);
  });

  it("Try again replaces the draft", async () => {
    const second = goodReply();
    second.summary = "A second summary of the same facts about retail analytics.";
    const { container, fake } = await setup({ deps: { replies: [goodReply(), second] } });
    await openReview(container);
    expect(text($(container, ".tailor-review"))).toContain("who leads reporting work");
    await click(button(panel(container)!, "Try again"));
    await waitFor(() => text($(container, ".tailor-review")).includes("A second summary"), "the new draft");
    expect(text($(container, ".tailor-review"))).not.toContain("who leads reporting work");
    expect(fake.complete).toHaveBeenCalledTimes(2);
  });

  it("sends the chosen tone and note", async () => {
    const { container, fake } = await setup();
    await click(button(section(container), ASK));
    await type($(panel(container)!, "select"), "warm");
    await type($(panel(container)!, "input[type=text]"), "Stress reporting");
    await click(button(panel(container)!, "Write them"));
    await waitFor(() => fake.complete.mock.calls.length === 1);
    const user = JSON.parse(fake.complete.mock.calls[0][1].user);
    expect(user).toMatchObject({ tone: "warm", note: "Stress reporting" });
  });

  it("Stop cancels the request and leaves the panel ready, with nothing saved", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { role: "Data Analyst" });
    await saveMaster(db, MASTER, "paste");
    await setPostingText(db, id, POSTING);
    const fake = fakeDeps();
    let signal: AbortSignal | undefined;
    fake.complete.mockImplementationOnce((_k, _r, o) => new Promise((_res, rej) => {
      signal = o?.signal;
      o?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    }));
    const Page = (props: PageProps) => createElement(DetailPage, { ...props, deps: { documents: fake.documents } });
    const { container } = await mountPage(Page, db, `/app/${id}`, { id: String(id) });
    await waitFor(() => $(container, "section.documents select") !== null);
    await click(button(section(container), ASK));
    await click(button(panel(container)!, "Write them"));
    await waitFor(() => button(panel(container)!, "Stop") !== null, "Stop");
    await click(button(panel(container)!, "Stop"));
    expect(signal?.aborted).toBe(true);
    expect(button(panel(container)!, "Stop")).toBeNull();
    expect(button(panel(container)!, "Write them")).not.toBeNull();
    expect($(container, ".notice")).toBeNull();
    expect(await getTailored(db, id)).toBeUndefined();
  });

  it("shows a failure as a plain sentence and lets the person try again", async () => {
    const { container, fake } = await setup();
    const { AiError } = await import("../../../src/ai");
    fake.complete.mockRejectedValueOnce(new AiError("busy"));
    await click(button(section(container), ASK));
    await click(button(panel(container)!, "Write them"));
    await waitFor(() => text(panel(container)).includes("Anthropic is busy. Try again."), "the failure");
    expect(button(panel(container)!, "Write them")).not.toBeNull();
  });
});

describe("Documents elsewhere on the page", () => {
  it("lists the application's tailored resume and marks it Tailored, and the copy button still works", async () => {
    const { container } = await setup();
    await openReview(container);
    await click(button(panel(container)!, "Save both"));
    await waitFor(() => panel(container) === null);
    const select = $(section(container), "select[name=resume]") as HTMLSelectElement;
    await waitFor(() => $$(select, "option").some((o) => text(o).includes("(tailored)")), "the tailored option");
    expect(text($(section(container), ".badge"))).toBe("Tailored");
    await click(button(section(container), "Make a copy for this job"));
    await waitFor(() => $$(select, "option").some((o) => text(o) === "Resume for Acme, Data Analyst"), "the copy");
  });

  it("says in the header that the resume sent is tailored", async () => {
    const { container } = await setup({ stage: "Interview" });
    await openReview(container);
    await click(button(panel(container)!, "Save both"));
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
    const { db, id, container } = await setup({ posting: null, deps: { enrich } });
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

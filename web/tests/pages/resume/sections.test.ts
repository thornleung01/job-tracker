// The Resume page's three sections: Resume, Job, and the split (Tailored resume | Tailored cover letter) with its action bar. The logic behind them
// (tailorForJob, saveTailoredJob and the rest) has its own tests; here they are the real ones wrapped in spies, or fakes where a test needs to see
// exactly what was asked. The PDF makers and the saver are always fakes: the page is tested for what it asks of them.
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { hostedBuild } from "../../support/hosted";
import type { PageProps } from "../../../src/app/pageProps";
import { blockLeave } from "../../../src/app/leaveGuard";
import type { JobTrackerDB } from "../../../src/db/schema";
import type { JobDraft } from "../../../src/jobs/types";
import ResumePage, { type ResumeDeps } from "../../../src/pages/resume";
import { createVersion, deleteDocument, getCoverLetter, getTailored, saveMaster, saveTailored, setPostingText } from "../../../src/sync/documents";
import { addApplication } from "../../../src/sync/actions";
import { upsertAccount } from "../../../src/db/repo";
import { readJob } from "../../../src/sync/readJob";
import { draftFromBaseline, tailorForJob } from "../../../src/sync/tailor";
import { existingDocs, jobMatches, saveTailoredJob } from "../../../src/sync/tailorFlow";
import { MASTER, goodReply } from "../../ai/tailorFixture";
import { fakeAi, type Saved } from "../tailor/harness";
import { $, $$, addApp, button, cleanup, click, freshDb, mountPage, settle, text, type, waitFor } from "../applications/harness";

beforeEach(() => localStorage.setItem("jobtracker:resume-editing", "list"));
afterEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  await cleanup();
});

const POSTING = "Data Analyst at Acme Corp\nToronto, ON\nWe need a data analyst who knows Snowflake and Tableau and can report weekly.";

interface PdfFake { pages: number; replacedChars: boolean }
function makeDeps(saved: Saved = "none", replies?: unknown[], pdf: { resume?: PdfFake; letter?: PdfFake } = {}) {
  const fake = fakeAi(saved, replies);
  const bytes = new TextEncoder().encode("%PDF-fake");
  const deps = {
    ai: fake.ai,
    readJob: vi.fn(readJob),
    enrichJobDraft: vi.fn(async (d: JobDraft) => d),
    tailorForJob: vi.fn(tailorForJob),
    draftFromBaseline: vi.fn(draftFromBaseline),
    jobMatches: vi.fn(jobMatches),
    existingDocs: vi.fn(existingDocs),
    saveTailoredJob: vi.fn(saveTailoredJob),
    resumePdf: vi.fn(async () => ({ bytes, pages: 1, replacedChars: false, ...pdf.resume })),
    letterPdf: vi.fn(async () => ({ bytes, pages: 1, replacedChars: false, ...pdf.letter })),
    pdfFilename: vi.fn((kind: string, company: string, role: string) => `${kind} – ${company}${role ? ` – ${role}` : ""}.pdf`),
    downloadPdfs: vi.fn(async () => undefined),
  } satisfies ResumeDeps;
  return { fake, deps };
}

async function mount(db: JobTrackerDB, deps: ResumeDeps, to = "/resume") {
  const Page = (props: PageProps) => createElement(ResumePage, { ...props, deps });
  const page = await mountPage(Page, db, to);
  await waitFor(() => $(page.container, ".resume-view") !== null, "the page to load");
  return page;
}
async function withMaster(saved: Saved = "none", o: { replies?: unknown[]; to?: string; pdf?: Parameters<typeof makeDeps>[2]; prepare?(db: JobTrackerDB): Promise<void> } = {}) {
  const db = freshDb();
  const master = await saveMaster(db, MASTER, "paste");
  await o.prepare?.(db);
  const { fake, deps } = makeDeps(saved, o.replies, o.pdf);
  const page = await mount(db, deps, o.to);
  return { db, master, fake, deps, ...page };
}

const sections = (c: HTMLElement) => $$(c, ".rs-section").map((s) => text($(s, "h2")));
const split = (c: HTMLElement) => $(c, ".rs-split");
const bar = (c: HTMLElement) => $(c, ".rs-bar")!;
const labelled = (c: ParentNode, label: string) => {
  const l = $$(c, "label").find((x) => text(x) === label);
  return l ? (document.getElementById(l.getAttribute("for")!) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) : null;
};
const postingBox = (c: HTMLElement) => labelled(c, "Paste the job description") as HTMLTextAreaElement;
async function paste(c: HTMLElement, value: string) {
  const box = postingBox(c);
  await act(async () => {
    box.dispatchEvent(new Event("paste", { bubbles: true }));
  });
  await type(box, value);
  await settle();
}
async function byHand(c: HTMLElement) {
  await click(button(c, "Start by hand"));
  await waitFor(() => split(c) !== null, "the split");
}
const sheetValues = (c: HTMLElement) => $$(c, ".rs-sheet input, .rs-sheet textarea").map((e) => (e as HTMLInputElement).value);
const phone = () => vi.stubGlobal("matchMedia", (q: string) => ({ matches: /max-width: 720px/.test(q), addEventListener: () => undefined, removeEventListener: () => undefined }));

describe("Resume, with no master", () => {
  it("is the way in, the Job section waits with one line that links to it, and saving the master moves focus to Job", async () => {
    const db = freshDb();
    const { container } = await mount(db, makeDeps().deps);
    expect(sections(container)).toEqual(["Resume", "Job"]);
    expect($(container, "#rs-job-h")!.closest(".rs-section")!.querySelector("textarea")).toBeNull();
    expect(text($$(container, ".rs-section")[1])).toBe("JobAdd your resume first.");
    expect(postingBox(container)).toBeNull();
    await click(button(container, "Start from the template"));
    await type($$(container, "input, textarea").find((e) => /^Line 1 of Header/.test(e.getAttribute("aria-label") ?? ""))!, "Jordan Lee");
    await click(button(container, "Save"));
    await waitFor(() => postingBox(container) !== null, "the Job section");
    await waitFor(() => document.activeElement === $(container, "#rs-job-h"), "focus on Job");
    expect(text($(container, ".rs-master-sum"))).toMatch(/^Master resume · updated \w{3} \d+$/);
  });
});

describe("Resume, with a master", () => {
  it("is one compact row with Edit, which goes to the master under Your documents", async () => {
    const { container } = await withMaster();
    expect(sections(container)).toEqual(["Resume", "Job"]);
    expect(text($(container, ".rs-master-sum"))).toMatch(/^Master resume · updated \w{3} \d+$/);
    expect($(container, ".rs-master select")).toBeNull();
    await click(button(container, "Edit"));
    await waitFor(() => document.activeElement === $(container, "#resume-master-h"), "the master's heading");
  });

  it("offers a Based on choice once there are versions, master first", async () => {
    const { container } = await withMaster("none", { prepare: async (db) => void (await createVersion(db, { title: "Data version", sections: MASTER })) });
    const select = labelled(container, "Based on") as HTMLSelectElement;
    expect($$(select, "option").map(text)).toEqual(["Master", "Data version"]);
  });
});

describe("Job", () => {
  it("fills the company and role from a paste, marked Check these until touched, and lists the posting's words", async () => {
    const { container, deps } = await withMaster();
    expect(split(container)).toBeNull();
    await paste(container, POSTING);
    expect(labelled(container, "Company")!.value).toBe("Acme Corp");
    expect(labelled(container, "Role")!.value).toBe("Data Analyst");
    expect(text($(container, ".rs-check"))).toBe("Check these");
    expect(deps.readJob).toHaveBeenCalledWith(POSTING, undefined, expect.objectContaining({ db: expect.any(String) }), expect.anything());
    expect($(container, "[aria-labelledby=posting-terms-h]")).not.toBeNull();
    await type(labelled(container, "Company")!, "Acme");
    await type(labelled(container, "Role")!, "Analyst");
    expect(text($(container, ".rs-check"))).toBe("");
  });

  it("puts the posting on the left and the link, company, role and words on the right", async () => {
    const { container } = await withMaster();
    await paste(container, POSTING);
    const job = $(container, ".rs-job")!;
    expect([...job.children].map((c) => c.className)).toEqual(["fgroup rs-posting", "rs-side"]);
    expect($(job, ".rs-posting textarea")).not.toBeNull();
    expect($$(job, ".rs-side label").map(text).slice(0, 3)).toEqual(["Job link (optional)", "Company", "Role"]);
    expect($(job, ".rs-side .posting-terms")).not.toBeNull();
    expect(button($(job, ".rs-side")!, "Fill from link")).not.toBeNull();
  });

  it("needs a company to continue", async () => {
    const { container } = await withMaster();
    await type(postingBox(container), "We need someone who knows SQL.");
    expect((button(container, "Start by hand") as HTMLButtonElement).disabled).toBe(true);
    expect(text($(container, ".rs-why"))).toBe("Add the company to continue.");
    await type(labelled(container, "Company")!, "Acme");
    expect((button(container, "Start by hand") as HTMLButtonElement).disabled).toBe(false);
  });

  it("fills the job from a link", async () => {
    const { container, deps } = await withMaster();
    deps.enrichJobDraft.mockImplementation(async (d: JobDraft) => ({ ...d, company: "Gringotts", role: "Analyst", description: "Gringotts needs an analyst." }));
    await type(labelled(container, "Job link (optional)")!, "https://boards.greenhouse.io/gringotts/jobs/1");
    await click(button(container, "Fill from link"));
    await waitFor(() => labelled(container, "Company")!.value === "Gringotts", "the fill");
    expect(postingBox(container).value).toBe("Gringotts needs an analyst.");
    expect(text($(container, ".rs-check"))).toBe("Check these");
  });

  it("starts by hand with no key: one line links to Settings, Start by hand is the primary, and nothing is sent", async () => {
    const { container, fake, deps } = await withMaster("none");
    expect(text($(container, ".tailor-ai-line"))).toBe("Add your Anthropic key in Settings.");
    expect($(container, ".tailor-ai-line a")!.getAttribute("href")).toBe("#/settings/ai");
    expect(button(container, "Start by hand")!.className).toBe("primary");
    expect(button(container, "Write with AI")).toBeNull();
    await paste(container, POSTING);
    await byHand(container);
    expect(deps.draftFromBaseline).toHaveBeenCalledWith(expect.anything(), expect.any(Number), "Acme Corp");
    expect(fake.complete).not.toHaveBeenCalled();
    expect(sheetValues(container)).toContain("Jordan Lee");
  });

  it("writes with AI when the key is unlocked, and the split opens with the AI's lines to tick", async () => {
    const { container, fake, deps } = await withMaster("unlocked");
    await paste(container, POSTING);
    await click(button(container, "Write with AI"));
    await waitFor(() => split(container) !== null, "the split");
    expect(fake.complete).toHaveBeenCalledTimes(1);
    expect(deps.tailorForJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ company: "Acme Corp", role: "Data Analyst", posting: POSTING }), expect.anything(), expect.anything());
    expect(text($(container, "#tailor-ticks-h"))).toBe("Lines from the AI");
    // one Rewrite with AI, in the split's strip: the Job section's AI row goes once there is a draft
    const rewrites = $$(container, "button").filter((b) => text(b) === "Rewrite with AI");
    expect(rewrites).toHaveLength(1);
    expect(rewrites[0].closest(".rs-strip")).not.toBeNull();
    expect(button($(container, ".rs-job")!.closest(".rs-card")!, "Write with AI")).toBeNull();
  });

  it("shows a plain sentence for a link that isn't a web address, and keeps the actions off until it is fixed", async () => {
    const { container } = await withMaster();
    await type(postingBox(container), POSTING);
    await type(labelled(container, "Company")!, "Acme");
    const link = labelled(container, "Job link (optional)")!;
    await type(link, "linkedin.com/jobs/123");
    expect(text($(container, ".rs-why"))).toBe("That link doesn't look right. Use a web address that starts with https://.");
    expect(link.getAttribute("aria-invalid")).toBe("true");
    expect((button(container, "Start by hand") as HTMLButtonElement).disabled).toBe(true);
    expect((button(container, "Fill from link") as HTMLButtonElement).disabled).toBe(true);
    await type(link, "https://boards.greenhouse.io/acme/jobs/1");
    expect((button(container, "Start by hand") as HTMLButtonElement).disabled).toBe(false);
    expect(text(container)).not.toContain("That link doesn't look right");
  });

  it("asks before Start by hand replaces a hand-edited copy", async () => {
    const { container, deps } = await withMaster("none");
    await paste(container, POSTING);
    await byHand(container);
    await type($$(container, ".rs-sheet input")[0], "Edited");
    await click(button(container, "Start by hand"));
    expect(text($(container, ".rs-card .inline-confirm"))).toContain("Replace your edits?");
    await click(button($(container, ".rs-card .inline-confirm")!, "Replace my edits"));
    await waitFor(() => deps.draftFromBaseline.mock.calls.length === 2, "a new copy");
  });
});

describe("the split", () => {
  const flagged = () => {
    const r = goodReply();
    r.jobs[0].bullets[0] = { sourceId: "b2", label: "Reporting", text: "Automated reporting with Snowflake and earned a PhD." };
    return r;
  };

  it("has Tailored resume and Tailored cover letter side by side, with no steps, Next or Back", async () => {
    const { container } = await withMaster("none");
    await paste(container, POSTING);
    await byHand(container);
    expect($$(split(container)!, "h2").map(text)).toEqual(["Tailored resume", "Tailored cover letter"]);
    expect($$(container, ".rs-cols > .rs-col")).toHaveLength(2);
    expect($(container, ".rs-wide")).not.toBeNull();
    expect($(container, ".steps-strip")).toBeNull();
    for (const gone of ["Next", "Back", "Change", "Back to review", "Try again"]) expect(button(container, gone)).toBeNull();
    expect($(container, ".doc-switch[aria-label='Which document']")).toBeNull();
    expect((labelled(container, "Cover letter") as HTMLTextAreaElement).value).toContain("Dear hiring team at Acme Corp,");
    expect(text($(container, "h2.docs-h"))).toBe("Your documents");
  });

  it("starts a flagged line unticked with the baseline's words, and a tick puts the AI's line in", async () => {
    const { container } = await withMaster("unlocked", { replies: [flagged()] });
    await paste(container, POSTING);
    await click(button(container, "Write with AI"));
    await waitFor(() => split(container) !== null, "the split");
    const box = $$(container, ".tailor-use input").find((b) => /Snowflake/.test(b.getAttribute("aria-label") ?? "")) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(sheetValues(container)).toContain("Automated the weekly report and saved 500 hours a year.");
    await click(box);
    expect(sheetValues(container)).toContain("Automated reporting with Snowflake and earned a PhD.");
    expect(sheetValues(container)).not.toContain("Automated the weekly report and saved 500 hours a year.");
  });

  it("holds the ticks, left out and changes in one disclosure, open when the AI left lines to check", async () => {
    const { container } = await withMaster("unlocked", { replies: [flagged()] });
    await paste(container, POSTING);
    await click(button(container, "Write with AI"));
    await waitFor(() => split(container) !== null, "the split");
    const d = $(container, "details.rs-changes") as HTMLDetailsElement;
    expect(text($(d, "summary"))).toMatch(/^Changes from your baseline \(\d+\)$/);
    expect(d.open).toBe(true);
    expect($(d, "#tailor-ticks-h")).not.toBeNull();
    expect($$(container, "details.rs-changes")).toHaveLength(1);
    expect($(container, ".tailor-list")!.closest("details")).toBe(d);
  });

  it("counts the changes and closes the disclosure for a copy with none", async () => {
    const { container } = await withMaster("none");
    await paste(container, POSTING);
    await byHand(container);
    const d = $(container, "details.rs-changes") as HTMLDetailsElement;
    expect(text($(d, "summary"))).toBe("Changes from your baseline (0)");
    expect(d.open).toBe(false);
    await type($$(container, ".rs-sheet input")[0], "Edited");
    expect(text($(d, "summary"))).toBe("Changes from your baseline (1)");
  });

  it("keeps a quiet strip with Rewrite with AI (collapsed until asked) and Start over", async () => {
    const { container, fake } = await withMaster("unlocked");
    await paste(container, POSTING);
    await byHand(container);
    const strip = $(container, ".rs-strip")!;
    expect($$(strip, "button").map(text)).toEqual(["Rewrite with AI", "Start over"]);
    expect($(container, ".rs-split > .tailor-ai")).toBeNull();
    await click(button(strip, "Rewrite with AI"));
    const ai = $(container, ".rs-split > .tailor-ai")!;
    expect($(ai, "#" + labelled(ai, "Tone")!.id)).not.toBeNull();
    await click(button(ai, "Rewrite"));
    await waitFor(() => $(container, ".rs-split > .tailor-ai") === null, "the strip to close");
    expect(fake.complete).toHaveBeenCalledTimes(1);
  });

  it("Start over clears the job after asking, and puts Job back on its own", async () => {
    const { container } = await withMaster();
    await paste(container, POSTING);
    await byHand(container);
    await click(button($(container, ".rs-strip")!, "Start over"));
    await click(button($(container, ".rs-split .inline-confirm")!, "Start over"));
    expect(split(container)).toBeNull();
    expect(postingBox(container).value).toBe("");
    expect(sessionStorage.length).toBe(0);
  });

  it("on a phone shows one document at a time behind a two-tab switch", async () => {
    phone();
    const { container } = await withMaster("none");
    await paste(container, POSTING);
    await byHand(container);
    const sw = $(container, ".doc-switch[aria-label='Which document']")!;
    expect($$(sw, "button").map(text)).toEqual(["Resume", "Cover letter"]);
    expect($$(container, ".rs-col")).toHaveLength(1);
    expect(text($(container, ".rs-col h2"))).toBe("Tailored resume");
    expect(button(sw, "Resume")!.getAttribute("aria-pressed")).toBe("true");
    await click(button(sw, "Cover letter"));
    expect($$(container, ".rs-col")).toHaveLength(1);
    expect(text($(container, ".rs-col h2"))).toBe("Tailored cover letter");
    expect((labelled(container, "Cover letter") as HTMLTextAreaElement).value).toContain("Dear hiring team");
    expect($(container, ".rs-bar")).not.toBeNull();
  });
});

describe("the action bar", () => {
  async function toBar(o: Parameters<typeof withMaster>[1] = {}, saved: Saved = "none") {
    const page = await withMaster(saved, o);
    if (!o.to) await paste(page.container, POSTING);
    await byHand(page.container);
    await waitFor(() => $(page.container, ".rs-bar .rs-where") !== null, "the bar");
    return page;
  }
  const saveButton = (c: HTMLElement) => button(bar(c), "Save") ?? button(bar(c), "Saved");

  it("says it adds a new application when there is no match, and Save stores both documents on it", async () => {
    const { container, db, deps } = await toBar();
    expect(text($(bar(container), ".rs-where"))).toBe("Adds Acme Corp, Data Analyst to your applications (Applied, today)");
    expect($$(bar(container), "button").map(text)).toEqual(["Download", "Save"]);
    expect(button(bar(container), "Download")!.className).not.toContain("primary");
    expect(button(bar(container), "Save")!.className).toBe("primary");
    await click(button(bar(container), "Save"));
    await waitFor(() => $(container, ".rs-where a") !== null, "the saved bar");
    const input = deps.saveTailoredJob.mock.calls[0][1];
    expect(input).toMatchObject({ company: "Acme Corp", role: "Data Analyst", posting: POSTING, draft: { source: "copy" } });
    expect(input.useId).toBeUndefined();
    expect(input.draft.cover![0].items[0].text).toBe("Dear hiring team at Acme Corp,");
    const { appId, resumeId } = await deps.saveTailoredJob.mock.results[0].value;
    expect((await db.applications.get(appId))!.postingText).toBe(POSTING);
    expect((await getTailored(db, appId))!.id).toBe(resumeId);
    expect(await getCoverLetter(db, appId)).toBeDefined();
  });

  it("after Save, says so with links on, keeps the draft, and turns Save back on after an edit that saves to the same application", async () => {
    const { container, deps } = await toBar();
    await click(button(bar(container), "Save"));
    await waitFor(() => $(container, ".rs-where a") !== null, "the saved bar");
    const { appId } = await deps.saveTailoredJob.mock.results[0].value;
    const where = $(bar(container), ".rs-where")!;
    expect(text($(bar(container), ".rs-saved"))).toBe("Saved to Acme Corp");
    expect(text(where)).toBe("Open applicationEdit in TailorPrint resumeTailor another job");
    const { resumeId } = await deps.saveTailoredJob.mock.results[0].value;
    expect($$(where, "a").map((a) => [text(a), a.getAttribute("href")])).toEqual([
      ["Open application", `#/app/${appId}`], ["Edit in Tailor", `#/tailor/${appId}`], ["Print resume", `#/resume/print/${resumeId}`],
    ]);
    expect(document.activeElement).toBe($(bar(container), ".rs-saved"));
    expect($(bar(container), ".rs-saved")!.getAttribute("role")).toBe("status");
    expect($(bar(container), ".rs-saved")!.getAttribute("tabindex")).toBe("-1");
    expect((button(bar(container), "Saved") as HTMLButtonElement).disabled).toBe(true);
    expect(split(container)).not.toBeNull();
    expect(sheetValues(container)).toContain("Jordan Lee");

    await type($$(container, ".rs-sheet input")[0], "Jordan Q. Lee");
    await waitFor(() => (button(bar(container), "Save") as HTMLButtonElement | null)?.disabled === false, "Save to come back on");
    expect(text($(bar(container), ".rs-where"))).toBe("Saves to Acme Corp, Data Analyst (already in your applications)Add as new instead");
    await click(button(bar(container), "Save"));   // no question: it is the copy this page just saved
    await waitFor(() => deps.saveTailoredJob.mock.calls.length === 2, "the second save");
    expect(deps.saveTailoredJob.mock.calls[1][1].useId).toBe(appId);
    await waitFor(() => $(container, ".rs-where a") !== null, "the saved bar again");
  });

  it("Tailor another job clears the page back to Job", async () => {
    const { container } = await toBar();
    await click(button(bar(container), "Save"));
    await waitFor(() => $(container, ".rs-where a") !== null, "the saved bar");
    await click(button(bar(container), "Tailor another job"));
    expect(split(container)).toBeNull();
    expect(postingBox(container).value).toBe("");
    expect(labelled(container, "Company")!.value).toBe("");
  });

  it("finds an application that is already there, uses it by default, and Add as new instead adds one", async () => {
    let existing = 0;
    const { container, deps } = await toBar({ prepare: async (db) => void (existing = await addApplication(db, { company: "Acme Corp", role: "Data Analyst" })) });
    expect(text($(bar(container), ".rs-where"))).toBe("Saves to Acme Corp, Data Analyst (already in your applications)Add as new instead");
    await click(button(bar(container), "Add as new instead"));
    expect(text($(bar(container), ".rs-where"))).toContain("Add as new: Acme Corp, Data Analyst");
    await click(button(bar(container), "Save"));
    await waitFor(() => deps.saveTailoredJob.mock.calls.length === 1, "the save");
    expect(deps.saveTailoredJob.mock.calls[0][1].useId).toBeUndefined();
    expect(existing).toBeGreaterThan(0);
  });

  it("offers a select when several applications match", async () => {
    let second = 0;
    const { container, deps } = await toBar({
      prepare: async (db) => {
        await addApplication(db, { company: "Acme Corp", role: "Data Analyst" });
        second = await addApplication(db, { company: "Acme Corp", role: "Data Analyst" });
      },
    });
    const select = labelled(container, "Save to") as HTMLSelectElement;
    expect($$(select, "option").map(text).at(-1)).toBe("Add as new");
    expect($$(select, "option")).toHaveLength(3);
    await type(select, String(second));
    await click(button(bar(container), "Save"));
    await waitFor(() => deps.saveTailoredJob.mock.calls.length === 1, "the save");
    expect(deps.saveTailoredJob.mock.calls[0][1].useId).toBe(second);
  });

  it("asks in place before replacing the tailored resume an application already has", async () => {
    let id = 0;
    const { container, deps } = await toBar({
      prepare: async (db) => {
        id = await addApplication(db, { company: "Acme Corp", role: "Data Analyst" });
        await saveTailored(db, id, MASTER, "copy");
      },
    });
    await click(button(bar(container), "Save"));
    expect(text($(bar(container), ".inline-confirm"))).toContain("Replace the saved resume and letter?");
    expect(text($(bar(container), ".inline-confirm"))).toContain("Acme Corp already has a tailored resume.");
    expect(deps.saveTailoredJob).not.toHaveBeenCalled();
    await click(button($(bar(container), ".inline-confirm")!, "Cancel"));
    expect(deps.saveTailoredJob).not.toHaveBeenCalled();
    await click(button(bar(container), "Save"));
    await click(button($(bar(container), ".inline-confirm")!, "Replace and save"));
    await waitFor(() => deps.saveTailoredJob.mock.calls.length === 1, "the save");
    expect(deps.saveTailoredJob.mock.calls[0][1].useId).toBe(id);
  });

  it("says the letter needs a mailbox on the saved bar when mail is available but none is connected, and nothing in the demo", async () => {
    const { container: demo } = await toBar();
    await click(button(bar(demo), "Save"));
    await waitFor(() => $(demo, ".rs-where a") !== null, "the saved bar");
    await settle();
    expect($(bar(demo), ".rs-note")).toBeNull();
    await cleanup();

    onTestFinished(hostedBuild());
    const { container } = await toBar();
    await click(button(bar(container), "Save"));
    await waitFor(() => $(container, ".rs-where a") !== null, "the saved bar");
    await waitFor(() => $(bar(container), ".rs-note a") !== null, "the hint");
    expect(text($(bar(container), ".rs-note"))).toBe("Connect your mailbox to draft this in Gmail or Outlook.");
    expect($(bar(container), ".rs-note a")!.getAttribute("href")).toBe("#/settings/mail");
  });

  it("offers the Gmail draft beside Copy text and in the bar once saved, and never before Save", async () => {
    onTestFinished(hostedBuild());
    const { container } = await toBar({ prepare: async (db) => void (await upsertAccount(db, "gmail", "me@gmail.com")) });
    expect($$(container, "a").filter((a) => text(a).startsWith("Draft letter"))).toHaveLength(0);
    await click(button(bar(container), "Save"));
    await waitFor(() => $$(container, "a.btn").filter((a) => text(a) === "Draft letter in Gmail").length === 2, "both links");
    expect($(container, ".rs-letter a.btn")!.getAttribute("href")).toMatch(/^https:\/\//);
    expect($(bar(container), "a.btn")!.getAttribute("href")).toBe($(container, ".rs-letter a.btn")!.getAttribute("href"));
    await type($$(container, ".rs-sheet input")[0], "Edited");   // the saved letter is no longer the draft's
    expect($$(container, "a.btn").filter((a) => text(a).startsWith("Draft letter"))).toHaveLength(0);
  });

  it("drops the saved bar after a reload when the application is gone, and keeps it when it is there", async () => {
    const first = await toBar();
    await click(button(bar(first.container), "Save"));
    await waitFor(() => $(first.container, ".rs-saved")!.textContent !== "", "the saved line");
    const { appId } = await first.deps.saveTailoredJob.mock.results[0].value;
    // same database, same page again: the saved mark comes back and is checked
    const { deps } = makeDeps();
    const again = await mount(first.db, deps);
    await waitFor(() => $(again.container, ".rs-saved") !== null, "the bar");
    expect(text($(again.container, ".rs-saved"))).toBe("Saved to Acme Corp");
    await first.db.applications.update(appId, { deletedAt: "2026-11-01T00:00:00Z" });
    const third = await mount(first.db, makeDeps().deps);
    await waitFor(() => $(third.container, ".rs-bar") !== null && text($(third.container, ".rs-saved")) === "" && button(bar(third.container), "Save") !== null, "an unsaved bar");
    expect(text($(bar(third.container), ".rs-where"))).not.toContain("Open application");
    expect((button(bar(third.container), "Save") as HTMLButtonElement).disabled).toBe(false);
  });

  it("gives the page the bar's height as scroll padding so a focused field scrolls clear of it", async () => {
    const observers: { cb: () => void }[] = [];
    vi.stubGlobal("ResizeObserver", class { cb: () => void; constructor(cb: () => void) { this.cb = cb; observers.push(this); } observe() {} disconnect() {} });
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 88.2 } as DOMRect);
    onTestFinished(() => rect.mockRestore());
    const { container } = await toBar();
    expect(document.documentElement.style.getPropertyValue("--rs-bar-h")).toBe("89px");
    rect.mockReturnValue({ height: 120 } as DOMRect);
    act(() => observers.forEach((o) => o.cb()));
    expect(document.documentElement.style.getPropertyValue("--rs-bar-h")).toBe("120px");
    await cleanup();
    expect(document.documentElement.style.getPropertyValue("--rs-bar-h")).toBe("");
    expect(container).toBeDefined();
  });

  it("shows a failed save as a plain sentence and keeps Save on", async () => {
    const { container, deps } = await toBar();
    const { ActionError } = await import("../../../src/db/errors");
    deps.saveTailoredJob.mockRejectedValueOnce(new ActionError("That application isn't there any more."));
    await click(button(bar(container), "Save"));
    await waitFor(() => $(bar(container), ".notice.err") !== null, "the error");
    expect(text($(bar(container), ".notice.err"))).toContain("That application isn't there any more.");
    expect((saveButton(container) as HTMLButtonElement).disabled).toBe(false);
  });

  describe("Download", () => {
    it("makes the resume and the letter PDFs from the unsaved draft, named for the company and role", async () => {
      const { container, deps, db } = await toBar();
      await click(button(bar(container), "Download"));
      await waitFor(() => deps.downloadPdfs.mock.calls.length === 1, "the download");
      expect(deps.resumePdf).toHaveBeenCalledTimes(1);
      expect(deps.letterPdf).toHaveBeenCalledTimes(1);
      const letterSections = deps.letterPdf.mock.calls[0] as unknown as [{ items: { text: string }[] }[]];
      expect(letterSections[0][0].items[0].text).toBe("Dear hiring team at Acme Corp,");
      expect(deps.pdfFilename).toHaveBeenCalledWith("Resume", "Acme Corp", "Data Analyst");
      expect(deps.pdfFilename).toHaveBeenCalledWith("Cover letter", "Acme Corp", "Data Analyst");
      const files = (deps.downloadPdfs.mock.calls[0] as unknown as [{ name: string }[]])[0];
      expect(files.map((f) => f.name)).toEqual(["Resume – Acme Corp – Data Analyst.pdf", "Cover letter – Acme Corp – Data Analyst.pdf"]);
      expect(deps.saveTailoredJob).not.toHaveBeenCalled();
      expect(await db.applications.count()).toBe(0);
      expect($$(bar(container), ".rs-note").map(text)).toEqual(["Saved 2 PDFs to your downloads. If only one appeared, allow downloads for this site."]);
    });

    it("keeps the notes region in the bar from the start, empty, so what arrives in it is read out", async () => {
      const { container } = await toBar();
      const region = $(bar(container), ".rs-notes")!;
      expect(region.getAttribute("role")).toBe("status");
      expect(text(region)).toBe("");
      expect(text($(bar(container), ".rs-saved"))).toBe("");
      await click(button(bar(container), "Download"));
      await waitFor(() => text(region) !== "", "the note");
      expect($(bar(container), ".rs-notes")).toBe(region);
    });

    it("says when the resume runs to more than one page, and when characters couldn't go in", async () => {
      const { container, deps } = await toBar({ pdf: { resume: { pages: 2, replacedChars: false }, letter: { pages: 1, replacedChars: true } } });
      await click(button(bar(container), "Download"));
      await waitFor(() => $$(bar(container), ".rs-note").length === 3, "the notes");
      expect($$(bar(container), ".rs-note").map(text)).toEqual([
        "Saved 2 PDFs to your downloads. If only one appeared, allow downloads for this site.", "Your resume runs to 2 pages.", "Some characters couldn't go in the PDF.",
      ]);
      expect(deps.downloadPdfs).toHaveBeenCalledTimes(1);
      await type($$(container, ".rs-sheet input")[0], "Edited");   // the notes were about the draft as it was
      expect($$(bar(container), ".rs-note")).toHaveLength(0);
    });

    it("downloads only the resume when the letter is empty, and still works after a Save", async () => {
      const { container, deps } = await toBar();
      await type(labelled(container, "Cover letter")!, "");
      await click(button(bar(container), "Download"));
      await waitFor(() => deps.downloadPdfs.mock.calls.length === 1, "the download");
      expect(deps.letterPdf).not.toHaveBeenCalled();
      expect((deps.downloadPdfs.mock.calls[0] as unknown as [unknown[]])[0]).toHaveLength(1);
      await waitFor(() => $$(bar(container), ".rs-note").map(text).join() === "Saved 1 PDF to your downloads.", "the single note");
      await click(button(bar(container), "Save"));
      await waitFor(() => $(container, ".rs-where a") !== null, "the saved bar");
      await click(button(bar(container), "Download"));
      await waitFor(() => deps.downloadPdfs.mock.calls.length === 2, "the second download");
    });

    it("shows a failed download as a plain sentence", async () => {
      const { container, deps } = await toBar();
      deps.resumePdf.mockRejectedValueOnce(new Error("boom"));
      await click(button(bar(container), "Download"));
      await waitFor(() => $(bar(container), ".notice.err") !== null, "the error");
      expect(text($(bar(container), ".notice.err"))).toContain("Couldn't finish that. Try again.");
      expect(deps.downloadPdfs).not.toHaveBeenCalled();
    });
  });
});

describe("the page across a reload and a link", () => {
  it("keeps the pasted job and the draft after a reload, and asks before leaving with the draft", async () => {
    const { container, db, deps } = await withMaster();
    await paste(container, POSTING);
    await byHand(container);
    let stopped = false;
    await act(async () => void (stopped = blockLeave("#/people")));
    expect(stopped).toBe(true);
    expect(text($(container, ".inline-confirm"))).toContain("Leave without saving?");

    const again = await mount(db, deps);   // a second copy of the page, as after a reload
    expect(split(again.container)).not.toBeNull();
    expect(postingBox(again.container).value).toBe(POSTING);
    expect(labelled(again.container, "Company")!.value).toBe("Acme Corp");
  });

  it("lets you leave once the draft is saved, and asks again after an edit", async () => {
    const { container, deps } = await withMaster();
    await paste(container, POSTING);
    await byHand(container);
    await click(button(bar(container), "Save"));
    await waitFor(() => $(container, ".rs-where a") !== null, "the saved bar");
    await settle();
    expect(deps.saveTailoredJob).toHaveBeenCalledTimes(1);
    let stopped = true;
    await act(async () => void (stopped = blockLeave("#/people")));
    expect(stopped).toBe(false);
    await type($$(container, ".rs-sheet input")[0], "Edited");
    await act(async () => void (stopped = blockLeave("#/people")));
    expect(stopped).toBe(true);
  });

  it("?step=job scrolls to Job and takes the link off the address, and ?app=<id> fills Job from that application, which the bar then uses", async () => {
    const db = freshDb();
    await saveMaster(db, MASTER, "paste");
    const first = makeDeps();
    const before = await mount(db, first.deps);
    await paste(before.container, POSTING);
    await byHand(before.container);
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const back = await mount(db, first.deps, "/resume?step=job");
    await waitFor(() => back.visited.length === 1, "the link to be handled");
    expect(back.visited).toEqual(["/resume"]);
    await waitFor(() => scroll.mock.contexts.some((el) => (el as HTMLElement).id === "rs-job-h"), "the scroll to Job");

    const id = await addApp(db, "Gringotts", { role: "Product Analyst" });
    await setPostingText(db, id, "Gringotts needs a product analyst who knows SQL.");
    await db.applications.update(id, { postingUrl: "https://boards.greenhouse.io/gringotts/jobs/1" });
    const { deps } = makeDeps();
    const { container, visited } = await mount(db, deps, `/resume?app=${id}`);
    await waitFor(() => labelled(container, "Company")?.value === "Gringotts", "the prefill");
    expect(labelled(container, "Role")!.value).toBe("Product Analyst");
    expect(postingBox(container).value).toBe("Gringotts needs a product analyst who knows SQL.");
    expect(labelled(container, "Job link (optional)")!.value).toBe("https://boards.greenhouse.io/gringotts/jobs/1");
    expect(text($(container, ".rs-check"))).toBe("");
    expect(visited).toEqual(["/resume"]);
    await byHand(container);
    await waitFor(() => $(container, ".rs-bar .rs-where") !== null, "the bar");
    expect(text($(bar(container), ".rs-where"))).toMatch(/^Saves to Gringotts, Product Analyst \(already in your applications\)/);
    await click(button(bar(container), "Save"));
    await waitFor(() => deps.saveTailoredJob.mock.calls.length === 1, "the save");
    expect(deps.saveTailoredJob.mock.calls[0][1].useId).toBe(id);
  });

  it("?baseline=<id> picks that resume, takes the link off the address, and ignores an id that isn't a live resume", async () => {
    const db = freshDb();
    await saveMaster(db, MASTER, "paste");
    const version = await createVersion(db, { title: "Data version", sections: MASTER });
    const gone = await createVersion(db, { title: "Old version", sections: MASTER });
    await deleteDocument(db, gone);
    const { container, visited } = await mount(db, makeDeps().deps, `/resume?step=job&baseline=${version}`);
    await waitFor(() => ((labelled(container, "Based on") as HTMLSelectElement | null)?.value ?? "") === String(version), "the version to be picked");
    expect(visited).toEqual(["/resume"]);

    for (const id of [String(gone), "9999", "abc"]) {
      const other = await mount(db, makeDeps().deps, `/resume?step=job&baseline=${id}`);
      await waitFor(() => other.visited.length === 1, "the link to be handled");
      expect((labelled(other.container, "Based on") as HTMLSelectElement).value).not.toBe(id);
    }
  });

  it("says so when the draft's baseline was deleted, and uses the master for the split and for Save", async () => {
    const db = freshDb();
    const master = await saveMaster(db, MASTER, "paste");
    const version = await createVersion(db, { title: "Data version", sections: MASTER });
    const first = makeDeps();
    const before = await mount(db, first.deps, `/resume?step=job&baseline=${version}`);
    await waitFor(() => before.visited.length === 1, "the link to be handled");
    await paste(before.container, POSTING);
    await byHand(before.container);
    expect(first.deps.draftFromBaseline.mock.calls[0][1]).toBe(version);
    expect($(before.container, ".rs-gone")).toBeNull();

    await deleteDocument(db, version);
    const { deps } = makeDeps();
    const { container } = await mount(db, deps);
    expect(split(container)).not.toBeNull();
    expect(text($(container, ".rs-gone"))).toBe("The resume this draft was based on was deleted, so your master resume is used instead.");
    await waitFor(() => $(container, ".rs-bar .rs-where") !== null, "the bar");
    await click(button(bar(container), "Save"));
    await waitFor(() => deps.saveTailoredJob.mock.calls.length === 1, "the save");
    expect(deps.saveTailoredJob.mock.calls[0][1].draft.baselineId).toBe(master);
  });

  const closeWarns = () => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  };

  it("does not ask the browser on reload for a draft that is kept, but still asks when leaving the app", async () => {
    const { container } = await withMaster();
    await paste(container, POSTING);
    await byHand(container);
    expect(closeWarns()).toBe(false);
    let stopped = false;
    await act(async () => void (stopped = blockLeave("#/people")));
    expect(stopped).toBe(true);
  });
});

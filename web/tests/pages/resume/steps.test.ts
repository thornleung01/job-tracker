// The Resume page's four steps: 1 Your resume, 2 The job, 3 Review, 4 Add to applications. The logic behind them (tailorForJob, saveTailoredJob
// and the rest) has its own tests; here they are the real ones wrapped in spies, or fakes where a test needs to see exactly what was asked.
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageProps } from "../../../src/app/pageProps";
import { blockLeave } from "../../../src/app/leaveGuard";
import type { JobTrackerDB } from "../../../src/db/schema";
import type { JobDraft } from "../../../src/jobs/types";
import ResumePage, { type ResumeDeps } from "../../../src/pages/resume";
import { createVersion, deleteDocument, getCoverLetter, getTailored, saveMaster, saveTailored, setPostingText } from "../../../src/sync/documents";
import { addApplication } from "../../../src/sync/actions";
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
  await cleanup();
});

const POSTING = "Data Analyst at Acme Corp\nToronto, ON\nWe need a data analyst who knows Snowflake and Tableau and can report weekly.";

function makeDeps(saved: Saved = "none", replies?: unknown[]) {
  const fake = fakeAi(saved, replies);
  const deps = {
    ai: fake.ai,
    readJob: vi.fn(readJob),
    enrichJobDraft: vi.fn(async (d: JobDraft) => d),
    tailorForJob: vi.fn(tailorForJob),
    draftFromBaseline: vi.fn(draftFromBaseline),
    jobMatches: vi.fn(jobMatches),
    existingDocs: vi.fn(existingDocs),
    saveTailoredJob: vi.fn(saveTailoredJob),
  } satisfies ResumeDeps;
  return { fake, deps };
}

async function mount(db: JobTrackerDB, deps: ResumeDeps, to = "/resume") {
  const Page = (props: PageProps) => createElement(ResumePage, { ...props, deps });
  const page = await mountPage(Page, db, to);
  await waitFor(() => $(page.container, ".resume-view") !== null, "the page to load");
  return page;
}
async function withMaster(saved: Saved = "none", o: { replies?: unknown[]; to?: string; prepare?(db: JobTrackerDB): Promise<void> } = {}) {
  const db = freshDb();
  const master = await saveMaster(db, MASTER, "paste");
  await o.prepare?.(db);
  const { fake, deps } = makeDeps(saved, o.replies);
  const page = await mount(db, deps, o.to);
  return { db, master, fake, deps, ...page };
}

const strip = (c: HTMLElement) => $$(c, ".steps-item").map((li) => text(li));
const openHeading = (c: HTMLElement) => text($(c, ".steps-open h2"));
const labelled = (c: ParentNode, label: string) => {
  const l = $$(c, "label").find((x) => text(x) === label);
  return l ? (document.getElementById(l.getAttribute("for")!) as HTMLInputElement | HTMLTextAreaElement) : null;
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
  await waitFor(() => openHeading(c) === "3Review", "the review");
}

describe("step 1, Your resume", () => {
  it("keeps the job locked until there is a master, then opens The job with its heading focused", async () => {
    const db = freshDb();
    const { container } = await mount(db, makeDeps().deps);
    expect(strip(container)).toEqual(["1Your resume, current step", "2The job, not started", "3Review, not started", "4Add to applications, not started"]);
    expect($(container, "[aria-current=step]")!.textContent).toContain("Your resume");
    expect(postingBox(container)).toBeNull();
    expect(text($(container, ".steps-lead"))).toBe("Your resume is the starting point for every job you tailor for.");
    await click(button(container, "Start from the template"));
    await type($$(container, "input, textarea").find((e) => /^Line 1 of Header/.test(e.getAttribute("aria-label") ?? ""))!, "Jordan Lee");
    await click(button(container, "Save"));
    await waitFor(() => openHeading(container) === "2The job", "step 2");
    expect(document.activeElement).toBe($(container, "#steps-h-job"));
    expect(strip(container)[0]).toBe("Your resume, done");
    expect(text($(container, ".steps-done-row .steps-done-name"))).toBe("Your resume");
    expect(text($(container, ".steps-done-row .steps-done-sum"))).toMatch(/^Master resume · updated \w{3} \d+$/);
    expect(button(container, "Change")!.getAttribute("aria-label")).toBe("Change your resume");
  });

  it("offers a Based on choice once there are versions, and Change goes to the master under Your documents", async () => {
    const { container } = await withMaster("none", { prepare: async (db) => void (await createVersion(db, { title: "Data version", sections: MASTER })) });
    const select = $(container, "#steps-baseline") as HTMLSelectElement;
    expect($$(select, "option").map(text)).toEqual(["Master", "Data version"]);
    await click(button(container, "Change"));
    await waitFor(() => document.activeElement === $(container, "#resume-master-h"), "the master's heading");
  });
});

describe("step 2, The job", () => {
  it("fills the company and role from a paste, marked Check these until touched, and lists the posting's words", async () => {
    const { container, deps } = await withMaster();
    await paste(container, POSTING);
    expect(labelled(container, "Company")!.value).toBe("Acme Corp");
    expect(labelled(container, "Role")!.value).toBe("Data Analyst");
    expect(text($(container, ".steps-check"))).toBe("Check these");
    expect(deps.readJob).toHaveBeenCalledWith(POSTING, undefined, expect.objectContaining({ db: expect.any(String) }), expect.anything());
    expect($(container, "[aria-labelledby=posting-terms-h]")).not.toBeNull();
    await type(labelled(container, "Company")!, "Acme");
    await type(labelled(container, "Role")!, "Analyst");
    expect(text($(container, ".steps-check"))).toBe("");
  });

  it("needs a company to continue", async () => {
    const { container } = await withMaster();
    await type(postingBox(container), "We need someone who knows SQL.");
    expect((button(container, "Start by hand") as HTMLButtonElement).disabled).toBe(true);
    expect(text($(container, ".steps-why"))).toBe("Add the company to continue.");
    await type(labelled(container, "Company")!, "Acme");
    expect((button(container, "Start by hand") as HTMLButtonElement).disabled).toBe(false);
  });

  it("starts by hand with no key: one line links to Settings, Start by hand is the primary, and nothing is sent", async () => {
    const { container, fake, deps } = await withMaster("none");
    expect(text($(container, ".tailor-ai-line"))).toBe("Add your Anthropic key in Settings.");
    expect($(container, ".tailor-ai-line a")!.getAttribute("href")).toBe("#/settings/ai");
    expect(button(container, "Start by hand")!.className).toBe("primary");
    await paste(container, POSTING);
    await byHand(container);
    expect(document.activeElement).toBe($(container, "#steps-h-review"));
    expect(deps.draftFromBaseline).toHaveBeenCalledWith(expect.anything(), expect.any(Number), "Acme Corp");
    expect(fake.complete).not.toHaveBeenCalled();
    expect($$(container, ".steps-review-doc input, .steps-review-doc textarea").map((e) => (e as HTMLInputElement).value)).toContain("Jordan Lee");
  });

  it("writes with AI when the key is unlocked, and opens Review with the AI's lines to tick", async () => {
    const { container, fake, deps } = await withMaster("unlocked");
    await paste(container, POSTING);
    await click(button(container, "Write my resume and letter"));
    await waitFor(() => openHeading(container) === "3Review", "the review");
    expect(fake.complete).toHaveBeenCalledTimes(1);
    expect(deps.tailorForJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ company: "Acme Corp", role: "Data Analyst", posting: POSTING }), expect.anything(), expect.anything());
    expect(text($(container, "#tailor-ticks-h"))).toBe("Lines from the AI");
  });
});

describe("step 3, Review", () => {
  const flagged = () => {
    const r = goodReply();
    r.jobs[0].bullets[0] = { sourceId: "b2", label: "Reporting", text: "Automated reporting with Snowflake and earned a PhD." };
    return r;
  };

  it("starts a flagged line unticked with the baseline's words, and a tick puts the AI's line in", async () => {
    const { container } = await withMaster("unlocked", { replies: [flagged()] });
    await paste(container, POSTING);
    await click(button(container, "Write my resume and letter"));
    await waitFor(() => openHeading(container) === "3Review", "the review");
    const values = () => $$(container, ".steps-review-doc input, .steps-review-doc textarea").map((e) => (e as HTMLInputElement).value);
    const box = $$(container, ".tailor-use input").find((b) => /Snowflake/.test(b.getAttribute("aria-label") ?? "")) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(values()).toContain("Automated the weekly report and saved 500 hours a year.");
    await click(box);
    expect(values()).toContain("Automated reporting with Snowflake and earned a PhD.");
    expect(values()).not.toContain("Automated the weekly report and saved 500 hours a year.");
  });

  it("shows the letter on its own view, and Back and Next move between the steps", async () => {
    const { container } = await withMaster("unlocked");
    await paste(container, POSTING);
    await click(button(container, "Write my resume and letter"));
    await waitFor(() => openHeading(container) === "3Review", "the review");
    await click(button(container, "Cover letter"));
    expect((labelled(container, "Cover letter") as HTMLTextAreaElement).value).toContain("I am excited to apply for the Data Analyst role at Acme Corp.");
    await click(button(container, "Back"));
    expect(openHeading(container)).toBe("2The job");
    await click(button(container, "Back to review"));
    await click(button(container, "Next"));
    expect(openHeading(container)).toBe("4Add to applications");
    expect($$(container, ".steps-done-row").map((r) => text(r.querySelector(".steps-done-name")))).toEqual(["Your resume", "The job", "Review"]);
  });

  it("asks before Try again replaces a hand-edited copy", async () => {
    const { container, deps } = await withMaster("none");
    await paste(container, POSTING);
    await byHand(container);
    await type($$(container, ".steps-review-doc input")[0], "Edited");
    await click(button(container, "Try again"));
    expect(text($(container, ".inline-confirm"))).toContain("Replace your edits?");
    await click(button($(container, ".inline-confirm")!, "Replace my edits"));
    await waitFor(() => deps.draftFromBaseline.mock.calls.length === 2, "a new copy");
  });
});

describe("step 4, Add to applications", () => {
  async function toStep4(o: Parameters<typeof withMaster>[1] = {}, saved: Saved = "none") {
    const page = await withMaster(saved, o);
    if (!o.to) await paste(page.container, POSTING);
    await byHand(page.container);
    await click(button(page.container, "Next"));
    await waitFor(() => $(page.container, ".steps-where") !== null, "step 4");
    return page;
  }

  it("says it adds a new application when there is no match, and Save stores both documents on it", async () => {
    const { container, db, deps } = await toStep4();
    expect(text($(container, ".steps-where"))).toBe("Adds Acme Corp, Data Analyst to your applications (Applied, today).");
    await click(button(container, "Save"));
    await waitFor(() => openHeading(container) === "Saved to Acme Corp", "the done screen");
    const input = deps.saveTailoredJob.mock.calls[0][1];
    expect(input).toMatchObject({ company: "Acme Corp", role: "Data Analyst", posting: POSTING, draft: { source: "copy" } });
    expect(input.useId).toBeUndefined();
    expect(input.draft.cover![0].items[0].text).toBe("Dear hiring team at Acme Corp,");
    const { appId, resumeId } = await deps.saveTailoredJob.mock.results[0].value;
    expect((await db.applications.get(appId))!.postingText).toBe(POSTING);
    expect((await getTailored(db, appId))!.id).toBe(resumeId);
    expect(await getCoverLetter(db, appId)).toBeDefined();
    expect(sessionStorage.length).toBe(0);
  });

  it("finds an application that is already there, uses it by default, and Add as new still adds one", async () => {
    let existing = 0;
    const { container, deps } = await toStep4({ prepare: async (db) => void (existing = await addApplication(db, { company: "Acme Corp", role: "Data Analyst" })) });
    expect(text($(container, ".steps-where legend"))).toMatch(/^Already in your applications: Acme Corp, Data Analyst \(applied \w{3} \d+\)$/);
    const radios = $$(container, ".steps-where input[type=radio]") as HTMLInputElement[];
    expect(radios.map((r) => text(r.parentElement))).toEqual(["Use this one", "Add as new"]);
    expect(radios[0].checked).toBe(true);
    await click(radios[1]);
    await click(button(container, "Save"));
    await waitFor(() => deps.saveTailoredJob.mock.calls.length === 1, "the save");
    expect(deps.saveTailoredJob.mock.calls[0][1].useId).toBeUndefined();
    expect(existing).toBeGreaterThan(0);
  });

  it("asks in place before replacing the tailored resume an application already has", async () => {
    let id = 0;
    const { container, deps } = await toStep4({
      prepare: async (db) => {
        id = await addApplication(db, { company: "Acme Corp", role: "Data Analyst" });
        await saveTailored(db, id, MASTER, "copy");
      },
    });
    await click(button(container, "Save"));
    expect(text($(container, ".inline-confirm"))).toContain("Replace what's saved for Acme Corp?");
    expect(text($(container, ".inline-confirm"))).toContain("It already has a tailored resume.");
    expect(deps.saveTailoredJob).not.toHaveBeenCalled();
    await click(button($(container, ".inline-confirm")!, "Replace and save"));
    await waitFor(() => deps.saveTailoredJob.mock.calls.length === 1, "the save");
    expect(deps.saveTailoredJob.mock.calls[0][1].useId).toBe(id);
  });

  it("links onward when saved, and Tailor another job opens a cleared job step", async () => {
    const { container, deps } = await toStep4();
    await click(button(container, "Save"));
    await waitFor(() => openHeading(container) === "Saved to Acme Corp", "the done screen");
    expect(document.activeElement).toBe($(container, "#steps-h-done"));
    const { appId, resumeId } = await deps.saveTailoredJob.mock.results[0].value;
    const links = $$(container, ".steps-open a.btn").map((a) => [text(a), a.getAttribute("href")]);
    expect(links).toEqual([["Open application", `#/app/${appId}`], ["Edit in Tailor", `#/tailor/${appId}`], ["Print resume", `#/resume/print/${resumeId}`]]);
    expect(strip(container).every((s) => s.endsWith(", done"))).toBe(true);
    await click(button(container, "Tailor another job"));
    expect(openHeading(container)).toBe("2The job");
    expect(postingBox(container).value).toBe("");
    expect(labelled(container, "Company")!.value).toBe("");
  });
});

describe("the flow across a reload and a link", () => {
  it("keeps the pasted job and the draft after a reload, and asks before leaving with the draft", async () => {
    const { container, db, deps } = await withMaster();
    await paste(container, POSTING);
    await byHand(container);
    let stopped = false;
    await act(async () => void (stopped = blockLeave("#/people")));
    expect(stopped).toBe(true);
    expect(text($(container, ".inline-confirm"))).toContain("Leave without saving?");

    const again = await mount(db, deps);   // a second copy of the page, as after a reload
    expect(openHeading(again.container)).toBe("3Review");
    await click(button(again.container, "Back"));
    expect(postingBox(again.container).value).toBe(POSTING);
    expect(labelled(again.container, "Company")!.value).toBe("Acme Corp");
  });

  it("Start over clears the job, after asking when there is a draft", async () => {
    const { container } = await withMaster();
    await paste(container, POSTING);
    await byHand(container);
    await click(button(container, "Start over"));
    await click(button($(container, ".inline-confirm")!, "Start over"));
    expect(openHeading(container)).toBe("2The job");
    expect(postingBox(container).value).toBe("");
    expect(sessionStorage.length).toBe(0);
  });

  it("?step=job opens the job step and ?app=<id> fills it from that application, which step 4 then uses", async () => {
    const db = freshDb();
    await saveMaster(db, MASTER, "paste");
    const first = makeDeps();
    const before = await mount(db, first.deps);
    await paste(before.container, POSTING);
    await byHand(before.container);
    const back = await mount(db, first.deps, "/resume?step=job");
    await waitFor(() => openHeading(back.container) === "2The job", "the job step");
    expect(back.visited).toEqual(["/resume"]);

    const id = await addApp(db, "Gringotts", { role: "Product Analyst" });
    await setPostingText(db, id, "Gringotts needs a product analyst who knows SQL.");
    await db.applications.update(id, { postingUrl: "https://boards.greenhouse.io/gringotts/jobs/1" });
    const { deps } = makeDeps();
    const { container, visited } = await mount(db, deps, `/resume?app=${id}`);
    await waitFor(() => labelled(container, "Company")?.value === "Gringotts", "the prefill");
    expect(labelled(container, "Role")!.value).toBe("Product Analyst");
    expect(postingBox(container).value).toBe("Gringotts needs a product analyst who knows SQL.");
    expect(labelled(container, "Job link (optional)")!.value).toBe("https://boards.greenhouse.io/gringotts/jobs/1");
    expect(text($(container, ".steps-check"))).toBe("");
    expect(visited).toEqual(["/resume"]);
    await byHand(container);
    await click(button(container, "Next"));
    await waitFor(() => $(container, ".steps-where") !== null, "step 4");
    expect(text($(container, ".steps-where legend"))).toMatch(/^Already in your applications: Gringotts, Product Analyst/);
    await click(button(container, "Save"));
    await waitFor(() => deps.saveTailoredJob.mock.calls.length === 1, "the save");
    expect(deps.saveTailoredJob.mock.calls[0][1].useId).toBe(id);
  });
});

describe("the job link, Back to review and the deleted baseline", () => {
  it("shows a plain sentence for a link that isn't a web address, and keeps the actions off until it is fixed", async () => {
    const { container } = await withMaster();
    await type(postingBox(container), POSTING);
    await type(labelled(container, "Company")!, "Acme");
    const link = labelled(container, "Job link (optional)")!;
    await type(link, "linkedin.com/jobs/123");
    expect(text($(container, ".steps-why"))).toBe("That link doesn't look right. Use a web address that starts with https://.");
    expect(link.getAttribute("aria-invalid")).toBe("true");
    expect((button(container, "Start by hand") as HTMLButtonElement).disabled).toBe(true);
    expect((button(container, "Fill from link") as HTMLButtonElement).disabled).toBe(true);
    await type(link, "https://boards.greenhouse.io/acme/jobs/1");
    expect((button(container, "Start by hand") as HTMLButtonElement).disabled).toBe(false);
    expect(text(container)).not.toContain("That link doesn't look right");
  });

  it("keeps Back to review off while the company is empty", async () => {
    const { container } = await withMaster();
    await paste(container, POSTING);
    await byHand(container);
    await click($$(container, "button").find((b) => b.getAttribute("aria-label") === "Change the job")!);
    await waitFor(() => openHeading(container) === "2The job", "the job step");
    expect((button(container, "Back to review") as HTMLButtonElement).disabled).toBe(false);
    await type(labelled(container, "Company")!, "");
    expect((button(container, "Back to review") as HTMLButtonElement).disabled).toBe(true);
  });

  it("says so when the draft's baseline was deleted, and reviews and saves against the master", async () => {
    const db = freshDb();
    const master = await saveMaster(db, MASTER, "paste");
    const version = await createVersion(db, { title: "Data version", sections: MASTER });
    const first = makeDeps();
    const before = await mount(db, first.deps, `/resume?step=job&baseline=${version}`);
    await paste(before.container, POSTING);
    await byHand(before.container);
    expect(first.deps.draftFromBaseline.mock.calls[0][1]).toBe(version);
    expect($(before.container, ".steps-gone")).toBeNull();

    await deleteDocument(db, version);
    const { deps } = makeDeps();
    const { container } = await mount(db, deps);
    expect(openHeading(container)).toBe("3Review");
    expect(text($(container, ".steps-gone"))).toBe("The resume this draft was based on was deleted, so your master resume is used instead.");
    await click(button(container, "Next"));
    await waitFor(() => $(container, ".steps-where") !== null, "step 4");
    await click(button(container, "Save"));
    await waitFor(() => openHeading(container) === "Saved to Acme Corp", "the done screen");
    expect(deps.saveTailoredJob.mock.calls[0][1].draft.baselineId).toBe(master);
  });
});

describe("Tailor with this and the reload prompt", () => {
  it("?baseline=<id> picks that resume on the job step, takes the link off the address, and ignores an id that isn't a live resume", async () => {
    const db = freshDb();
    await saveMaster(db, MASTER, "paste");
    const version = await createVersion(db, { title: "Data version", sections: MASTER });
    const gone = await createVersion(db, { title: "Old version", sections: MASTER });
    await deleteDocument(db, gone);
    const { container, visited } = await mount(db, makeDeps().deps, `/resume?step=job&baseline=${version}`);
    await waitFor(() => (($(container, "#steps-baseline") as HTMLSelectElement | null)?.value ?? "") === String(version), "the version to be picked");
    expect(openHeading(container)).toBe("2The job");
    expect(visited).toEqual(["/resume"]);

    for (const id of [String(gone), "9999", "abc"]) {
      const other = await mount(db, makeDeps().deps, `/resume?step=job&baseline=${id}`);
      await waitFor(() => other.visited.length === 1, "the link to be handled");
      expect(openHeading(other.container)).toBe("2The job");
    }
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

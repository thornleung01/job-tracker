// The Tailor workspace (#/tailor/:id): the manual path with no key, compare against the baseline, the AI strip and its inline unlock, the cover letter
// view, the posting card and leaving with unsaved changes.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, click, type, waitFor } from "../applications/harness";
import { getCoverLetter, getTailored } from "../../../src/sync/documents";
import { MASTER, goodReply } from "../../ai/tailorFixture";
import { $, $$, button, field, setup, text } from "./harness";

afterEach(cleanup);
beforeEach(() => localStorage.removeItem("jobtracker:resume-editing"));

const BULLET = "Bullet 3 of Work experience";   // b1, the first bullet of the job
const items = (sections: { items: { id: string; text: string }[] }[]) => sections.flatMap((s) => s.items);
const strip = (c: HTMLElement) => $(c, "section.tailor-ai") as HTMLElement | null;
const flaggedReply = () => {
  const r = goodReply();
  r.jobs[0].bullets[0] = { sourceId: "b2", label: "Reporting", text: "Automated reporting with Snowflake and earned a PhD." };
  return r;
};

async function startCopy(c: HTMLElement) {
  await click(button(c, "Start from baseline"));
  await waitFor(() => $(c, ".page-editor") !== null, "the editor");
}

describe("before there is a copy", () => {
  it("names the job, links back, and offers Start from baseline and Write with AI beside the baseline sheet", async () => {
    const { container, id } = await setup();
    await waitFor(() => $(container, "h1") !== null, "the page");
    expect(text($(container, "h1"))).toBe("Tailor for Acme, Data Analyst");
    expect($(container, "a.back")!.getAttribute("href")).toBe(`#/app/${id}`);
    expect($$(container, ".doc-switch button").map((b) => text(b))).toEqual(["Resume", "Cover letter"]);
    expect($(container, ".tailor-baseline-sheet .doc-sheet")!.textContent).toContain("Jordan Lee");
    expect(button(container, "Start from baseline")).not.toBeNull();
    expect(button(container, "Write with AI")).not.toBeNull();
    expect($(container, ".page-editor")).toBeNull();
  });

  it("says to add a resume first when there is none", async () => {
    const { container } = await setup({ master: false });
    await waitFor(() => $(container, ".tailor-empty") !== null, "the sentence");
    expect(text($(container, ".tailor-empty"))).toContain("Add your resume first.");
  });

  it("lists the master first, then the versions", async () => {
    const { container, master } = await setup({ versions: ["Data version", "Ops version"] });
    await waitFor(() => $(container, "#tailor-baseline") !== null, "the page");
    const select = $(container, "#tailor-baseline") as HTMLSelectElement;
    expect($$(select, "option").map((o) => text(o))).toEqual(["Master: Master resume", "Data version", "Ops version"]);
    expect(select.value).toBe(String(master));
  });

  it("opens with the version from ?baseline= selected, and shows its sheet", async () => {
    const { container, versions } = await setup({ versions: ["Data version", "Ops version"], baselineIndex: 1 });
    await waitFor(() => $(container, "#tailor-baseline") !== null, "the page");
    expect(($(container, "#tailor-baseline") as HTMLSelectElement).value).toBe(String(versions[1]));
    expect($(container, ".tailor-baseline-sheet")!.getAttribute("aria-label")).toBe("Baseline: Ops version");
  });
});

describe("the manual path, with no key", () => {
  it("starts a copy from the baseline, keeps its line ids, and edits and saves it by hand", async () => {
    const { container, db, id, master, fake } = await setup({ saved: "none" });
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    await startCopy(container);
    const copy = (await getTailored(db, id))!;
    expect(copy.basedOn).toBe(master);
    expect(items(copy.sections).map((i) => i.id)).toEqual(items(MASTER).map((i) => i.id));

    await type(field(container, BULLET), "Owned the seasonal plan for 80 brands across 70 stores.");
    expect($(container, '.bm-bar[data-line="b1"]')!.getAttribute("data-status")).toBe("changed");
    expect(text($(container, ".tailor-entry[data-line=b1]"))).toContain("Owned the seasonal plan for 80 brands across 70 stores.");
    await click(button(container, "Save"));
    await waitFor(() => text($(container, ".tailor-status")) === "Saved.", "the save");
    expect(items((await getTailored(db, id))!.sections).find((i) => i.id === "b1")!.text).toBe("Owned the seasonal plan for 80 brands across 70 stores.");
    expect(fake.complete).not.toHaveBeenCalled();
    expect($(container, "a.btn[href^='#/resume/print/']")).not.toBeNull();
  });

  it("the AI strip says the key is missing, with a link, and nothing needs it", async () => {
    const { container, fake } = await setup({ saved: "none" });
    await waitFor(() => button(container, "Write with AI") !== null, "the page");
    await click(button(container, "Write with AI"));
    expect(text(strip(container))).toContain("Add your Anthropic key in Settings to write with AI.");
    expect($(strip(container)!, "a")!.getAttribute("href")).toBe("#/settings/ai");
    expect(button(strip(container)!, "Write")).toBeNull();
    await click(button(strip(container)!, "Close"));
    expect(strip(container)).toBeNull();
    expect(button(container, "Start from baseline")).not.toBeNull();
    expect(fake.complete).not.toHaveBeenCalled();
  });
});

describe("compare with the baseline", () => {
  it("lists a left-out line, adds it back in place, and resets an edited line", async () => {
    const { container, db, id } = await setup({ saved: "none" });
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    await startCopy(container);
    expect($(container, ".tailor-none")).not.toBeNull();

    await click($(container, `[data-pe-ctl="b2:remove"]`));
    expect(text($(container, "[aria-labelledby=tailor-left-h]"))).toContain("Automated the weekly report");
    expect($(container, '.page-editor [data-field="b2"]')).toBeNull();
    await click(button(container, "Add back")!);
    expect($(container, "[aria-labelledby=tailor-left-h]")).toBeNull();
    const order = $$(container, ".page-editor [data-field]").map((el) => (el as HTMLElement).dataset.field);
    expect(order.indexOf("b2")).toBe(order.indexOf("b1") + 1);

    await type(field(container, BULLET), "Something else entirely.");
    const reset = button($(container, ".tailor-entry[data-line=b1]")!, "Reset to baseline")!;
    await click(reset);
    expect(field(container, BULLET)!.value).toBe("Owned the seasonal plan for 60 brands across 70 stores.");
    expect($(container, ".tailor-entry[data-line=b1]")).toBeNull();
    expect(await getTailored(db, id)).toBeDefined();
  });

  it("Compare with baseline turns the margin bars and the list of changes off and on", async () => {
    const { container } = await setup({ saved: "none" });
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    await startCopy(container);
    await type(field(container, BULLET), "Changed words here.");
    const toggle = button(container, "Compare with baseline")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect($$(container, ".bm-bar").length).toBeGreaterThan(0);
    await click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect($$(container, ".bm-bar")).toHaveLength(0);
    expect($(container, "[aria-labelledby=tailor-changes-h]")).toBeNull();
  });

  it("marks a line the baseline doesn't have as new, with a different bar shape", async () => {
    const { container } = await setup({ saved: "none" });
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    await startCopy(container);
    await click($(container, '[aria-label="Add bullet to Work experience"]'));
    expect($$(container, ".bm-bar.new").length).toBe(1);
  });
});

describe("Write with AI", () => {
  it("reads the chosen baseline, fills the copy, stages the letter, and keeps flagged lines unticked until they are ticked", async () => {
    const { container, db, id, fake, master } = await setup({ replies: [flaggedReply()] });
    await waitFor(() => button(container, "Write with AI") !== null, "the page");
    await click(button(container, "Write with AI"));
    await click(button(strip(container)!, "Write"));
    await waitFor(() => $(container, ".page-editor") !== null, "the draft");
    expect(fake.complete).toHaveBeenCalledTimes(1);
    expect(strip(container)).toBeNull();
    expect(await getTailored(db, id)).toBeUndefined();   // nothing saved yet

    const snow = $$(container, ".tailor-entry[data-line]").find((li) => text(li).includes("Snowflake"))!;
    const box = $(snow, "input[type=checkbox]") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(text(snow)).toMatch(/Snowflake/);
    expect($$(container, ".page-editor textarea").map((t) => (t as HTMLTextAreaElement).value).join(" ")).not.toContain("Snowflake");
    await click(box);
    expect($$(container, ".page-editor textarea").map((t) => (t as HTMLTextAreaElement).value).join(" ")).toContain("Snowflake");

    await click(button(container, "Save"));
    await waitFor(() => text($(container, ".tailor-status")).includes("Saved the tailored resume and cover letter"), "the save");
    const copy = (await getTailored(db, id))!;
    expect(copy.source).toBe("ai");
    expect(copy.basedOn).toBe(master);
    expect((await getCoverLetter(db, id))!.source).toBe("ai");
  });

  it("sends the selected version as the baseline, and records it on the copy", async () => {
    const { container, db, id, versions } = await setup({ versions: ["Data version"], baselineIndex: 0 });
    await waitFor(() => button(container, "Write with AI") !== null, "the page");
    await click(button(container, "Write with AI"));
    await click(button(strip(container)!, "Write"));
    await waitFor(() => $(container, ".page-editor") !== null, "the draft");
    await click(button(container, "Save"));
    await waitFor(() => text($(container, ".tailor-status")).includes("Saved"), "the save");
    expect((await getTailored(db, id))!.basedOn).toBe(versions[0]);
  });

  it("changing the baseline select changes what the AI reads", async () => {
    const { container, fake, versions } = await setup({ versions: ["Data version"] });
    await waitFor(() => $(container, "#tailor-baseline") !== null, "the page");
    await type($(container, "#tailor-baseline"), String(versions[0]));
    await click(button(container, "Write with AI"));
    await click(button(strip(container)!, "Write"));
    await waitFor(() => $(container, ".page-editor") !== null, "the draft");
    expect(fake.complete).toHaveBeenCalledTimes(1);
    expect(($(container, ".tailor-baseline-sheet") as HTMLElement).getAttribute("aria-label")).toBe("Baseline: Data version");
  });

  it("unlocks a locked key in the strip: a wrong passphrase says so, the right one shows Write", async () => {
    const { container, fake } = await setup({ saved: "locked" });
    await waitFor(() => button(container, "Write with AI") !== null, "the page");
    await click(button(container, "Write with AI"));
    expect(button(strip(container)!, "Write")).toBeNull();
    const pass = () => $(strip(container)!, "input[type=password]") as HTMLInputElement | null;
    await type(pass(), "nope");
    await click(button(strip(container)!, "Unlock"));
    expect(fake.unlock).toHaveBeenCalledWith(expect.any(String), "nope");
    expect(text(strip(container))).toContain("That passphrase did not open the key.");
    await type(pass(), "right");
    await click(button(strip(container)!, "Unlock"));
    await waitFor(() => pass() === null, "the form to go");
    expect(button(strip(container)!, "Write")).not.toBeNull();
    expect($(strip(container)!, "select")).not.toBeNull();
  });

  it("asks in place before replacing hand edits, and Keep my edits leaves them", async () => {
    const { container, fake } = await setup();
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    await startCopy(container);
    await type(field(container, BULLET), "My own wording of this bullet.");
    await click(button(container, "Rewrite with AI"));
    await click(button(strip(container)!, "Write"));
    expect(text(strip(container))).toContain("Replace your edits with a new draft?");
    expect(fake.complete).not.toHaveBeenCalled();
    await click(button(strip(container)!, "Keep my edits"));
    expect(field(container, BULLET)!.value).toBe("My own wording of this bullet.");
    await click(button(strip(container)!, "Write"));
    await click(button(strip(container)!, "Replace my edits"));
    await waitFor(() => strip(container) === null, "the draft");
    expect(fake.complete).toHaveBeenCalledTimes(1);
    expect($$(container, ".page-editor textarea").map((t) => (t as HTMLTextAreaElement).value).join(" ")).not.toContain("My own wording");
  });

  it("says a sentence when there is no posting, and keeps the copy as it was", async () => {
    const { container } = await setup({ posting: null });
    await waitFor(() => button(container, "Write with AI") !== null, "the page");
    await click(button(container, "Write with AI"));
    await click(button(strip(container)!, "Write"));
    await waitFor(() => text(strip(container)).includes("Add the job posting first."), "the sentence");
    expect($(container, ".page-editor")).toBeNull();
  });

  it("Stop ends a run without a failure", async () => {
    const { container, fake } = await setup();
    fake.complete.mockImplementation((_k, _r, o) => new Promise((_, reject) => o?.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    await waitFor(() => button(container, "Write with AI") !== null, "the page");
    await click(button(container, "Write with AI"));
    await click(button(strip(container)!, "Write"));
    await waitFor(() => button(strip(container)!, "Stop") !== null, "Stop");
    await click(button(strip(container)!, "Stop"));
    expect(button(strip(container)!, "Write")).not.toBeNull();
    expect($(strip(container)!, ".notice")).toBeNull();
  });
});

describe("the cover letter view", () => {
  it("offers Start a letter and Write with AI, and saves a written draft as the letter", async () => {
    const { container, db, id } = await setup();
    await waitFor(() => button(container, "Cover letter") !== null, "the page");
    await click(button(container, "Cover letter"));
    expect(button(container, "Start a letter")).not.toBeNull();
    await click(button(container, "Write with AI"));
    await click(button(strip(container)!, "Write"));
    await waitFor(() => $(container, "#tailor-letter-draft") !== null, "the letter draft");
    const draft = $(container, "#tailor-letter-draft") as HTMLTextAreaElement;
    expect(draft.value).toContain("Dear hiring team,");
    expect(await getTailored(db, id)).toBeUndefined();
    await click(button(container, "Save letter"));
    await waitFor(() => text($(container, ".tailor-status")) === "Saved the letter.", "the save");
    expect((await getCoverLetter(db, id))!.sections[0].items[0].text).toBe("Dear hiring team,");
    expect(button(container, "Edit")).not.toBeNull();
  });

  it("Start a letter works with no key: a greeting and an empty body", async () => {
    const { container, db, id } = await setup({ saved: "none" });
    await waitFor(() => button(container, "Cover letter") !== null, "the page");
    await click(button(container, "Cover letter"));
    await click(button(container, "Start a letter"));
    const box = $(container, "textarea.doc-letter-text") as HTMLTextAreaElement;
    expect(box.value).toBe("Dear hiring team,\n\n");
    await type(box, "Dear hiring team,\n\nHello there.");
    await click(button(container, "Save"));
    await waitFor(() => $(container, ".doc-letter") !== null, "the saved letter");
    expect((await getCoverLetter(db, id))!.sections[0].items.map((i) => i.text)).toEqual(["Dear hiring team,", "Hello there."]);
  });
});

describe("the posting", () => {
  it("is pasted and saved in place, and the words from it appear", async () => {
    const { container, db, id } = await setup({ posting: null });
    await waitFor(() => $(container, "#posting-" + id) !== null, "the posting box");
    expect($(container, "[aria-labelledby=posting-terms-h]")).toBeNull();
    await type($(container, "#posting-" + id), "We use Snowflake and Tableau every day.");
    await click(button(container, "Save"));
    await waitFor(() => $(container, ".doc-posting-text") !== null, "the saved posting");
    expect((await db.applications.get(id))!.postingText).toBe("We use Snowflake and Tableau every day.");
    expect($(container, "[aria-labelledby=posting-terms-h]")).not.toBeNull();
  });

  it("fills from the application's link", async () => {
    const enrich = vi.fn(async (d: { description?: string }) => ({ ...d, description: "Posting text from the link." }));
    const { container, id } = await setup({ posting: null, postingUrl: "https://jobs.example.com/1", enrich: enrich as never });
    await waitFor(() => button(container, "Fill from link") !== null, "the button");
    await click(button(container, "Fill from link"));
    expect(($(container, "#posting-" + id) as HTMLTextAreaElement).value).toBe("Posting text from the link.");
    expect(enrich).toHaveBeenCalledTimes(1);
  });
});

describe("leaving with unsaved changes", () => {
  it("goes straight back when nothing is unsaved", async () => {
    const { container, visited } = await setup({ saved: "none" });
    await waitFor(() => $(container, "a.back") !== null, "the page");
    await click($(container, "a.back"));
    expect($(container, ".inline-confirm")).toBeNull();
    expect(visited).toEqual([]);
  });

  it("asks in place, and Discard changes goes back", async () => {
    const { container, id, visited } = await setup({ saved: "none" });
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    await startCopy(container);
    await type(field(container, BULLET), "An unsaved edit.");
    await click($(container, "a.back"));
    expect(text($(container, ".inline-confirm"))).toContain("Leave without saving?");
    expect(visited).toEqual([]);
    await click(button($(container, ".inline-confirm")!, "Cancel"));
    expect($(container, ".inline-confirm")).toBeNull();
    await click($(container, "a.back"));
    await click(button($(container, ".inline-confirm")!, "Discard changes"));
    expect(visited).toEqual([`/app/${id}`]);
  });
});

describe("a missing application", () => {
  it("says so with a link to choose another", async () => {
    const { container, db, id } = await setup();
    await waitFor(() => $(container, "h1") !== null, "the page");
    await db.applications.update(id, { deletedAt: new Date().toISOString() });
    await waitFor(() => $(container, ".tailor-empty") !== null, "the sentence");
    expect($(container, ".tailor-empty a")!.getAttribute("href")).toBe("#/tailor");
  });
});

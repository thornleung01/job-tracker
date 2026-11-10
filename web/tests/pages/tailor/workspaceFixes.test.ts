// The Tailor workspace after review: which baseline an existing copy uses, the guard on moving away, one workspace per application, a saved letter
// that a combined Save can't replace, the Baseline select with a live draft, focus after unlocking, and the Print and "No changes" sentences.
import "fake-indexeddb/auto";
import { act, createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blockLeave } from "../../../src/app/leaveGuard";
import type { PageProps } from "../../../src/app/pageProps";
import TailorPage from "../../../src/pages/tailor";
import { deleteDocument, getCoverLetter, getTailored, saveCoverLetter, saveMaster, startTailoredFromBaseline } from "../../../src/sync/documents";
import { MASTER } from "../../ai/tailorFixture";
import { $, $$, addApp, button, cleanup, click, freshDb, mountPage, settle, text, type, waitFor } from "../applications/harness";
import { fakeAi, field, setup } from "./harness";

afterEach(cleanup);
beforeEach(() => localStorage.removeItem("jobtracker:resume-editing"));

const BULLET = "Bullet 3 of Work experience";
const strip = (c: HTMLElement) => $(c, "section.tailor-ai") as HTMLElement | null;
const select = (c: HTMLElement) => $(c, "#tailor-baseline") as HTMLSelectElement;
const status = (c: HTMLElement) => text($(c, ".tailor-status"));

async function startCopy(c: HTMLElement) {
  await click(button(c, "Start from baseline"));
  await waitFor(() => $(c, ".page-editor") !== null, "the editor");
}

async function writeDraft(c: HTMLElement) {
  await click(button(c, "Write with AI"));
  await click(button(strip(c)!, "Write"));
  await waitFor(() => $(c, ".page-editor") !== null, "the draft");
}

describe("which baseline an existing copy uses", () => {
  it("keeps the copy's own baseline over ?baseline=", async () => {
    const { container, versions } = await setup({
      versions: ["A version", "B version"], baselineIndex: 1,
      prepare: async ({ db, id, versions: v }) => void (await startTailoredFromBaseline(db, id, v[0])),
    });
    await waitFor(() => select(container) !== null, "the page");
    expect(select(container).value).toBe(String(versions[0]));
    expect($(container, ".tailor-baseline-sheet")!.getAttribute("aria-label")).toBe("Baseline: A version");
  });

  it("uses ?baseline= when there is no copy yet", async () => {
    const { container, versions } = await setup({ versions: ["A version", "B version"], baselineIndex: 1 });
    await waitFor(() => select(container) !== null, "the page");
    expect(select(container).value).toBe(String(versions[1]));
  });

  it("says when the copy's baseline is gone, compares with the master, and a plain save keeps the recorded baseline", async () => {
    const { container, db, id, master, versions } = await setup({
      versions: ["A version"],
      prepare: async ({ db: d, id: a, versions: v }) => {
        await startTailoredFromBaseline(d, a, v[0]);
        await deleteDocument(d, v[0]);
      },
    });
    await waitFor(() => select(container) !== null, "the page");
    expect(select(container).value).toBe(String(master));
    expect(text(container)).toContain("The baseline this copy was made from is gone, so it is compared with your master.");
    await type(field(container, BULLET), "A new wording of this bullet.");
    await click(button(container, "Save"));
    await waitFor(() => status(container) === "Saved.", "the save");
    expect((await getTailored(db, id))!.basedOn).toBe(versions[0]);
  });

  it("records a baseline only when the person chose one", async () => {
    const { container, db, id, master, versions } = await setup({
      versions: ["A version"],
      prepare: async ({ db: d, id: a }) => void (await startTailoredFromBaseline(d, a, (await d.documents.toArray()).find((x) => x.master)!.id)),
    });
    await waitFor(() => select(container) !== null, "the page");
    await type(field(container, BULLET), "First change to the bullet.");
    await click(button(container, "Save"));
    await waitFor(() => status(container) === "Saved.", "the save");
    expect((await getTailored(db, id))!.basedOn).toBe(master);
    await type(select(container), String(versions[0]));
    await type(field(container, BULLET), "Second change to the bullet.");
    await click(button(container, "Save"));
    await waitFor(() => $$(container, "a.btn[href^='#/resume/print/']").length === 1, "the second save");
    expect((await getTailored(db, id))!.basedOn).toBe(versions[0]);
  });
});

describe("moving away with unsaved changes", () => {
  it("a Shell link, caught by the guard, asks in place and Discard changes goes where the link went", async () => {
    const { container, visited } = await setup({ saved: "none" });
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    expect(blockLeave("#/people")).toBe(false);   // nothing unsaved yet
    await startCopy(container);
    await type(field(container, BULLET), "An unsaved edit.");
    await act(async () => void expect(blockLeave("#/people")).toBe(true));
    expect(text($(container, ".inline-confirm"))).toContain("Leave without saving?");
    expect(visited).toEqual([]);
    await click(button($(container, ".inline-confirm")!, "Cancel"));
    expect($(container, ".inline-confirm")).toBeNull();
    await act(async () => void blockLeave("#/people"));
    await click(button($(container, ".inline-confirm")!, "Discard changes"));
    expect(visited).toEqual(["/people"]);
  });

  it("Back, Forward or an edited address is put back and asks the same question", async () => {
    window.location.hash = "";
    const { container, visited } = await setup({ saved: "none" });
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    await startCopy(container);
    await type(field(container, BULLET), "An unsaved edit.");
    window.location.hash = "#/statistics";
    await waitFor(() => $(container, ".inline-confirm") !== null, "the question");
    expect(window.location.hash).toBe("");
    expect(visited).toEqual([]);
  });

  it("lets a move through when nothing is unsaved", async () => {
    window.location.hash = "";
    const { container } = await setup({ saved: "none" });
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    window.location.hash = "#/statistics";
    await settle();
    expect(window.location.hash).toBe("#/statistics");
    expect($(container, ".inline-confirm")).toBeNull();
    window.location.hash = "";
  });
});

describe("one workspace per application", () => {
  it("does not carry unsaved edits from one application's address to the next", async () => {
    const db = freshDb();
    const one = await addApp(db, "Acme", { role: "Data Analyst" });
    const two = await addApp(db, "Globex", { role: "Planner" });
    await saveMaster(db, MASTER, "paste");
    const fake = fakeAi("none");
    let go: (id: string) => void = () => {};
    const Page = (props: PageProps) => {
      const [id, setId] = useState(String(one));
      go = setId;
      return createElement(TailorPage, { ...props, params: { id }, deps: { ai: fake.ai } });
    };
    const { container } = await mountPage(Page, db, `/tailor/${one}`, { id: String(one) });
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    await startCopy(container);
    await type(field(container, BULLET), "Edits for the first application.");
    await act(async () => go(String(two)));
    await waitFor(() => text($(container, "h1")).includes("Globex"), "the second application");
    await settle();
    expect($(container, ".page-editor")).toBeNull();
    expect(button(container, "Start from baseline")).not.toBeNull();
    expect($(container, ".tailor-actions")).toBeNull();
  });
});

describe("a saved cover letter", () => {
  it("is not staged over by an AI write from the Resume view, and a combined Save leaves it alone", async () => {
    const letter = [{ id: "c1", heading: "", items: [{ id: "p1", text: "My saved letter." }] }];
    const { container, db, id } = await setup({ prepare: async ({ db: d, id: a }) => void (await saveCoverLetter(d, a, letter, "copy")) });
    await waitFor(() => button(container, "Write with AI") !== null, "the page");
    await writeDraft(container);
    expect(text(container)).toContain("Your saved letter was left as it is.");
    await click(button(container, "Cover letter"));
    expect($(container, "#tailor-letter-draft")).toBeNull();
    await click(button(container, "Resume"));
    await click(button(container, "Save"));
    await waitFor(() => status(container) === "Saved.", "the save");
    const saved = (await getCoverLetter(db, id))!;
    expect(saved.sections[0].items[0].text).toBe("My saved letter.");
    expect(saved.source).toBe("copy");
  });
});

describe("the Baseline select while a draft is live", () => {
  it("is disabled with a reason until the draft is saved", async () => {
    const { container } = await setup({ versions: ["A version"] });
    await waitFor(() => select(container) !== null, "the page");
    expect(select(container).disabled).toBe(false);
    await writeDraft(container);
    expect(select(container).disabled).toBe(true);
    const why = $(container, "#tailor-baseline-why")!;
    expect(select(container).getAttribute("aria-describedby")).toBe("tailor-baseline-why");
    expect(text(why)).toContain("Save it to choose another.");
    await click(button(container, "Save"));
    await waitFor(() => status(container).startsWith("Saved"), "the save");
    expect(select(container).disabled).toBe(false);
    expect($(container, "#tailor-baseline-why")).toBeNull();
  });
});

describe("the AI strip", () => {
  it("moves focus to Write after the key is unlocked in place", async () => {
    const { container } = await setup({ saved: "locked" });
    await waitFor(() => button(container, "Write with AI") !== null, "the page");
    await click(button(container, "Write with AI"));
    await type($(strip(container)!, "input[type=password]"), "right");
    await click(button(strip(container)!, "Unlock"));
    await waitFor(() => button(strip(container)!, "Write") !== null, "Write");
    expect(document.activeElement).toBe(button(strip(container)!, "Write"));
  });
});

describe("Print and the changes sentence", () => {
  it("says in visible text why Print is off, tied to the button", async () => {
    const { container } = await setup({ saved: "none" });
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    await startCopy(container);
    await type(field(container, BULLET), "An edit that is not saved yet.");
    const print = button(container, "Print")!;
    expect(print.hasAttribute("title")).toBe(false);
    expect(print.getAttribute("aria-describedby")).toBe("tailor-print-why");
    expect(text($(container, "#tailor-print-why"))).toBe("Save first to print.");
  });

  it("puts 'No changes from the baseline.' into a live region that was already there", async () => {
    const { container } = await setup({ saved: "none" });
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    await startCopy(container);
    const region = $(container, ".tailor-right > div[role=status]")!;
    expect(text(region)).toBe("No changes from the baseline.");
    await type(field(container, BULLET), "Something else entirely.");
    expect(text(region)).toBe("");
    await click(button($(container, ".tailor-entry[data-line=b1]")!, "Reset to baseline"));
    expect($(container, ".tailor-right > div[role=status]")).toBe(region);
    expect(text(region)).toBe("No changes from the baseline.");
  });
});

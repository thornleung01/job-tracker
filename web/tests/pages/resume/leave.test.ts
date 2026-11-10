// The Resume page asks before text you typed and have not saved is lost: closing or reloading the tab, moving to another page of the app, and
// the review's Cancel (which drops what was edited there). Unsaved text in the master, the template or the review all count.
import "fake-indexeddb/auto";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blockLeave } from "../../../src/app/leaveGuard";
import type { DocSection } from "../../../src/db/schema";
import ResumePage from "../../../src/pages/resume";
import { saveMaster } from "../../../src/sync/documents";
import { $, $$, button, cleanup, click, freshDb, mountPage, text, type, waitFor } from "../applications/harness";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  return cleanup();
});
beforeEach(() => localStorage.setItem("jobtracker:resume-editing", "list"));

function closeWarns(): boolean {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
const leaves = async () => {
  let stopped = false;
  await act(async () => void (stopped = blockLeave("#/people")));
  return stopped;
};
const firstLine = (root: ParentNode) => $$(root, "input, textarea").find((e) => /^Line 1 of/.test(e.getAttribute("aria-label") ?? "")) as HTMLInputElement;

let n = 0;
const sec = (heading: string, ...lines: string[]): DocSection => ({ id: `s${++n}`, heading, items: lines.map((t) => ({ id: `i${++n}`, text: t })) });
/** A resume saved before the template, so the page offers to read it again. */
const OLD = (): DocSection[] => [
  sec("JORDAN LEE", "Toronto, ON | 416-555-0100 | jordan@example.com"),
  sec("PROFESSIONAL SUMMARY", "Analyst with six years in fintech", "building dashboards and reports for product teams"),
  sec("WORK EXPERIENCE", "Acme Corp, Toronto, ON", "Senior Analyst Jan 2021 – Present", "Reporting: cut weekly report time from 6 hours to 1"),
  sec("EDUCATION", "University of Toronto, Toronto, ON", "B.Sc. in Statistics, 2018"),
];

async function mount(db: ReturnType<typeof freshDb>) {
  const page = await mountPage(ResumePage, db, "/resume");
  await waitFor(() => $(page.container, ".resume-view") !== null, "the page to load");
  return page;
}

describe("leaving the Resume page with unsaved text", () => {
  it("is free when nothing was typed", async () => {
    const db = freshDb();
    await saveMaster(db, OLD(), "paste");
    const { container } = await mount(db);
    expect(closeWarns()).toBe(false);
    expect(await leaves()).toBe(false);
    expect($(container, ".inline-confirm")).toBeNull();
  });

  it("asks when the master has typed text, warns on close, and Discard changes goes where the link went", async () => {
    const db = freshDb();
    await saveMaster(db, OLD(), "paste");
    const { container, visited } = await mount(db);
    await type(firstLine(container), "Jordan Q. Lee");
    expect(closeWarns()).toBe(true);
    expect(await leaves()).toBe(true);
    expect(text($(container, ".inline-confirm"))).toContain("Leave without saving?");
    await click(button($(container, ".inline-confirm")!, "Cancel"));
    expect(visited).toEqual([]);
    expect(firstLine(container).value).toBe("Jordan Q. Lee");
    expect(await leaves()).toBe(true);
    await click(button($(container, ".inline-confirm")!, "Discard changes"));
    expect(visited).toEqual(["/people"]);
  });

  it("is free again once the text is saved", async () => {
    const db = freshDb();
    await saveMaster(db, OLD(), "paste");
    const { container } = await mount(db);
    await type(firstLine(container), "Jordan Q. Lee");
    await click(button(container, "Save"));
    await waitFor(() => !closeWarns(), "the save to clear the warning");
    expect(await leaves()).toBe(false);
  });

  it("asks when the template has text in it", async () => {
    const db = freshDb();
    const { container } = await mount(db);
    await click(button(container, "Start from the template"));
    expect(await leaves()).toBe(false);
    await type(firstLine(container), "Jordan Lee");
    expect(await leaves()).toBe(true);
  });
});

describe("the review of a re-read resume", () => {
  async function openReview() {
    const db = freshDb();
    await saveMaster(db, OLD(), "paste");
    const page = await mount(db);
    await click(button(page.container, "Re-read"));
    await waitFor(() => $(page.container, ".convert-review") !== null, "the review");
    return page;
  }

  it("closes at once on Cancel when nothing was edited", async () => {
    const { container } = await openReview();
    expect(await leaves()).toBe(false);
    await click(button($(container, ".convert-review")!, "Cancel"));
    expect($(container, ".convert-review")).toBeNull();
  });

  it("asks before Cancel throws away edits, and Keep editing leaves them", async () => {
    const { container } = await openReview();
    const review = () => $(container, ".convert-review") as HTMLElement;
    await type(firstLine(review()), "Edited in the review");
    expect(await leaves()).toBe(true);
    await click(button($(container, ".inline-confirm")!, "Cancel"));   // the leave question
    await click(button(review(), "Cancel"));
    expect(text($(review(), ".inline-confirm"))).toContain("Discard your edits?");
    await click(button($(review(), ".inline-confirm")!, "Cancel"));
    expect(review()).not.toBeNull();
    expect(firstLine(review()).value).toBe("Edited in the review");
    await click(button(review(), "Cancel"));
    await click(button($(review(), ".inline-confirm")!, "Discard edits"));
    expect($(container, ".convert-review")).toBeNull();
    expect(await leaves()).toBe(false);
  });
});

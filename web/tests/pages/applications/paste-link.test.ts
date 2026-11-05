import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { $, $$, button, cleanup, click, freshDb, key, mountPage, settle, submitForm, text, type, waitFor } from "./harness";
import { deferred, draft, field, openForm, paste, result, withFakes } from "./paste-helpers";
import type { JobDraft } from "../../../src/jobs/types";

afterEach(cleanup);
beforeEach(() => {
  window.confirm = vi.fn(() => true);
});

describe("paste a job link", () => {
  it("shows the field and a quiet Fill in details button, and the form still works with no link", async () => {
    const db = freshDb();
    const { Page, deps } = withFakes();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    const slot = $(container, "#add-link-slot")!;
    expect(text($(slot, "label[for=add-link]"))).toBe("Paste a job link");
    const input = field(container, "add-link");
    expect([input.type, input.getAttribute("inputmode")]).toEqual(["text", "url"]);
    const fill = button(slot, "Fill in details")!;
    expect(fill.classList.contains("primary")).toBe(false);
    expect($$(container, "#add-application button.primary")).toHaveLength(1);
    await type($(container, "#add-company"), "Plain Co");
    await click(button(container, "Save application"));
    await waitFor(() => !$(container, "#add-application"));
    expect((await db.applications.toArray()).map((a) => a.company)).toEqual(["Plain Co"]);
    expect(deps.parseJobUrl).not.toHaveBeenCalled();
  });

  it("fills company, role and the posting link a moment after a paste, not on every keystroke", async () => {
    const db = freshDb();
    const { Page, deps } = withFakes();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://jobs.example.com/p/1");
    await settle(0);
    expect(deps.parseJobUrl).not.toHaveBeenCalled();
    expect(field(container, "add-company").value).toBe("");
    await paste(container, "https://jobs.example.com/p/1");
    expect(deps.parseJobUrl).not.toHaveBeenCalled();
    await waitFor(() => field(container, "add-company").value === "Stripe");
    expect(deps.parseJobUrl).toHaveBeenCalledTimes(1);
    expect(deps.parseJobUrl).toHaveBeenCalledWith("https://jobs.example.com/p/1");
    expect(field(container, "add-role").value).toBe("Software Engineer");
    expect(field(container, "add-url").value).toBe("https://jobs.example.com/p/1");
    expect(result(container)).toBe("Guessed from the link. Check the company and role.");
  });

  it("fills on the Fill in button and on Enter, and Enter does not submit the form", async () => {
    const db = freshDb();
    const { Page } = withFakes();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://jobs.example.com/p/1");
    await click(button(container, "Fill in details"));
    expect(field(container, "add-company").value).toBe("Stripe");
    await type(field(container, "add-company"), "");
    await type(field(container, "add-role"), "");
    await key(field(container, "add-link"), "Enter");
    expect(field(container, "add-company").value).toBe("Stripe");
    expect($(container, "#add-application")).not.toBeNull();
    expect(await db.applications.count()).toBe(0);
  });

  it("never overwrites text you typed, and says so", async () => {
    const db = freshDb();
    const { Page } = withFakes();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-company"), "My own company");
    await type(field(container, "add-link"), "https://jobs.example.com/p/1");
    await click(button(container, "Fill in details"));
    expect(field(container, "add-company").value).toBe("My own company");
    expect(field(container, "add-role").value).toBe("Software Engineer");
    expect($(container, "#add-company-hint")).toBeNull();
    await type(field(container, "add-role"), "Staff designer");
    await click(button(container, "Fill in details"));
    expect(field(container, "add-role").value).toBe("Staff designer");
    expect(result(container)).toBe("Kept what you typed. Check the company and role.");
  });

  it("replaces a value it filled earlier when you press Fill in with a different link", async () => {
    const db = freshDb();
    const next = draft({ company: "Notion", role: "Designer", url: "https://jobs.example.com/p/2" });
    const { Page, deps } = withFakes();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://jobs.example.com/p/1");
    await click(button(container, "Fill in details"));
    deps.parseJobUrl.mockReturnValueOnce(next);
    await type(field(container, "add-link"), "https://jobs.example.com/p/2");
    await click(button(container, "Fill in details"));
    expect([field(container, "add-company").value, field(container, "add-role").value, field(container, "add-url").value]).toEqual(["Notion", "Designer", "https://jobs.example.com/p/2"]);
    expect($(container, "#add-company-hint")).toBeNull();
    expect(result(container)).toBe("Filled in from the link: Notion, Designer.");
  });

  it("marks guessed fields, ties the hint to the field, and clears it when you edit that field", async () => {
    const db = freshDb();
    const { Page } = withFakes();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://jobs.example.com/p/1");
    await click(button(container, "Fill in details"));
    const hint = $(container, "#add-company-hint")!;
    expect(text(hint)).toBe("Guessed from the link");
    expect(field(container, "add-company").getAttribute("aria-describedby")).toBe("add-company-hint");
    expect(text($(container, "#add-role-hint"))).toBe("Guessed from the link");
    await type(field(container, "add-company"), "Stripe Inc");
    expect($(container, "#add-company-hint")).toBeNull();
    expect(field(container, "add-company").getAttribute("aria-describedby")).toBeNull();
    expect($(container, "#add-role-hint")).not.toBeNull();
  });

  it("asks the job board in the background, then updates what is still auto-filled but not what you edited", async () => {
    const db = freshDb();
    const gate = deferred<JobDraft>();
    const { Page, deps } = withFakes({ enrichJobDraft: vi.fn((_d: JobDraft, _o?: { signal?: AbortSignal }) => gate.promise) });
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://boards.greenhouse.io/stripe/jobs/1");
    await click(button(container, "Fill in details"));
    const checking = $(container, "#add-link-checking")!;
    expect(checking.getAttribute("role")).toBe("status");
    expect(checking.hasAttribute("aria-busy")).toBe(false);   // a busy live region is not announced, and this one exists to be heard
    expect(text(checking)).toBe("Checking the job board");
    expect(deps.enrichJobDraft.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    // The form stays usable meanwhile.
    expect(button(container, "Save application")!.hasAttribute("disabled")).toBe(false);
    await type(field(container, "add-role"), "My title");
    const enriched = draft({ company: "Stripe, Inc.", role: "Software Engineer, Payments", url: "https://boards.greenhouse.io/stripe/jobs/1", source: "api" });
    await act(async () => gate.resolve(enriched));
    await settle();
    expect(field(container, "add-company").value).toBe("Stripe, Inc.");
    expect(field(container, "add-role").value).toBe("My title");
    expect($(container, "#add-company-hint")).toBeNull();
    expect(text(checking)).toBe("");
    expect(result(container)).toBe("Filled in from Greenhouse: Stripe, Inc.");
  });

  it("aborts the check when the form is closed, and a late answer changes nothing", async () => {
    const db = freshDb();
    const gate = deferred<JobDraft>();
    const { Page, deps } = withFakes({ enrichJobDraft: vi.fn((_d: JobDraft, _o?: { signal?: AbortSignal }) => gate.promise) });
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://boards.greenhouse.io/stripe/jobs/1");
    await click(button(container, "Fill in details"));
    const signal = deps.enrichJobDraft.mock.calls[0][1]!.signal!;
    expect(signal.aborted).toBe(false);
    await click(button(container, "Cancel"));
    expect(signal.aborted).toBe(true);
    await act(async () => gate.resolve(draft({ company: "Late Co", role: "Late role", source: "api" })));
    await openForm(container);
    expect(field(container, "add-company").value).toBe("Stripe");
    expect(field(container, "add-link").value).toBe("");
    expect(result(container)).toBe("");
  });

  it("aborts the check when the link changes and when the page goes away", async () => {
    const db = freshDb();
    const gate = deferred<JobDraft>();
    const { Page, deps } = withFakes({ enrichJobDraft: vi.fn((_d: JobDraft, _o?: { signal?: AbortSignal }) => gate.promise) });
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://boards.greenhouse.io/stripe/jobs/1");
    await click(button(container, "Fill in details"));
    const first = deps.enrichJobDraft.mock.calls[0][1]!.signal!;
    await type(field(container, "add-link"), "https://boards.greenhouse.io/stripe/jobs/12");
    expect(first.aborted).toBe(true);
    expect(text($(container, "#add-link-checking"))).toBe("");
    await click(button(container, "Fill in details"));
    const second = deps.enrichJobDraft.mock.calls[1][1]!.signal!;
    expect(second.aborted).toBe(false);
    await cleanup();
    expect(second.aborted).toBe(true);
  });

  it("says plainly when nothing could be read, and points at the bookmarklet in Settings", async () => {
    const db = freshDb();
    const { Page } = withFakes({ parseJobUrl: vi.fn((_raw: string) => draft({ url: "https://www.linkedin.com/jobs/view/1" })) });
    const { container, visited } = await mountPage(Page, db);
    await openForm(container);
    expect(text($(container, "#add-link-slot"))).not.toContain("bookmarklet");
    await type(field(container, "add-link"), "https://www.linkedin.com/jobs/view/1");
    await click(button(container, "Fill in details"));
    expect(result(container)).toBe("We couldn't read details from this link. Add them below.");
    expect(field(container, "add-company").value).toBe("");
    const slot = $(container, "#add-link-slot")!;
    expect(text(slot)).toContain("LinkedIn, Indeed or a company site? Use the Save to Job Tracker bookmarklet in Settings.");
    await click($(slot, "a[href='#/settings']"));
    expect(visited.at(-1)).toBe("/settings");
  });

  it("says so when the text is not a web address at all", async () => {
    const db = freshDb();
    const { Page } = withFakes({ parseJobUrl: vi.fn((_raw: string) => null) });
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "not a link");
    await click(button(container, "Fill in details"));
    expect(result(container)).toBe("We couldn't read details from this link. Add them below.");
    await type(field(container, "add-link"), "");
    await click(button(container, "Fill in details"));
    expect(result(container)).toBe("Paste a link first.");
  });

  it("reads pasted job text from a collapsed box, with the link as context", async () => {
    const db = freshDb();
    const fromText = draft({ company: "Shopify", role: "Data Scientist", source: "paste", guessed: { company: true, role: true } });
    const { Page, deps } = withFakes({ parsePastedText: vi.fn((_t: string, _u?: string) => fromText) });
    const { container } = await mountPage(Page, db);
    await openForm(container);
    const toggle = button(container, "Or paste the job text instead")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect($(container, "#add-paste")).toBeNull();
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(text($(container, "label[for=add-paste]"))).toBe("Paste the job posting text");
    const box = $(container, "#add-paste") as HTMLTextAreaElement;
    expect(box.maxLength).toBe(200_000);
    expect(button(container, "Read the text")!.classList.contains("primary")).toBe(false);
    await type(box, "Shopify is hiring a Data Scientist");
    await click(button(container, "Read the text"));
    expect(deps.parsePastedText).toHaveBeenCalledWith("Shopify is hiring a Data Scientist", undefined);
    expect([field(container, "add-company").value, field(container, "add-role").value]).toEqual(["Shopify", "Data Scientist"]);
    expect(text($(container, "#add-company-hint"))).toBe("Guessed from the text");
    expect(result(container)).toBe("Guessed from the text. Check the company and role.");
    await type(box, "nothing here");
    deps.parsePastedText.mockReturnValueOnce(null);
    await click(button(container, "Read the text"));
    expect(result(container)).toBe("We couldn't read details from that text. Add them below.");
  });

  it("shows hostile values as plain text", async () => {
    const db = freshDb();
    const evil = draft({ company: "<img src=x onerror=alert(1)>", role: "<b>Boss</b>", location: "<script>x</script>", url: "https://e.example/p", source: "paste", guessed: { company: true } });
    const { Page } = withFakes({ parseJobUrl: vi.fn((_raw: string) => evil) });
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://e.example/p");
    await click(button(container, "Fill in details"));
    expect(field(container, "add-company").value).toBe("<img src=x onerror=alert(1)>");
    expect($(container, "#add-application img, #add-application script, #add-application b")).toBeNull();
    expect(result(container)).toContain("<script>x</script>");
  });

  it("saves the link with the application, and clears the link field, hints and result afterwards", async () => {
    const db = freshDb();
    const { Page } = withFakes();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://jobs.example.com/p/1");
    await click(button(container, "Fill in details"));
    await click(button(container, "Save application"));
    await waitFor(() => !$(container, "#add-application"));
    const saved = (await db.applications.toArray()).find((a) => a.company === "Stripe")!;
    expect(saved.postingUrl).toBe("https://jobs.example.com/p/1");
    await openForm(container);
    expect(field(container, "add-link").value).toBe("");
    expect(field(container, "add-url").value).toBe("");
    expect($(container, "#add-company-hint")).toBeNull();
    expect(result(container)).toBe("");
  });

  it("shows a bad posting link in the form's alert and keeps what you typed", async () => {
    const db = freshDb();
    const { Page } = withFakes();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-company"), "Acme");
    await type(field(container, "add-url"), "javascript:alert(1)");
    await submitForm($(container, "#add-application form"));
    const alert = $(container, "#add-application .notice.err")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(text(alert)).toBe("That link doesn't look right. Use a web address that starts with https://.");
    expect(field(container, "add-company").value).toBe("Acme");
    expect(await db.applications.count()).toBe(0);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { boardName, describeDraft, guessedHint, KEPT_TYPED, NOTHING_FROM_LINK, NOTHING_FROM_TEXT } from "../../../src/components/joblink/describe";
import { JobLinkField } from "../../../src/components/joblink/JobLinkField";
import { PASTE_DEBOUNCE_MS, useJobLink, type JobLinkFill } from "../../../src/components/joblink/useJobLink";
import type { JobLinkDeps } from "../../../src/components/joblink/deps";
import { EMPTY_DRAFT, type JobDraft } from "../../../src/jobs/types";
import { advance, fakeTimeouts } from "../../support/timers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const draft = (o: Omit<Partial<JobDraft>, "guessed"> & { guessed?: Partial<JobDraft["guessed"]> } = {}): JobDraft => ({ ...EMPTY_DRAFT, ...o, guessed: { company: false, role: false, ...o.guessed } });
const both = { company: true, role: true };

describe("describeDraft", () => {
  it("names the job board for a confirmed draft", () => {
    const d = draft({ company: "Stripe", role: "Software Engineer", source: "api", url: "https://boards.greenhouse.io/stripe/jobs/1" });
    expect(describeDraft(d, both)).toBe("Filled in from Greenhouse: Stripe, Software Engineer.");
    expect(describeDraft(draft({ ...d, role: "" }), { company: true, role: false })).toBe("Filled in from Greenhouse: Stripe.");
  });
  it("asks for a check when a field is a guess, and adds the place", () => {
    const d = draft({ company: "Stripe", role: "Engineer", location: "Toronto", guessed: both });
    expect(describeDraft(d, both)).toBe("Guessed from the link. Check the company and role. Location: Toronto.");
    expect(describeDraft(draft({ ...d, source: "paste" }), both)).toBe("Guessed from the text. Check the company and role. Location: Toronto.");
  });
  it("reports a reliable read from a link or text", () => {
    expect(describeDraft(draft({ company: "Stripe", role: "Engineer" }), both)).toBe("Filled in from the link: Stripe, Engineer.");
    expect(describeDraft(draft({ company: "Stripe", source: "paste" }), { company: true, role: false })).toBe("Filled in from the text: Stripe.");
  });
  it("says when nothing was read, and when your own text was kept", () => {
    expect(describeDraft(draft(), { company: false, role: false })).toBe(NOTHING_FROM_LINK);
    expect(describeDraft(draft({ source: "paste" }), { company: false, role: false })).toBe(NOTHING_FROM_TEXT);
    expect(describeDraft(draft({ company: "Stripe" }), { company: false, role: false })).toBe(KEPT_TYPED);
  });
  it("uses the fixed line for the bookmarklet", () => {
    expect(describeDraft(draft({ source: "bookmarklet", company: "A" }), both)).toBe("Filled in from the page you were viewing. Check it, then save.");
  });
  it("picks the hint wording by source", () => {
    expect([guessedHint("link"), guessedHint("api"), guessedHint("paste"), guessedHint("bookmarklet")]).toEqual(["Guessed from the link", "Guessed from the link", "Guessed from the text", "Guessed from the page"]);
  });
  it("reads board names from the host only", () => {
    expect([boardName("https://jobs.lever.co/x/1"), boardName("https://jobs.ashbyhq.com/x"), boardName("https://careers.smartrecruiters.com/x"), boardName("https://evil.example/greenhouse.io"), boardName("nope")])
      .toEqual(["Lever", "Ashby", "SmartRecruiters", "the job board", "the job board"]);
  });
});

// -- the field, with a stub link ---------------------------------------------------------------------------------

let root: Root | null = null;
let box: HTMLElement | null = null;
afterEach(async () => {
  vi.useRealTimers();
  if (root) await act(async () => root!.unmount());
  box?.remove();
  root = box = null;
});

const stub = (o: Partial<JobLinkFill> = {}): JobLinkFill => ({
  linkText: "", onLinkChange: vi.fn(), onLinkPaste: vi.fn(), fillFromLink: vi.fn(), pasteOpen: false, setPasteOpen: vi.fn(), pasteText: "", setPasteText: vi.fn(),
  readPastedText: vi.fn(), result: "", checking: false, hints: { company: null, role: null }, unreadable: false, edited: vi.fn(), adopt: vi.fn(), reset: vi.fn(), ...o,
});

async function mount(link: JobLinkFill, navigate = vi.fn()) {
  if (root) {
    await act(async () => root!.unmount());
    box!.remove();
  }
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  await act(async () => root!.render(h("form", null, h(JobLinkField, { link, navigate }))));
  return box;
}

describe("JobLinkField", () => {
  it("has the label, a quiet button and two live regions that exist before they have words", async () => {
    const el = await mount(stub());
    expect(el.querySelector("label[for=add-link]")?.textContent).toBe("Paste a job link");
    expect(el.querySelector("button.quiet")?.textContent).toBe("Fill in details");
    expect(el.querySelector("button.primary")).toBeNull();
    expect(el.querySelectorAll("[role=status]")).toHaveLength(2);
    const input = el.querySelector("#add-link") as HTMLInputElement;
    expect([input.type, input.getAttribute("inputmode")]).toEqual(["text", "url"]);
    expect(input.getAttribute("aria-describedby")).toContain("add-link-result");
  });

  it("turns Enter into Fill in without submitting the form", async () => {
    const link = stub();
    const el = await mount(link);
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => el.querySelector("#add-link")!.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(link.fillFromLink).toHaveBeenCalledTimes(1);
  });

  it("shows the checking line only while checking (never aria-busy, which would keep it from being announced), and the result as text", async () => {
    const el = await mount(stub({ checking: true, result: "<b>Hi</b>" }));
    const checking = el.querySelector("#add-link-checking")!;
    expect([checking.hasAttribute("aria-busy"), checking.textContent]).toEqual([false, "Checking the job board"]);
    expect(el.querySelector("#add-link-result")?.textContent).toBe("<b>Hi</b>");
    expect(el.querySelector("#add-link-result b")).toBeNull();
  });

  it("keeps the text box collapsed until asked", async () => {
    const setPasteOpen = vi.fn();
    let el = await mount(stub({ setPasteOpen }));
    expect(el.querySelector("#add-paste")).toBeNull();
    const toggle = [...el.querySelectorAll("button")].find((b) => b.textContent === "Or paste the job text instead")!;
    await act(async () => toggle.click());
    expect(setPasteOpen).toHaveBeenCalledWith(true);
    el = await mount(stub({ pasteOpen: true }));
    expect((el.querySelector("#add-paste") as HTMLTextAreaElement).maxLength).toBe(200_000);
    expect(el.querySelector("label[for=add-paste]")?.textContent).toBe("Paste the job posting text");
  });

  it("links to Settings through navigate, and only when nothing could be read", async () => {
    const navigate = vi.fn();
    let el = await mount(stub(), navigate);
    expect(el.querySelector("a")).toBeNull();
    el = await mount(stub({ unreadable: true }), navigate);
    const a = el.querySelector("a")!;
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => a.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/settings");
    expect(el.textContent).toContain("LinkedIn, Indeed or a company site? Use the Save to Job Tracker bookmarklet in Settings.");
  });
});

// -- the hook, through a tiny form --------------------------------------------------------------------------------

describe("useJobLink", () => {
  const GUESS = draft({ company: "Stripe", role: "Engineer", url: "https://jobs.example.com/1", guessed: both });
  let link!: JobLinkFill;
  let values!: { company: string; role: string; url: string };

  async function setup(deps: Partial<JobLinkDeps>) {
    const Form = () => {
      const [company, setCompany] = useState("");
      const [role, setRole] = useState("");
      const [url, setUrl] = useState("");
      values = { company, role, url };
      link = useJobLink({ company, role, url }, { company: setCompany, role: setRole, url: setUrl }, deps);
      return h("span", null, "form");
    };
    box = document.createElement("div");
    document.body.append(box);
    root = createRoot(box);
    await act(async () => root!.render(h(Form)));
  }

  it("does not read the link until the debounce after a paste has passed", async () => {
    const parseJobUrl = vi.fn(() => GUESS);
    await setup({ parseJobUrl, enrichJobDraft: async (d) => d });
    fakeTimeouts();
    await act(async () => link.onLinkChange("https://jobs.example.com/1"));
    await act(async () => link.onLinkPaste());
    await advance(PASTE_DEBOUNCE_MS - 1);
    expect(parseJobUrl).not.toHaveBeenCalled();
    await advance(1);
    expect(parseJobUrl).toHaveBeenCalledTimes(1);
    expect(values).toEqual({ company: "Stripe", role: "Engineer", url: "https://jobs.example.com/1" });
  });

  it("drops a pending paste read when the form is reset", async () => {
    const parseJobUrl = vi.fn(() => GUESS);
    await setup({ parseJobUrl });
    fakeTimeouts();
    await act(async () => link.onLinkChange("https://jobs.example.com/1"));
    await act(async () => link.onLinkPaste());
    await act(async () => link.reset());
    await advance(PASTE_DEBOUNCE_MS * 2);
    expect(parseJobUrl).not.toHaveBeenCalled();
  });

  it("treats a failed check as no news: the link guess stays", async () => {
    await setup({ parseJobUrl: () => GUESS, enrichJobDraft: () => Promise.reject(new Error("offline")) });
    await act(async () => link.onLinkChange("https://jobs.example.com/1"));
    await act(async () => link.fillFromLink());
    expect(link.checking).toBe(false);
    expect(values.company).toBe("Stripe");
    expect(link.result).toBe("Guessed from the link. Check the company and role.");
  });
});

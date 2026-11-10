// The on-page editor: the classic sheet with every text a field, its add/remove/move controls, keyboard and paste, and the switch around it.
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageEditor, measureEditableSheet } from "../../../src/components/documents/PageEditor";
import { ResumeEditing } from "../../../src/components/documents/ResumeEditing";
import { MAX_DOC_ITEMS, MAX_DOC_SECTIONS } from "../../../src/db/limits";
import type { DocSection } from "../../../src/db/schema";
import { blankResume, PLACEHOLDERS } from "../../../src/documents/blankResume";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: { root: Root; container: HTMLElement }[] = [];
let latest: DocSection[] = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

function mountNode(make: (initial: DocSection[], set: (s: DocSection[]) => void) => React.ReactElement, initial: DocSection[]): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  function Host() {
    const [sections, setSections] = useState(initial);
    latest = sections;
    return make(sections, setSections);
  }
  act(() => root.render(createElement(Host)));
  return container;
}
const mount = (initial: DocSection[], extra: Record<string, unknown> = {}) =>
  mountNode((sections, onChange) => createElement(PageEditor, { sections, onChange, label: "Test resume", ...extra }), initial);

const sample = (): DocSection[] => [
  { id: "h", heading: "Header", items: [{ id: "n", text: "Jordan Lee" }, { id: "c", text: "Toronto | jordan@example.com" }] },
  { id: "s1", heading: "Work experience", items: [
    { id: "o", text: "Acme", kind: "org", right: "Toronto" },
    { id: "t", text: "Analyst", kind: "title", right: "2020 – 2022" },
    { id: "b1", text: "Cut close time", kind: "bullet", label: "Reporting" },
    { id: "b2", text: "Built a model", kind: "bullet", label: "Modelling" },
  ] },
  { id: "s2", heading: "Skills", items: [{ id: "k", text: "SQL, Python", kind: "skill", label: "Analytics" }] },
  { id: "s3", heading: "Summary", items: [{ id: "p", text: "Analyst with five years" }] },
];

type Any = HTMLInputElement & HTMLTextAreaElement & HTMLButtonElement;
const $ = (root: ParentNode, sel: string) => root.querySelector(sel);
const named = (root: ParentNode, name: string) => $(root, `[aria-label="${name}"]`) as Any | null;
const get = (root: ParentNode, name: string) => {
  const el = named(root, name);
  if (!el) throw new Error(`No element named "${name}"`);
  return el;
};
const buttonText = (root: ParentNode, text: string) => [...root.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;

function type(el: Element, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const click = (el: Element) => act(() => (el as HTMLElement).click());
function press(el: Element, key: string, init: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}
function paste(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.assign(ev, { clipboardData: { getData: () => text } });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}
const active = () => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label");

describe("PageEditor rendering", () => {
  it("is the classic sheet, a named group, with every kind as its own field", () => {
    const c = mount(sample());
    const sheet = $(c, ".doc-sheet.classic")!;
    expect(sheet.getAttribute("role")).toBe("group");
    expect(sheet.getAttribute("aria-label")).toBe("Test resume");
    expect(get(c, "Name").value).toBe("Jordan Lee");
    expect($(c, "h1.doc-name input")).toBe(get(c, "Name"));
    expect(get(c, "Contact line").value).toBe("Toronto | jordan@example.com");
    expect(get(c, "Heading of section 2").value).toBe("Work experience");
    expect($(c, "h2 input")).toBe(get(c, "Heading of section 2"));
    expect(get(c, "Job 1 of Work experience").value).toBe("Acme");
    expect(get(c, "Location of job 1 of Work experience").value).toBe("Toronto");
    expect(get(c, "Job title 2 of Work experience").value).toBe("Analyst");
    expect(get(c, "Dates of job title 2 of Work experience").value).toBe("2020 – 2022");
    expect(get(c, "Label of bullet 3 of Work experience").value).toBe("Reporting");
    expect(get(c, "Bullet 3 of Work experience").tagName).toBe("TEXTAREA");
    expect(get(c, "Label of skill 1 of Skills").value).toBe("Analytics");
    expect(get(c, "Line 1 of Summary").value).toBe("Analyst with five years");
    // the same markup classes as the read-only sheet
    expect(c.querySelectorAll("ul.doc-bullets li")).toHaveLength(2);
    expect($(c, ".doc-org .doc-right")).not.toBeNull();
    expect($(c, ".doc-title")).not.toBeNull();
  });

  it("shows placeholders from placeholderFor on empty fields", () => {
    const c = mount(blankResume());
    expect(get(c, "Name").placeholder).toBe(PLACEHOLDERS.name);
    expect(get(c, "Contact line").placeholder).toBe(PLACEHOLDERS.contact);
    expect(get(c, "Line 1 of Professional summary").placeholder).toBe(PLACEHOLDERS.summary);
    expect(get(c, "Label of skill 1 of Skills and qualifications").placeholder).toBe(PLACEHOLDERS.skill.label);
    expect(get(c, "Job 1 of Work experience").placeholder).toBe(PLACEHOLDERS.org.text);
    expect(get(c, "Dates of job title 2 of Work experience").placeholder).toBe(PLACEHOLDERS.title.right);
    expect(get(c, "Bullet 3 of Work experience").placeholder).toBe(PLACEHOLDERS.bullet.text);
    expect(get(c, "Line 2 of Education").placeholder).toBe(PLACEHOLDERS.degree);
  });

  it("uses the title as the name placeholder only when there is no header", () => {
    expect(get(mount(sample().slice(1), { title: "Resume for data roles" }), "Name").placeholder).toBe("Resume for data roles");
    expect(get(mount(sample(), { title: "Resume for data roles" }), "Name").placeholder).toBe(PLACEHOLDERS.name);
  });

  it("limits each field to the saved lengths", () => {
    const c = mount(sample());
    expect(get(c, "Bullet 3 of Work experience").maxLength).toBe(1000);
    expect(get(c, "Label of bullet 3 of Work experience").maxLength).toBe(60);
    expect(get(c, "Location of job 1 of Work experience").maxLength).toBe(80);
    expect(get(c, "Heading of section 2").maxLength).toBe(80);
  });

  it("keeps a legacy section of plain lines a plain list", () => {
    const c = mount([{ id: "s", heading: "Skills", items: [{ id: "a", text: "SQL" }, { id: "b", text: "Python" }] }]);
    expect(c.querySelectorAll("ul:not(.doc-bullets) li")).toHaveLength(2);
    expect(get(c, "Line 2 of Skills").value).toBe("Python");
  });
});

describe("editing", () => {
  it("updates the text and keeps every id", () => {
    const c = mount(sample());
    type(get(c, "Bullet 3 of Work experience"), "Cut close time by 3 days");
    type(get(c, "Label of bullet 3 of Work experience"), "Finance");
    type(get(c, "Location of job 1 of Work experience"), "Ottawa");
    type(get(c, "Heading of section 3"), "Technical skills");
    const items = latest[1].items;
    expect(items.map((i) => i.id)).toEqual(["o", "t", "b1", "b2"]);
    expect(items[2]).toMatchObject({ text: "Cut close time by 3 days", label: "Finance", kind: "bullet" });
    expect(items[0].right).toBe("Ottawa");
    expect(latest[2].heading).toBe("Technical skills");
    expect(latest.map((s) => s.id)).toEqual(["h", "s1", "s2", "s3"]);
  });

  it("edits the name and contact line in the header", () => {
    const c = mount(sample());
    type(get(c, "Name"), "Jo Lee");
    type(get(c, "Contact line"), "Ottawa");
    expect(latest[0].items.map((i) => [i.id, i.text])).toEqual([["n", "Jo Lee"], ["c", "Ottawa"]]);
  });

  it("makes the header on the first edit when there is none, and keeps typing in the same field", () => {
    const c = mount(sample().slice(1));
    const contact = get(c, "Contact line");
    type(contact, "A");
    expect(latest[0].heading).toBe("Header");
    expect(latest[0].items.map((i) => i.text)).toEqual(["", "A"]);
    expect(get(c, "Contact line")).toBe(contact);
    type(contact, "AB");
    expect(latest[0].items[1].text).toBe("AB");
    expect(latest[0].items).toHaveLength(2);
  });
});

describe("adding, removing and moving", () => {
  const names = (c: HTMLElement) => [...c.querySelectorAll('[aria-label="Add to Work experience"] button')].map((b) => b.textContent);
  const job = (kind: "org" | "title") => [{ id: "s", heading: "Work experience", items: [{ id: "x", text: "A", kind }] }];

  it("adds the likely next line first: a title after a job, a bullet after a title", () => {
    expect(names(mount(job("org")))[0]).toBe("Add title");
    const c = mount(job("title"));
    expect(names(c)[0]).toBe("Add bullet");
    expect(names(c)).toEqual(expect.arrayContaining(["Add job", "Add title", "Add bullet", "Add skill", "Add school", "Add line", "Remove section"]));
  });

  it("adds a line of the chosen kind at the end of its section and focuses it", () => {
    const c = mount(sample());
    click(get(c, "Add bullet to Work experience"));
    const items = latest[1].items;
    expect(items).toHaveLength(5);
    expect(items[4]).toMatchObject({ text: "", kind: "bullet" });
    expect(document.activeElement).toBe(get(c, "Label of bullet 5 of Work experience"));
    click(get(c, "Add job to Work experience"));
    expect(latest[1].items[5].kind).toBe("org");
    expect(document.activeElement).toBe(get(c, "Job 6 of Work experience"));
  });

  it("adds a section with a focused heading, and removes a section", () => {
    const c = mount(sample());
    click(buttonText(c, "Add section"));
    expect(latest).toHaveLength(5);
    expect(latest[4].heading).toBe("");
    expect(document.activeElement).toBe(get(c, "Heading of section 5"));
    click(get(c, "Remove section Skills"));
    expect(latest.map((s) => s.id)).not.toContain("s2");
  });

  it("removes a line and moves focus to the field before it", () => {
    const c = mount(sample());
    click(get(c, "Remove bullet 4 of Work experience"));
    expect(latest[1].items.map((i) => i.id)).toEqual(["o", "t", "b1"]);
    expect(document.activeElement).toBe(get(c, "Bullet 3 of Work experience"));
  });

  it("moves a line up and down and keeps focus on its button", () => {
    const c = mount(sample());
    click(get(c, "Move bullet 4 of Work experience up"));
    expect(latest[1].items.map((i) => i.id)).toEqual(["o", "t", "b2", "b1"]);
    expect(active()).toBe("Move bullet 3 of Work experience up");
    click(get(c, "Move bullet 3 of Work experience down"));
    expect(latest[1].items.map((i) => i.id)).toEqual(["o", "t", "b1", "b2"]);
    expect(get(c, "Move job 1 of Work experience up").disabled).toBe(true);
    expect(get(c, "Move bullet 4 of Work experience down").disabled).toBe(true);
  });

  it("disables the add buttons at the limits", () => {
    const many = Array.from({ length: MAX_DOC_ITEMS }, (_, i) => ({ id: `x${i}`, text: "x", kind: "bullet" as const }));
    const c = mount([{ id: "s", heading: "Work experience", items: many }]);
    expect(get(c, "Add bullet to Work experience").disabled).toBe(true);
    expect(get(c, "Add job to Work experience").disabled).toBe(true);
    const sections = Array.from({ length: MAX_DOC_SECTIONS }, (_, i) => ({ id: `s${i}`, heading: `H${i}`, items: [{ id: `i${i}`, text: "x" }] }));
    expect(buttonText(mount(sections), "Add section").disabled).toBe(true);
  });
});

describe("keyboard and paste", () => {
  it("Shift+Enter in a bullet is a newline, Enter adds a bullet below it and focuses it", () => {
    const c = mount(sample());
    const shift = press(get(c, "Bullet 3 of Work experience"), "Enter", { shiftKey: true });
    expect(shift.defaultPrevented).toBe(false);
    expect(latest[1].items).toHaveLength(4);
    const ev = press(get(c, "Bullet 3 of Work experience"), "Enter");
    expect(ev.defaultPrevented).toBe(true);
    expect(latest[1].items).toHaveLength(5);
    expect(latest[1].items[3]).toMatchObject({ kind: "bullet", text: "" });
    expect(latest[1].items[4].id).toBe("b2");
    expect(document.activeElement).toBe(get(c, "Label of bullet 4 of Work experience"));
  });

  it("Backspace in an empty bullet removes it and focuses the previous field", () => {
    const s = sample();
    s[1].items[3] = { id: "b2", text: "", kind: "bullet" };
    const c = mount(s);
    const ev = press(get(c, "Bullet 4 of Work experience"), "Backspace");
    expect(ev.defaultPrevented).toBe(true);
    expect(latest[1].items.map((i) => i.id)).toEqual(["o", "t", "b1"]);
    expect(document.activeElement).toBe(get(c, "Bullet 3 of Work experience"));
  });

  it("Backspace in a bullet that has text or a label does nothing special", () => {
    const c = mount(sample());
    press(get(c, "Bullet 3 of Work experience"), "Backspace");
    expect(latest[1].items).toHaveLength(4);
    const s = sample();
    s[1].items[3] = { id: "b2", text: "", kind: "bullet", label: "Modelling" };
    const d = mount(s);
    press(get(d, "Bullet 4 of Work experience"), "Backspace");
    expect(latest[1].items).toHaveLength(4);
  });

  it("Enter in a one-line field moves to the next field", () => {
    const c = mount(sample());
    press(get(c, "Name"), "Enter");
    expect(document.activeElement).toBe(get(c, "Contact line"));
  });

  it("pastes plain text: newlines become spaces in one-line fields, stay in text areas", () => {
    const c = mount(sample());
    const input = get(c, "Heading of section 3");
    input.setSelectionRange(0, input.value.length);
    expect(paste(input, "Core\r\nskills\n").defaultPrevented).toBe(true);
    expect(latest[2].heading).toBe("Core skills ");
    const area = get(c, "Bullet 3 of Work experience");
    area.setSelectionRange(area.value.length, area.value.length);
    paste(area, " and\r\nmore");
    expect(latest[1].items[2].text).toBe("Cut close time and\nmore");
  });

  it("cuts a paste at the field's limit", () => {
    const c = mount(sample());
    const input = get(c, "Heading of section 3");
    input.setSelectionRange(0, input.value.length);
    paste(input, "x".repeat(200));
    expect(latest[2].heading).toHaveLength(80);
  });
});

describe("the one-page check", () => {
  it("shows the verdict above the sheet and measures again after typing stops", () => {
    vi.useFakeTimers();
    const measure = vi.fn(() => 500);
    const c = mount(sample(), { measure });
    expect($(c, '[role="status"]')!.textContent).toBe("Fits one page");
    expect($(c, '[role="status"]')!.nextElementSibling).toBe($(c, ".doc-sheet"));
    const calls = measure.mock.calls.length;
    measure.mockReturnValue(1100);
    type(get(c, "Name"), "Jo");
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(measure.mock.calls.length).toBe(calls);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(measure.mock.calls.length).toBeGreaterThan(calls);
    expect($(c, '[role="status"]')!.textContent).toMatch(/over one page/);
  });

  it("measures the typed text, not the fields, and leaves the controls out", () => {
    const c = mount(sample());
    type(get(c, "Name"), "Typed after mount");
    let seen = "";
    const spy = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      seen = this.textContent ?? "";
      return 10;
    });
    expect(measureEditableSheet($(c, ".doc-sheet") as HTMLElement)).toBe(10);
    spy.mockRestore();
    expect(seen).toContain("Typed after mount");
    expect(seen).toContain("Cut close time");
    expect(seen).not.toContain("Add bullet");
    expect(seen).not.toContain("Remove");
  });
});

describe("ResumeEditing", () => {
  const edit = (initial: DocSection[], props: Record<string, unknown> = {}) =>
    mountNode((sections, onChange) => createElement(ResumeEditing, { sections, onChange, label: "Master resume", title: "My resume", ...props }), initial);
  const switchButton = (c: HTMLElement, name: string) => [...c.querySelectorAll(".doc-switch button")].find((b) => b.textContent === name) as HTMLButtonElement;

  it("starts on the page and mounts only one editor at a time", () => {
    const c = edit(sample());
    expect($(c, ".doc-sheet.page-edit")).not.toBeNull();
    expect($(c, ".doc-editor")).toBeNull();
    expect(switchButton(c, "Edit on page").getAttribute("aria-pressed")).toBe("true");
    click(switchButton(c, "Edit as list"));
    expect($(c, ".doc-sheet.page-edit")).toBeNull();
    expect($(c, '.doc-editor[aria-label="Master resume"]')).not.toBeNull();
    expect(c.querySelectorAll('[role="group"][aria-label="Master resume"]')).toHaveLength(1);
    click(switchButton(c, "Edit on page"));
    expect($(c, ".doc-editor")).toBeNull();
  });

  it("remembers the choice, and the list edits the same draft", () => {
    const c = edit(sample());
    click(switchButton(c, "Edit as list"));
    expect(localStorage.getItem("jobtracker:resume-editing")).toBe("list");
    type(get(c, "Heading of section 3"), "Tech");
    expect(latest[2].heading).toBe("Tech");
    expect($(edit(sample()), ".doc-editor")).not.toBeNull();
  });

  it("works when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const c = edit(sample());
    expect($(c, ".doc-sheet.page-edit")).not.toBeNull();
    click(switchButton(c, "Edit as list"));
    expect($(c, ".doc-editor")).not.toBeNull();
  });

  it("with scaffold, shows the whole template and hands the full list over on the first edit", () => {
    const c = edit([], { scaffold: true });
    expect(get(c, "Heading of section 2").value).toBe("Professional summary");
    expect(get(c, "Job 1 of Work experience")).not.toBeNull();
    expect(latest).toEqual([]);
    type(get(c, "Name"), "Jo");
    expect(latest.map((s) => s.heading)).toEqual(["Header", "Professional summary", "Skills and qualifications", "Work experience", "Education"]);
    expect(latest[0].items[0].text).toBe("Jo");
    // after that the list is the caller's: a section removed stays removed
    click(get(c, "Remove section Education"));
    expect(latest.map((s) => s.heading)).not.toContain("Education");
    expect(named(c, "Heading of section 5")).toBeNull();
  });

  it("without scaffold, shows only what the resume has", () => {
    const c = edit([{ id: "s", heading: "Summary", items: [{ id: "p", text: "Hi" }] }]);
    expect(named(c, "Job 1 of Work experience")).toBeNull();
    expect(get(c, "Line 1 of Summary").value).toBe("Hi");
  });
});

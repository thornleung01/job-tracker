// The resume editor on its own: a line's type, label and right-hand text, and that plain lines look and name exactly as before.
import "fake-indexeddb/auto";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { $, $$, addApp, button, click, cleanup, freshDb, mountPage, text, type, waitFor } from "../../pages/applications/harness";
import { SectionsEditor } from "../../../src/components/documents/SectionsEditor";
import { normalizeSections } from "../../../src/db/documentShape";
import { MAX_DOC_HEADING_CHARS, MAX_DOC_ITEM_CHARS, MAX_DOC_LABEL_CHARS, MAX_DOC_RIGHT_CHARS } from "../../../src/db/limits";
import type { DocSection } from "../../../src/db/schema";
import DetailPage from "../../../src/pages/detail";
import { saveMaster } from "../../../src/sync/documents";

const mounted: { root: Root; container: HTMLElement }[] = [];
let latest: DocSection[] = [];
afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  await cleanup();
});

/** Mounts the editor over state of its own, like a caller does, and remembers the last list it was given. */
async function mount(initial: DocSection[]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  function Host() {
    const [sections, setSections] = useState(initial);
    latest = sections;
    return createElement(SectionsEditor, { sections, onChange: setSections, label: "Test resume" });
  }
  await act(async () => root.render(createElement(Host)));
  return container;
}

const sections = (): DocSection[] => [
  { id: "s1", heading: "Experience", items: [
    { id: "a", text: "Acme" },
    { id: "b", text: "Led a rollout" },
    { id: "c", text: "Cut close time", kind: "bullet", label: "Reporting" },
  ] },
  { id: "s2", heading: "Skills", items: [{ id: "d", text: "SQL, Python", kind: "skill", label: "Analytics" }] },
];

const named = (root: ParentNode, name: string) => $(root, `[aria-label="${name}"]`) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
const KINDS = ["Line", "Job", "Job title", "Bullet", "Skill", "School"];

describe("the Line type select", () => {
  it("is on every line, named with the line number, offering the six types", async () => {
    const c = await mount(sections());
    const select = named(c, "Type of line 2 of Experience") as HTMLSelectElement;
    expect($$(select, "option").map(text)).toEqual(KINDS);
    expect(select.value).toBe("");
    expect((named(c, "Type of line 3 of Experience") as HTMLSelectElement).value).toBe("bullet");
    expect((named(c, "Type of line 1 of Skills") as HTMLSelectElement).value).toBe("skill");
  });

  it.each([
    ["org", { label: false, right: "Location" }],
    ["title", { label: false, right: "Dates" }],
    ["bullet", { label: true, right: null }],
    ["skill", { label: true, right: null }],
    ["school", { label: false, right: "Location" }],
    ["", { label: false, right: null }],
  ] as const)("choosing %j shows exactly the right extra fields", async (kind, extra) => {
    const c = await mount(sections());
    await type(named(c, "Type of line 2 of Experience"), kind);
    const item = latest[0].items[1];
    expect(item.kind).toBe(kind || undefined);
    expect("kind" in item).toBe(kind !== "");
    expect(item.text).toBe("Led a rollout");
    expect(named(c, "Label of line 2 of Experience") !== null).toBe(extra.label);
    for (const r of ["Location", "Dates"]) expect(named(c, `${r} of line 2 of Experience`) !== null).toBe(r === extra.right);
    expect($$($$(c, "li")[1], "input[type=text]")).toHaveLength((extra.label ? 1 : 0) + (extra.right ? 1 : 0));
  });

  it("names the text field after the type, and keeps Line N for a plain line", async () => {
    const c = await mount(sections());
    expect(named(c, "Line 2 of Experience")!.tagName).toBe("TEXTAREA");
    expect(named(c, "Bullet 3 of Experience")).not.toBeNull();
    expect(named(c, "Line 3 of Experience")).toBeNull();
    await type(named(c, "Type of line 1 of Experience"), "org");
    expect(named(c, "Job 1 of Experience")).not.toBeNull();
    await type(named(c, "Type of line 1 of Experience"), "");
    expect(named(c, "Line 1 of Experience")).not.toBeNull();
  });

  it("never loses the text, and drops a label or right-hand text its new type doesn't show", async () => {
    const c = await mount(sections());
    await type(named(c, "Type of line 2 of Experience"), "org");
    await type(named(c, "Location of line 2 of Experience"), "Toronto, ON");
    expect(latest[0].items[1]).toEqual({ id: "b", text: "Led a rollout", kind: "org", right: "Toronto, ON" });
    // Job to School keeps the location, School to Bullet drops it, Bullet to Line drops everything but the text.
    await type(named(c, "Type of line 2 of Experience"), "school");
    expect(latest[0].items[1].right).toBe("Toronto, ON");
    await type(named(c, "Type of line 2 of Experience"), "bullet");
    expect(latest[0].items[1]).toEqual({ id: "b", text: "Led a rollout", kind: "bullet" });
    await type(named(c, "Label of line 2 of Experience"), "Rollout");
    await type(named(c, "Type of line 2 of Experience"), "");
    expect(latest[0].items[1]).toEqual({ id: "b", text: "Led a rollout" });
    expect("label" in latest[0].items[1]).toBe(false);
  });

  it("switching back to Line clears the kind and the hidden fields", async () => {
    const c = await mount(sections());
    await type(named(c, "Type of line 3 of Experience"), "");
    expect(latest[0].items[2]).toEqual({ id: "c", text: "Cut close time" });
    expect(named(c, "Label of line 3 of Experience")).toBeNull();
  });
});

describe("the label and right-hand fields", () => {
  it("edit the line, with the limits as maxLength", async () => {
    const c = await mount(sections());
    const label = named(c, "Label of line 3 of Experience") as HTMLInputElement;
    expect(label.maxLength).toBe(MAX_DOC_LABEL_CHARS);
    await type(label, "Reporting and automation");
    expect(latest[0].items[2]).toEqual({ id: "c", text: "Cut close time", kind: "bullet", label: "Reporting and automation" });
    await type(named(c, "Type of line 1 of Experience"), "title");
    const dates = named(c, "Dates of line 1 of Experience") as HTMLInputElement;
    expect(dates.maxLength).toBe(MAX_DOC_RIGHT_CHARS);
    await type(dates, "Aug 2024 to Present");
    expect(latest[0].items[0]).toEqual({ id: "a", text: "Acme", kind: "title", right: "Aug 2024 to Present" });
  });
});

describe("a plain line", () => {
  it("has its old names, its text field and its three actions, and no extra fields", async () => {
    const c = await mount(sections());
    const li = $$(c, "li")[1];
    expect($$(li, "input")).toHaveLength(0);
    expect($$(li, "textarea").map((t) => t.getAttribute("aria-label"))).toEqual(["Line 2 of Experience"]);
    expect($$(li, "button").map((b) => b.getAttribute("aria-label"))).toEqual(["Move line 2 up", "Move line 2 down", "Remove line 2"]);
    expect(named(c, "Heading of section 2")).not.toBeNull();
    expect($$(c, "button").map(text)).toEqual(expect.arrayContaining(["Add line", "Add section", "Remove section"]));
  });

  it("tabs in order: type, text, right, then the line actions", async () => {
    const c = await mount(sections());
    await type(named(c, "Type of line 1 of Experience"), "org");
    const order = $$($$(c, "li")[0], "select, input, textarea, button").map((e) => e.getAttribute("aria-label"));
    expect(order).toEqual(["Type of line 1 of Experience", "Job 1 of Experience", "Location of line 1 of Experience", "Move line 1 up", "Move line 1 down", "Remove line 1"]);
    const bullet = $$($$(c, "li")[2], "select, input, textarea").map((e) => e.getAttribute("aria-label"));
    expect(bullet).toEqual(["Type of line 3 of Experience", "Label of line 3 of Experience", "Bullet 3 of Experience"]);
  });
});

describe("moving, removing and adding lines", () => {
  it("keeps kind, label and right on a moved line and drops them with a removed one", async () => {
    const c = await mount(sections());
    await type(named(c, "Type of line 1 of Experience"), "org");
    await type(named(c, "Location of line 1 of Experience"), "Toronto, ON");
    await click(named(c, "Move line 1 down"));
    expect(latest[0].items.map((i) => i.id)).toEqual(["b", "a", "c"]);
    expect(latest[0].items[1]).toEqual({ id: "a", text: "Acme", kind: "org", right: "Toronto, ON" });
    expect((named(c, "Type of line 2 of Experience") as HTMLSelectElement).value).toBe("org");
    expect((named(c, "Location of line 2 of Experience") as HTMLInputElement).value).toBe("Toronto, ON");
    await click(named(c, "Remove line 1"));
    expect(latest[0].items).toEqual([{ id: "a", text: "Acme", kind: "org", right: "Toronto, ON" }, { id: "c", text: "Cut close time", kind: "bullet", label: "Reporting" }]);
  });

  it("adds a bullet after a bullet, a plain line after anything else, and focuses the new text", async () => {
    const c = await mount(sections());
    const add = (heading: string) => button($(c, `section[aria-label="${heading}"]`)!, "Add line")!;
    await click(add("Experience"));
    expect(latest[0].items).toHaveLength(4);
    expect(latest[0].items[3]).toMatchObject({ text: "", kind: "bullet" });
    expect("label" in latest[0].items[3]).toBe(false);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Bullet 4 of Experience");
    await type(named(c, "Type of line 4 of Experience"), "");
    await click(add("Experience"));
    expect("kind" in latest[0].items[4]).toBe(false);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Line 5 of Experience");
    await click(add("Skills"));
    expect("kind" in latest[1].items[1]).toBe(false);
  });
});

describe("inside an application's resume edit", () => {
  it("shows the type select and saves a changed line type with Save", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { role: "Analyst" });
    await saveMaster(db, [{ heading: "Experience", items: [{ text: "Acme" }, { text: "Cut reporting time" }] }], "paste");
    const { container } = await mountPage(DetailPage, db, `/app/${id}`, { id: String(id) });
    const docs = () => $(container, "section.documents") as HTMLElement;
    await waitFor(() => button(docs(), "Make a copy for this job") !== null, "the documents section");
    await click(button(docs(), "Make a copy for this job"));
    await waitFor(() => $(docs(), ".doc-sheet") !== null, "the on-page editor");
    await click(button(docs(), "Edit as list"));
    await waitFor(() => $(docs(), ".doc-editor") !== null, "the list editor");
    await type(named(docs(), "Type of line 1 of Experience"), "org");
    await type(named(docs(), "Location of line 1 of Experience"), "Toronto, ON");
    await click(button(docs(), "Save"));
    await waitFor(() => $(docs(), ".doc-resume-edit") === null, "the editor to close");
    const copy = (await db.documents.toArray()).find((d) => !d.master)!;
    expect(copy.sections[0].items[0]).toMatchObject({ text: "Acme", kind: "org", right: "Toronto, ON" });
    expect("kind" in copy.sections[0].items[1]).toBe(false);
  });
});

describe("editing a typed line's text", () => {
  it("keeps its kind, label and right", async () => {
    const c = await mount([{ id: "s1", heading: "Experience", items: [
      { id: "a", text: "Acme", kind: "org", right: "Toronto, ON" },
      { id: "b", text: "Cut close time", kind: "bullet", label: "Reporting" },
    ] }]);
    await type(named(c, "Job 1 of Experience"), "Acme Corp");
    expect(latest[0].items[0]).toEqual({ id: "a", text: "Acme Corp", kind: "org", right: "Toronto, ON" });
    await type(named(c, "Bullet 2 of Experience"), "Cut close time by 2 days");
    expect(latest[0].items[1]).toEqual({ id: "b", text: "Cut close time by 2 days", kind: "bullet", label: "Reporting" });
  });
});

describe("adding lines in other places", () => {
  it("adds a plain line to an empty section and focuses it", async () => {
    const c = await mount([{ id: "s1", heading: "Projects", items: [] }]);
    await click(button($(c, 'section[aria-label="Projects"]')!, "Add line"));
    expect(latest[0].items).toHaveLength(1);
    expect(latest[0].items[0]).toMatchObject({ text: "" });
    expect("kind" in latest[0].items[0]).toBe(false);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Line 1 of Projects");
  });

  it.each(["title", "org"] as const)("adds a plain line, not a bullet, after a %s line", async (kind) => {
    const c = await mount([{ id: "s1", heading: "Experience", items: [{ id: "a", text: "Acme", kind, right: "x" }] }]);
    await click(button($(c, 'section[aria-label="Experience"]')!, "Add line"));
    expect(latest[0].items).toHaveLength(2);
    expect("kind" in latest[0].items[1]).toBe(false);
  });
});

describe("the field limits", () => {
  it("are set as maxLength on every field, and a longer value is cut by normalizeSections on save", async () => {
    // jsdom doesn't cut typed text at maxLength (a browser does), so this checks the attribute on each field and the cut on the way in
    const c = await mount([{ id: "s1", heading: "Experience", items: [{ id: "a", text: "Acme", kind: "org", right: "x" }, { id: "b", text: "y", kind: "bullet", label: "z" }] }]);
    expect((named(c, "Heading of section 1") as HTMLInputElement).maxLength).toBe(MAX_DOC_HEADING_CHARS);
    expect((named(c, "Job 1 of Experience") as HTMLTextAreaElement).maxLength).toBe(MAX_DOC_ITEM_CHARS);
    expect((named(c, "Location of line 1 of Experience") as HTMLInputElement).maxLength).toBe(MAX_DOC_RIGHT_CHARS);
    expect((named(c, "Label of line 2 of Experience") as HTMLInputElement).maxLength).toBe(MAX_DOC_LABEL_CHARS);
    await type(named(c, "Job 1 of Experience"), "x".repeat(MAX_DOC_ITEM_CHARS + 50));
    expect(normalizeSections(latest)[0].items[0].text).toHaveLength(MAX_DOC_ITEM_CHARS);
  });
});

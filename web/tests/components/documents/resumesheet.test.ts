import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ResumeSheet } from "../../../src/components/documents/ResumeSheet";
import type { DocItem, DocSection } from "../../../src/db/schema";

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

let n = 0;
const item = (text: string, extra: Partial<DocItem> = {}): DocItem => ({ id: `i${++n}`, text, ...extra });
const section = (heading: string, ...items: DocItem[]): DocSection => ({ id: `s${++n}`, heading, items });

function render(sections: DocSection[], title = "Resume for data roles", sheetRef?: React.Ref<HTMLElement>): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(ResumeSheet, { sections, title, sheetRef })));
  return host;
}

const texts = (els: Iterable<Element>) => [...els].map((e) => e.textContent);

describe("ResumeSheet", () => {
  it("shows the header section as a name and contact lines", () => {
    const el = render([section("Header", item("JORDAN LEE"), item("Toronto | (416) 555-0100"), item("jordan@example.com"))]);
    expect(el.querySelector(".doc-sheet.classic")).not.toBeNull();
    expect(el.querySelector("h1.doc-name")!.textContent).toBe("JORDAN LEE");
    expect(texts(el.querySelectorAll(".doc-contact p"))).toEqual(["Toronto | (416) 555-0100", "jordan@example.com"]);
    expect(el.querySelectorAll(".doc-block")).toHaveLength(0);
  });

  it("falls back to the title for the name when there is no header", () => {
    const el = render([section("Summary", item("Analyst."))], "Resume for data roles");
    expect(el.querySelector("h1.doc-name")!.textContent).toBe("Resume for data roles");
    expect(el.querySelector(".doc-contact")).toBeNull();
  });

  it("renders jobs and schools bold and titles italic, each with its right text", () => {
    const el = render([
      section(
        "Work experience",
        item("Northfield Bank", { kind: "org", right: "Toronto" }),
        item("Senior Analyst", { kind: "title", right: "2025 – Present" }),
        item("Demo University", { kind: "school", right: "Toronto" }),
      ),
    ]);
    expect(el.querySelector("h2")!.textContent).toBe("Work experience");
    const rows = [...el.querySelectorAll(".doc-row")];
    expect(rows.map((r) => r.className)).toEqual(["doc-row doc-org", "doc-row doc-title", "doc-row doc-org"]);
    expect(rows[0].querySelector("strong")!.textContent).toBe("Northfield Bank");
    expect(rows[0].querySelector(".doc-right")!.textContent).toBe("Toronto");
    expect(rows[1].querySelector("em")!.textContent).toBe("Senior Analyst");
    expect(rows[1].querySelector("em.doc-right")!.textContent).toBe("2025 – Present");
  });

  it("puts consecutive labelled bullets in one list, with the label in bold", () => {
    const el = render([
      section("Work experience", item("Built a model.", { kind: "bullet", label: "Reporting" }), item("Wrote pipelines.", { kind: "bullet" })),
    ]);
    const lists = el.querySelectorAll("ul.doc-bullets");
    expect(lists).toHaveLength(1);
    const lis = [...lists[0].querySelectorAll("li")];
    expect(lis.map((li) => li.textContent)).toEqual(["Reporting: Built a model.", "Wrote pipelines."]);
    expect(lis[0].querySelector("strong")!.textContent).toBe("Reporting:");
    expect(lis[1].querySelector("strong")).toBeNull();
  });

  it("starts a new list after a title row", () => {
    const el = render([
      section("Work", item("A", { kind: "bullet" }), item("Role", { kind: "title" }), item("B", { kind: "bullet" })),
    ]);
    expect(el.querySelectorAll("ul.doc-bullets")).toHaveLength(2);
  });

  it("shows skills and lone plain lines as paragraphs", () => {
    const el = render([
      section("Skills", item("SQL, Python", { kind: "skill", label: "Analytics" })),
      section("Summary", item("Analyst with 5 years of experience.")),
    ]);
    expect(texts(el.querySelectorAll(".doc-block p"))).toEqual(["Analytics: SQL, Python", "Analyst with 5 years of experience."]);
    expect(el.querySelector("p strong")!.textContent).toBe("Analytics:");
    expect(el.querySelector("ul")).toBeNull();
  });

  it("keeps a legacy section of several plain lines as a plain list", () => {
    const el = render([section("Skills", item("SQL", { label: "ignored" }), item("Python"))]);
    const list = el.querySelector("ul")!;
    expect(list.className).toBe("");
    expect(texts(list.querySelectorAll("li"))).toEqual(["SQL", "Python"]);
    expect(el.querySelector("strong")).toBeNull();
  });

  it("skips empty fields: no label, no right text, no heading", () => {
    const el = render([section("", item("Northfield Bank", { kind: "org" }), item("Did a thing.", { kind: "bullet", label: "" }))]);
    expect(el.querySelector("h2")).toBeNull();
    expect(el.querySelector(".doc-right")).toBeNull();
    expect(el.querySelector("li strong")).toBeNull();
    expect(el.querySelector("li")!.textContent).toBe("Did a thing.");
  });

  it("hands the sheet element to sheetRef", () => {
    const ref = createRef<HTMLElement>();
    const el = render([section("Summary", item("Analyst."))], "T", ref);
    expect(ref.current).toBe(el.querySelector("article"));
  });
});

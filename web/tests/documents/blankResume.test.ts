import { describe, expect, it } from "vitest";
import { normalizeSections } from "../../src/db/documentShape";
import type { DocSection } from "../../src/db/schema";
import { PLACEHOLDERS, TEMPLATE_HEADINGS, blankResume, isBlankTemplate, placeholderFor, withScaffold, withoutEmptySections } from "../../src/documents/blankResume";

const sec = (heading: string, ...lines: string[]): DocSection => ({ id: heading, heading, items: lines.map((text, i) => ({ id: `${heading}${i}`, text })) });
const headings = (s: DocSection[]) => s.map((x) => x.heading);
const ids = (s: DocSection[]) => s.flatMap((x) => [x.id, ...x.items.map((i) => i.id)]);

describe("blankResume", () => {
  it("is the template with every field empty", () => {
    const b = blankResume();
    expect(headings(b)).toEqual(["Header", ...Object.values(TEMPLATE_HEADINGS)]);
    expect(b.map((s) => s.items.map((i) => i.kind ?? "plain"))).toEqual([["plain", "plain"], ["plain"], ["skill"], ["org", "title", "bullet"], ["school", "plain"]]);
    expect(b.every((s) => s.items.every((i) => i.text === "" && !i.label && !i.right))).toBe(true);
    expect(isBlankTemplate(b)).toBe(true);
  });

  it("has new ids on every call, all different from each other", () => {
    const a = ids(blankResume());
    const b = ids(blankResume());
    expect(new Set([...a, ...b]).size).toBe(a.length + b.length);
  });

  it("saves as nothing once empty sections are dropped (normalizeSections alone keeps the headings): placeholders are never text", () => {
    expect(normalizeSections(blankResume()).every((s) => s.items.length === 0)).toBe(true);
    expect(withoutEmptySections(normalizeSections(blankResume()))).toEqual([]);
  });
});

describe("placeholders", () => {
  it("are looked up by kind and field, or by section for a plain line", () => {
    expect(placeholderFor("Header", undefined, "text", 0)).toBe("Your name");
    expect(placeholderFor("Header", undefined, "text", 1)).toBe("City, Province | Phone | LinkedIn | Email");
    expect(placeholderFor("Professional summary", undefined, "text")).toBe("Two or three sentences about what you do");
    expect(placeholderFor("Skills and qualifications", "skill", "label")).toBe("Category");
    expect(placeholderFor("Skills and qualifications", "skill", "text")).toBe("Tools and skills, separated by commas");
    expect(placeholderFor("Work experience", "org", "text")).toBe("Company");
    expect(placeholderFor("Work experience", "org", "right")).toBe("City, Province");
    expect(placeholderFor("Work experience", "title", "text")).toBe("Job title");
    expect(placeholderFor("Work experience", "title", "right")).toBe("Start – End");
    expect(placeholderFor("Work experience", "bullet", "label")).toBe("What it was");
    expect(placeholderFor("Work experience", "bullet", "text")).toBe(PLACEHOLDERS.bullet.text);
    expect(placeholderFor("Education", "school", "text")).toBe("School");
    expect(placeholderFor("Education", undefined, "text")).toBe("Degree");
  });

  it("are empty for a field the line does not have", () => {
    expect(placeholderFor("Work experience", "bullet", "right")).toBe("");
    expect(placeholderFor("Work experience", undefined, "label")).toBe("");
    expect(placeholderFor("Awards", undefined, "text")).toBe("");
  });
});

describe("withScaffold", () => {
  it("adds a header and every missing template section around data it does not touch", () => {
    const mine = [sec("Awards", "Best analyst")];
    const out = withScaffold(mine);
    expect(headings(out)).toEqual(["Header", "Professional summary", "Skills and qualifications", "Work experience", "Education", "Awards"]);
    expect(out.find((s) => s.heading === "Awards")).toBe(mine[0]);
    expect(out.find((s) => s.heading === "Header")!.items).toHaveLength(2);
    expect(out.find((s) => s.heading === "Work experience")!.items.map((i) => i.kind)).toEqual(["org", "title", "bullet"]);
  });

  it("does not alter or reorder the sections it is given", () => {
    const mine = [sec("Education", "BSc"), sec("Header", "Jo", "jo@x.com"), sec("Work Experience", "Acme")];
    const copy = JSON.parse(JSON.stringify(mine));
    withScaffold(mine);
    expect(mine).toEqual(copy);
    const out = withScaffold(mine);
    expect(headings(out).filter((h) => ["Education", "Header", "Work Experience"].includes(h))).toEqual(["Education", "Header", "Work Experience"]);
  });

  it("matches headings whatever their case and the usual alternatives, so nothing is duplicated", () => {
    const full = withScaffold([sec("HEADER", "Jo", "c"), sec("SUMMARY", "x"), sec("skills", "y"), sec("EXPERIENCE", "z"), sec("education", "w")]);
    expect(headings(full)).toEqual(["HEADER", "SUMMARY", "skills", "EXPERIENCE", "education"]);
    expect(headings(withScaffold(blankResume()))).toEqual(["Header", ...Object.values(TEMPLATE_HEADINGS)]);
  });

  it("is stable: scaffolding twice adds nothing more", () => {
    const once = withScaffold([sec("Awards", "x")]);
    expect(headings(withScaffold(once))).toEqual(headings(once));
  });

  it("puts a missing section after the nearest earlier one that is there", () => {
    const out = withScaffold([sec("Header", "Jo", "c"), sec("Work experience", "Acme"), sec("Awards", "x")]);
    expect(headings(out)).toEqual(["Header", "Professional summary", "Skills and qualifications", "Work experience", "Education", "Awards"]);
  });

  it("saves back to the original data: the scaffold is empty", () => {
    const mine = [sec("Awards", "Best analyst")];
    expect(withoutEmptySections(normalizeSections(withScaffold(mine))).map((s) => s.heading)).toEqual(["Awards"]);
  });

  it("starts an empty resume as the blank template", () => {
    expect(headings(withScaffold([]))).toEqual(["Header", ...Object.values(TEMPLATE_HEADINGS)]);
  });
});

describe("isBlankTemplate", () => {
  it("is false once any field has text, a label or a right-hand value", () => {
    const b = blankResume();
    b[0].items[0].text = " ";
    expect(isBlankTemplate(b)).toBe(true);
    b[3].items[2].label = "Reporting";
    expect(isBlankTemplate(b)).toBe(false);
    const c = blankResume();
    c[3].items[0].right = "Toronto";
    expect(isBlankTemplate(c)).toBe(false);
    const d = blankResume();
    d[1].items[0].text = "Hello";
    expect(isBlankTemplate(d)).toBe(false);
  });
});

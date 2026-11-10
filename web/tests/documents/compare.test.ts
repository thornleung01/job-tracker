// Comparing a tailored resume with its baseline, and putting single lines back.
import { describe, expect, it } from "vitest";
import { addBackLine, compareToBaseline, diffWords, resetLine } from "../../src/documents/compare";
import type { DocSection } from "../../src/db/schema";

const BASE: DocSection[] = [
  { id: "sh", heading: "", items: [{ id: "h1", text: "Jordan Lee" }] },
  { id: "ss", heading: "Summary", items: [{ id: "s1", text: "Analyst with 3 years in retail." }] },
  {
    id: "sw", heading: "Experience",
    items: [
      { id: "o1", text: "Northwind", kind: "org", right: "Toronto" },
      { id: "b1", text: "Owned the plan.", kind: "bullet", label: "Planning" },
      { id: "b2", text: "Automated the report.", kind: "bullet", label: "Reporting" },
      { id: "b3", text: "Built reconciliations.", kind: "bullet", label: "Controls" },
    ],
  },
  { id: "se", heading: "Education", items: [{ id: "e1", text: "Lakeside College", kind: "school", right: "Ottawa" }] },
];
const copy = (): DocSection[] => structuredClone(BASE);
const idsOf = (sections: DocSection[]) => sections.flatMap((s) => s.items.map((i) => i.id));

describe("diffWords", () => {
  it("marks the words that differ on each side", () => {
    expect(diffWords("a b c", "a x c")).toEqual({
      before: [{ text: "a", changed: false }, { text: "b", changed: true }, { text: "c", changed: false }],
      after: [{ text: "a", changed: false }, { text: "x", changed: true }, { text: "c", changed: false }],
    });
    expect(diffWords("", "")).toEqual({ before: [], after: [] });
  });

  it("marks only the words that differ, whatever their order", () => {
    const d = diffWords("Built dashboards for sales", "Built sales dashboards quickly");
    expect(d.before.filter((p) => p.changed).map((p) => p.text)).toEqual(expect.arrayContaining(["for"]));
    expect(d.after.filter((p) => p.changed).map((p) => p.text)).toContain("quickly");
    expect(d.before.map((p) => p.text).join(" ")).toBe("Built dashboards for sales");
    expect(d.after.map((p) => p.text).join(" ")).toBe("Built sales dashboards quickly");
  });

  it("marks nothing for the same text, and everything against nothing", () => {
    expect(diffWords("same words", "same  words").after.every((p) => !p.changed)).toBe(true);
    expect(diffWords("", "all new").after.every((p) => p.changed)).toBe(true);
    expect(diffWords("all old", "").before.every((p) => p.changed)).toBe(true);
  });
});

describe("compareToBaseline", () => {
  it("marks an untouched copy all same, with nothing left out", () => {
    const { lines, leftOut } = compareToBaseline(copy(), BASE);
    expect(Object.keys(lines).sort()).toEqual(idsOf(BASE).sort());
    expect(Object.values(lines).every((l) => l.status === "same")).toBe(true);
    expect(Object.values(lines).every((l) => l.diff === undefined && l.baselineText === undefined)).toBe(true);
    expect(leftOut).toEqual([]);
  });

  it("marks a reworded line changed, with the baseline's text and a word diff", () => {
    const t = copy();
    t[2].items[1].text = "Owned the seasonal plan.";
    const { lines } = compareToBaseline(t, BASE);
    expect(lines.b1.status).toBe("changed");
    expect(lines.b1.baselineText).toBe("Planning: Owned the plan.");
    expect(lines.b1.diff?.after.filter((w) => w.changed).map((w) => w.text)).toEqual(["seasonal"]);
    expect(lines.b1.diff?.before.some((w) => w.changed)).toBe(false);
    expect(lines.b2.status).toBe("same");
  });

  it("compares label, text and right, so a changed label or location counts", () => {
    const t = copy();
    t[2].items[2].label = "Automation";
    t[2].items[0].right = "Remote";
    const { lines } = compareToBaseline(t, BASE);
    expect(lines.b2.status).toBe("changed");
    expect(lines.o1.status).toBe("changed");
    expect(lines.o1.baselineText).toBe("Northwind Toronto");
    expect(lines.b1.status).toBe("same");
  });

  it("counts a changed kind as a change", () => {
    const t = copy();
    t[2].items[1] = { ...t[2].items[1], kind: "title" };
    const { lines } = compareToBaseline(t, BASE);
    expect(lines.b1.status).toBe("changed");
    expect(lines.b2.status).toBe("same");
  });

  it("counts a heading cleared to nothing as changed, and a blank header heading as same", () => {
    const t = copy();
    t[1].heading = "";
    const { lines } = compareToBaseline(t, BASE);
    expect(lines.ss.status).toBe("changed");
    expect(lines.ss.baselineText).toBe("Summary");
    expect(lines.sh).toBeUndefined();
  });

  it("treats a line with no label and an empty one alike, and a moved line as same", () => {
    const t = copy();
    t[2].items = [t[2].items[0], t[2].items[3], t[2].items[1], t[2].items[2]];
    t[3].items[0] = { ...t[3].items[0], label: "" };
    const { lines, leftOut } = compareToBaseline(t, BASE);
    expect(lines.b3.status).toBe("same");
    expect(lines.e1.status).toBe("same");
    expect(leftOut).toEqual([]);
  });

  it("marks a line the baseline doesn't have as new, and lists the baseline lines it lacks as left out, in baseline order", () => {
    const t = copy();
    t[2].items = t[2].items.filter((i) => i.id !== "b2" && i.id !== "b1");
    t[2].items.push({ id: "x1", text: "Brand new.", kind: "bullet" });
    t.splice(3, 1);
    const { lines, leftOut } = compareToBaseline(t, BASE);
    expect(lines.x1).toEqual({ status: "new" });
    expect(leftOut.map((l) => [l.id, l.sectionId, l.heading])).toEqual([["b1", "sw", "Experience"], ["b2", "sw", "Experience"], ["e1", "se", "Education"]]);
    expect(leftOut[0].item).toEqual(BASE[2].items[1]);
    expect(leftOut[0].item).not.toBe(BASE[2].items[1]);
  });

  it("includes the header, a changed section heading and a new section", () => {
    const t = copy();
    t[1].heading = "Professional summary";
    t.push({ id: "extra", heading: "Awards", items: [{ id: "a1", text: "Prize" }] });
    t[0].items[0].text = "Jordan A. Lee";
    const { lines } = compareToBaseline(t, BASE);
    expect(lines.h1.status).toBe("changed");
    expect(lines.ss).toMatchObject({ status: "changed", baselineText: "Summary" });
    expect(lines.sh).toBeUndefined();
    expect(lines.extra).toEqual({ status: "new" });
    expect(lines.a1).toEqual({ status: "new" });
  });

  it("copes with empty inputs", () => {
    expect(compareToBaseline([], [])).toEqual({ lines: {}, leftOut: [] });
    expect(compareToBaseline([], BASE).leftOut).toHaveLength(idsOf(BASE).length);
    expect(Object.values(compareToBaseline(copy(), []).lines).filter((l) => l.status === "new")).toHaveLength(idsOf(BASE).length + 3);
  });

  it("doesn't change its inputs", () => {
    const t = copy();
    t[2].items.pop();
    const before = JSON.stringify([t, BASE]);
    compareToBaseline(t, BASE);
    expect(JSON.stringify([t, BASE])).toBe(before);
  });
});

describe("addBackLine", () => {
  it("puts a line back after the nearest earlier baseline line the copy still has", () => {
    const t = copy();
    t[2].items = t[2].items.filter((i) => i.id !== "b2" && i.id !== "b3");
    const back = addBackLine(t, BASE, "b3");
    expect(back[2].items.map((i) => i.id)).toEqual(["o1", "b1", "b3"]);
    const again = addBackLine(back, BASE, "b2");
    expect(again[2].items.map((i) => i.id)).toEqual(["o1", "b1", "b2", "b3"]);
    expect(t[2].items.map((i) => i.id)).toEqual(["o1", "b1"]);
  });

  it("follows the earlier line into whichever section the copy moved it to", () => {
    const t = copy();
    const moved = t[2].items.splice(1, 1)[0];
    t[1].items.push(moved);
    t[2].items = t[2].items.filter((i) => i.id !== "b2");
    expect(addBackLine(t, BASE, "b2")[1].items.map((i) => i.id)).toEqual(["s1", "b1", "b2"]);
  });

  it("falls back to the start of the matching section when no earlier line is there, matching by id then heading", () => {
    const t = copy();
    t[2].items = [];
    expect(addBackLine(t, BASE, "o1")[2].items.map((i) => i.id)).toEqual(["o1"]);
    const renamed = copy();
    renamed[1] = { id: "other", heading: " summary ", items: [] };
    expect(addBackLine(renamed, BASE, "s1")[1]).toMatchObject({ id: "other", items: [{ id: "s1" }] });
  });

  it("makes a section with the baseline's heading when the copy has none, placed after the nearest earlier section it has", () => {
    const t = copy().filter((s) => s.id !== "se");
    const back = addBackLine(t, BASE, "e1");
    expect(back.map((s) => s.heading)).toEqual(["", "Summary", "Experience", "Education"]);
    expect(back[3]).toMatchObject({ id: "se", items: [{ id: "e1", text: "Lakeside College" }] });
    const start = addBackLine([{ id: "z", heading: "Awards", items: [{ id: "a", text: "x" }] }], BASE, "s1");
    expect(start.map((s) => s.heading)).toEqual(["Summary", "Awards"]);
  });

  it("puts the line in the section with the baseline section's id even when its heading was renamed", () => {
    const t: DocSection[] = [{ id: "se", heading: "Schooling", items: [{ id: "q", text: "Q" }] }];
    expect(addBackLine(t, BASE, "e1")).toEqual([{ id: "se", heading: "Schooling", items: [BASE[3].items[0], { id: "q", text: "Q" }] }]);
  });

  it("restores the baseline's fields, as a copy, and leaves a present or unknown line alone", () => {
    const t = copy();
    t[2].items = t[2].items.filter((i) => i.id !== "b1");
    const back = addBackLine(t, BASE, "b1");
    expect(back[2].items[1]).toEqual(BASE[2].items[1]);
    expect(back[2].items[1]).not.toBe(BASE[2].items[1]);
    expect(addBackLine(copy(), BASE, "b1")).toEqual(BASE);
    expect(addBackLine(copy(), BASE, "nope")).toEqual(BASE);
  });

  it("clears the line from left out once it is back", () => {
    const t = copy();
    t[2].items.pop();
    expect(compareToBaseline(t, BASE).leftOut.map((l) => l.id)).toEqual(["b3"]);
    expect(compareToBaseline(addBackLine(t, BASE, "b3"), BASE).leftOut).toEqual([]);
  });
});

describe("resetLine", () => {
  it("sets an edited line back to the baseline's fields, and only that line", () => {
    const t = copy();
    t[2].items[1] = { id: "b1", text: "Changed.", kind: "title", label: "Other", right: "now" };
    t[2].items[2].text = "Also edited.";
    const back = resetLine(t, BASE, "b1");
    expect(back[2].items[1]).toEqual(BASE[2].items[1]);
    expect(back[2].items[2].text).toBe("Also edited.");
    expect(compareToBaseline(back, BASE).lines.b1.status).toBe("same");
    expect(t[2].items[1].text).toBe("Changed.");
  });

  it("drops a label or right the baseline's line doesn't have", () => {
    const t = copy();
    t[1].items[0] = { id: "s1", text: "Edited", label: "L", right: "R" };
    expect(resetLine(t, BASE, "s1")[1].items[0]).toEqual({ id: "s1", text: "Analyst with 3 years in retail." });
  });

  it("leaves everything when the line is new or the id is unknown", () => {
    const t = copy();
    t[1].items.push({ id: "x", text: "mine" });
    expect(resetLine(t, BASE, "x")).toEqual(t);
    expect(resetLine(t, BASE, "nope")).toEqual(t);
  });
});

import { describe, expect, it } from "vitest";
import { LETTER_STYLE, LETTER, RESUME_STYLE, layoutLetter, layoutResume, wrapSegments } from "../../../src/documents/pdf/layout";
import { DEMO_MASTER, bullet, fakeMeasure, item, org, pageLines, runsOf, school, section, skill, title } from "./fixtures";

const header = (name: string, contact: string) => section("Header", item(name), item(contact));
const RIGHT_EDGE = LETTER.width - RESUME_STYLE.margin;
const width = (text: string, size: number) => fakeMeasure("regular", size, text);

describe("wrapSegments", () => {
  it("breaks at spaces so no line is wider than the limit", () => {
    const lines = wrapSegments([{ text: "aaaa bbbb cccc dddd", font: "regular" }], 50, 10, fakeMeasure);
    expect(lines.map((l) => l.map((p) => p.text).join(""))).toEqual(["aaaa bbbb", "cccc dddd"]);
  });

  it("keeps a bold label and the regular text after it as two pieces joined by a space", () => {
    const [line] = wrapSegments([{ text: "Label:", font: "bold" }, { text: "some text", font: "regular" }], 500, 10, fakeMeasure);
    expect(line).toEqual([{ text: "Label:", font: "bold" }, { text: " some text", font: "regular" }]);
  });

  it("breaks a word that is wider than the line by characters", () => {
    const lines = wrapSegments([{ text: "abcdefghij", font: "regular" }], 30, 10, fakeMeasure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((l) => l[0].text).join("")).toBe("abcdefghij");
    for (const l of lines) expect(width(l[0].text, 10)).toBeLessThanOrEqual(30);
  });

  it("gives one empty line for no text", () => {
    expect(wrapSegments([{ text: "  ", font: "regular" }], 100, 10, fakeMeasure)).toEqual([[]]);
  });
});

describe("layoutResume, one kind of line at a time", () => {
  it("centres the name in capitals, bold at 1.6 times the body size, then the contact line", () => {
    const l = layoutResume([header("Jordan Lee", "Toronto | jordan@example.com")], fakeMeasure);
    const [name, contact] = l.pages[0].runs;
    expect(name).toMatchObject({ text: "JORDAN LEE", font: "bold", size: RESUME_STYLE.size * 1.6 });
    expect(name.x).toBeCloseTo((LETTER.width - width("JORDAN LEE", name.size)) / 2, 5);
    expect(contact).toMatchObject({ text: "Toronto | jordan@example.com", font: "regular", size: RESUME_STYLE.size });
    expect(contact.x).toBeCloseTo((LETTER.width - width(contact.text, RESUME_STYLE.size)) / 2, 5);
    expect(contact.y).toBeLessThan(name.y);
  });

  it("uses the title for the name when there is no header", () => {
    const l = layoutResume([section("Skills", skill("Tools", "SQL"))], fakeMeasure, { title: "Casey Doe" });
    expect(pageLines(l)[0]).toBe("CASEY DOE");
  });

  it("puts a bold capital heading on the left with a 0.75pt rule across the content width under it", () => {
    const l = layoutResume([section("Work experience", item("One line."))], fakeMeasure);
    const [h] = l.pages[0].runs;
    expect(h).toMatchObject({ text: "WORK EXPERIENCE", font: "bold", x: RESUME_STYLE.margin });
    expect(l.pages[0].rules).toHaveLength(1);
    const rule = l.pages[0].rules[0];
    expect(rule).toMatchObject({ x1: 36, x2: RIGHT_EDGE, thickness: 0.75 });
    expect(rule.y).toBeLessThan(h.y);
    expect(h.y - rule.y).toBeLessThan(6);
  });

  it("sets an org bold with its location flush right, and a title italic with its dates flush right", () => {
    const l = layoutResume([section("Work", org("Northfield Bank", "Toronto, Ontario"), title("Senior Analyst", "Feb 2025 – Present"))], fakeMeasure);
    const [orgRun] = runsOf(l, "Northfield Bank");
    const [loc] = runsOf(l, "Toronto, Ontario");
    expect(orgRun).toMatchObject({ font: "bold", x: 36 });
    expect(loc).toMatchObject({ font: "bold", y: orgRun.y });
    expect(loc.x + width("Toronto, Ontario", 10.5)).toBeCloseTo(RIGHT_EDGE, 5);
    const [t] = runsOf(l, "Senior Analyst");
    const [dates] = runsOf(l, "Feb 2025 – Present");
    expect(t).toMatchObject({ font: "italic", x: 36 });
    expect(dates).toMatchObject({ font: "italic", y: t.y });
    expect(dates.x + width("Feb 2025 – Present", 10.5)).toBeCloseTo(RIGHT_EDGE, 5);
  });

  it("sets a school like an org", () => {
    const l = layoutResume([section("Education", school("Demo University", "Toronto, Ontario"))], fakeMeasure);
    expect(runsOf(l, "Demo University")[0]).toMatchObject({ font: "bold", x: 36 });
    expect(runsOf(l, "Toronto, Ontario")[0].x + width("Toronto, Ontario", 10.5)).toBeCloseTo(RIGHT_EDGE, 5);
  });

  it("gives a bullet a solid marker, an indent, and a bold label before the text", () => {
    const l = layoutResume([section("Work", bullet("Dashboards", "Led a rollout."))], fakeMeasure);
    const marker = runsOf(l, "•")[0];
    const label = runsOf(l, "Dashboards:")[0];
    const body = runsOf(l, " Led a rollout.")[0];
    expect(marker.x).toBeCloseTo(36 + 0.35 * 10.5, 5);
    expect(label).toMatchObject({ font: "bold", y: marker.y });
    expect(label.x).toBeCloseTo(36 + 1.5 * 10.5, 5);
    expect(body).toMatchObject({ font: "regular", y: label.y });
    expect(body.x).toBeCloseTo(label.x + width("Dashboards:", 10.5), 5);
    expect(pageLines(l)).toContain("•Dashboards: Led a rollout.");
  });

  it("gives a bullet with no label no bold run", () => {
    const l = layoutResume([section("Work", item("Plain bullet.", { kind: "bullet" }))], fakeMeasure);
    expect(l.pages[0].runs.filter((r) => r.font === "bold").map((r) => r.text)).toEqual(["WORK"]);
  });

  it("sets a skill as a bold category then its values, with no marker", () => {
    const l = layoutResume([section("Skills", skill("Analytics", "SQL, Python"))], fakeMeasure);
    expect(pageLines(l)).toContain("Analytics: SQL, Python");
    expect(runsOf(l, "Analytics:")[0]).toMatchObject({ font: "bold", x: 36 });
    expect(runsOf(l, "•")).toHaveLength(0);
  });

  it("sets a lone plain line as a paragraph and keeps its own line breaks", () => {
    const l = layoutResume([section("Summary", item("First line.\nSecond line."))], fakeMeasure);
    expect(pageLines(l).slice(1)).toEqual(["First line.", "Second line."]);
    expect(runsOf(l, "First line.")[0].x).toBe(36);
  });

  it("sets several plain lines and nothing else as a bullet list", () => {
    const l = layoutResume([section("Notes", item("One"), item("Two"))], fakeMeasure);
    expect(pageLines(l).slice(1)).toEqual(["•One", "•Two"]);
  });

  it("starts each line below the one before it, 1.25 line heights apart inside a block", () => {
    const l = layoutResume([section("Summary", item("A"), item("B", { kind: "org" }), item("C", { kind: "org" }))], fakeMeasure);
    const [a, b, c] = ["A", "B", "C"].map((t) => runsOf(l, t)[0]);
    expect(a.y - b.y).toBeCloseTo(10.5 * 1.25 + 2, 5); // the paragraph's 2pt bottom margin
    expect(b.y - c.y).toBeCloseTo(10.5 * 1.25, 5);
  });

  it("puts 4pt above a title or org that follows bullets", () => {
    const l = layoutResume([section("Work", title("T1"), bullet("L", "x"), title("T2"), bullet("M", "y"), org("Co"))], fakeMeasure);
    const [t1, t2] = [runsOf(l, "T1")[0], runsOf(l, "T2")[0]];
    const lh = 10.5 * 1.25;
    expect(t1.y - runsOf(l, "L:")[0].y).toBeCloseTo(lh + 1, 5);
    expect(runsOf(l, "L:")[0].y - t2.y).toBeCloseTo(lh + 4, 5);
    expect(t2.y - runsOf(l, "M:")[0].y).toBeCloseTo(lh + 1, 5);
    expect(runsOf(l, "M:")[0].y - runsOf(l, "Co")[0].y).toBeCloseTo(lh + 4, 5);
  });
});

describe("layoutResume, wrapping", () => {
  it("wraps a long bullet under its text, not under its marker", () => {
    const long = "word ".repeat(40).trim();
    const l = layoutResume([section("Work", bullet("Label", long))], fakeMeasure);
    const lines = pageLines(l).slice(1);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].startsWith("•Label: word")).toBe(true);
    const bodyRuns = l.pages[0].runs.filter((r) => r.text !== "•" && r.font === "regular" && r.y !== l.pages[0].runs[0].y);
    expect(Math.min(...bodyRuns.map((r) => r.x))).toBeGreaterThanOrEqual(36 + 1.5 * 10.5 - 0.001);
    for (const r of l.pages[0].runs) expect(r.x + width(r.text, r.size)).toBeLessThanOrEqual(RIGHT_EDGE + 0.001);
  });

  it("wraps a long org name before its right-hand value and keeps the value on the first line", () => {
    const l = layoutResume([section("Work", org("A very long organization name ".repeat(6).trim(), "Toronto, Ontario"))], fakeMeasure);
    const loc = runsOf(l, "Toronto, Ontario")[0];
    const lines = pageLines(l);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines[1].endsWith("Toronto, Ontario")).toBe(true);
    const nameRuns = l.pages[0].runs.filter((r) => r.font === "bold" && r.text !== "WORK" && r !== loc);
    for (const r of nameRuns) expect(r.x + width(r.text, 10.5)).toBeLessThanOrEqual(loc.x - 12 + 0.001);
  });

  it("wraps a long contact line, centring each line", () => {
    const l = layoutResume([header("Jordan Lee", "word ".repeat(60).trim())], fakeMeasure);
    const rows = pageLines(l).slice(1);
    expect(rows.length).toBeGreaterThan(1);
    for (const r of l.pages[0].runs.slice(1)) {
      const mid = r.x + width(r.text, r.size) / 2;
      expect(mid).toBeCloseTo(LETTER.width / 2, 3);
    }
  });
});

describe("layoutResume, pages", () => {
  const many = (n: number) => section("Work", ...Array.from({ length: n }, (_, i) => bullet(`L${i}`, `Line ${i} text`)));

  it("fits the demo master on one page", () => {
    expect(layoutResume(DEMO_MASTER, fakeMeasure).pages).toHaveLength(1);
  });

  it("continues on a second page when the resume runs over, and nothing is lost or drawn below the margin", () => {
    const l = layoutResume([header("Jordan Lee", "Toronto"), many(80)], fakeMeasure);
    expect(l.pages).toHaveLength(2);
    const all = l.pages.flatMap((p) => p.runs);
    expect(all.filter((r) => /^L\d+:$/.test(r.text))).toHaveLength(80);
    for (const p of l.pages) for (const r of p.runs) expect(r.y).toBeGreaterThanOrEqual(RESUME_STYLE.margin - 0.001);
    // the second page starts at the top margin, with no leftover gap
    const top2 = Math.max(...l.pages[1].runs.map((r) => r.y));
    expect(top2).toBeGreaterThan(LETTER.height - RESUME_STYLE.margin - 12);
  });

  it("needs three pages for a very long resume", () => {
    expect(layoutResume([many(110)], fakeMeasure).pages).toHaveLength(3);
  });

  it("never leaves a heading as the last line of a page", () => {
    // fill page 1 until only one line fits, then add a heading
    for (let n = 30; n < 80; n++) {
      const l = layoutResume([many(n), section("Education", school("Demo University", "Toronto"))], fakeMeasure);
      if (l.pages.length < 2) continue;
      const first = pageLines(l, 0);
      expect(first[first.length - 1]).not.toBe("EDUCATION");
    }
  });

  it("keeps an org with the title that follows it", () => {
    for (let n = 30; n < 60; n++) {
      const l = layoutResume([many(n), section("More", org("Orphan Co", "Toronto"), title("Role", "2020"))], fakeMeasure);
      if (l.pages.length < 2) continue;
      const first = pageLines(l, 0);
      expect(first[first.length - 1]).not.toMatch(/^Orphan Co/);
    }
  });
});

describe("layoutResume, the demo master", () => {
  it("reads like the sheet, line by line", () => {
    const lines = pageLines(layoutResume(DEMO_MASTER, fakeMeasure));
    expect(lines[0]).toBe("JORDAN LEE");
    expect(lines[1]).toContain("jordan.lee@example.com");
    expect(lines).toContain("PROFESSIONAL SUMMARY");
    expect(lines).toContain("WORK EXPERIENCE");
    expect(lines).toContain("Analytics: SQL, Python, Tableau, Excel");
    expect(lines.some((l) => l.startsWith("Northfield Bank") && l.endsWith("Toronto, Ontario"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Senior Analyst") && l.endsWith("Feb 2025 – Present"))).toBe(true);
    expect(lines.filter((l) => l.startsWith("•"))).toHaveLength(6);
    expect(lines.indexOf("EDUCATION")).toBeGreaterThan(lines.indexOf("WORK EXPERIENCE"));
  });
});

describe("layoutLetter", () => {
  const letter = [section("", item("Dear hiring team,"), item("First paragraph of the letter."), item("Sincerely,\nJordan Lee"))];

  it("uses one-inch margins and 11pt regular type", () => {
    const l = layoutLetter(letter, fakeMeasure);
    expect(l.pages).toHaveLength(1);
    for (const r of l.pages[0].runs) expect(r).toMatchObject({ x: 72, size: LETTER_STYLE.size, font: "regular" });
    expect(Math.max(...l.pages[0].runs.map((r) => r.y))).toBeLessThan(LETTER.height - 72);
  });

  it("sets each paragraph apart by a blank line and keeps the sign-off's own line breaks", () => {
    const rows = pageLines(layoutLetter(letter, fakeMeasure));
    expect(rows).toEqual(["Dear hiring team,", "First paragraph of the letter.", "Sincerely,", "Jordan Lee"]);
    const l = layoutLetter(letter, fakeMeasure);
    const [a, b, c, d] = ["Dear hiring team,", "First paragraph of the letter.", "Sincerely,", "Jordan Lee"].map((t) => runsOf(l, t)[0].y);
    const lh = LETTER_STYLE.size * LETTER_STYLE.lineHeight;
    expect(a - b).toBeCloseTo(lh + 11, 5);
    expect(b - c).toBeCloseTo(lh + 11, 5);
    expect(c - d).toBeCloseTo(lh, 5);
  });

  it("wraps within the margins and runs onto a second page when long", () => {
    const l = layoutLetter([section("", ...Array.from({ length: 30 }, () => item("sentence ".repeat(40).trim())))], fakeMeasure);
    expect(l.pages.length).toBeGreaterThan(1);
    for (const p of l.pages) for (const r of p.runs) expect(r.x + width(r.text, 11)).toBeLessThanOrEqual(LETTER.width - 72 + 0.001);
  });

  it("skips empty paragraphs", () => {
    expect(pageLines(layoutLetter([section("", item("A"), item("  "), item("B"))], fakeMeasure))).toEqual(["A", "B"]);
  });
});

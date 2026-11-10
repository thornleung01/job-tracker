import { describe, expect, it } from "vitest";
import { itemText } from "../../src/db/documentShape";
import type { DocSection } from "../../src/db/schema";
import { rereadAsTemplate } from "../../src/documents/reread";

let n = 0;
const sec = (heading: string, ...lines: string[]): DocSection => ({ id: `s${++n}`, heading, items: lines.map((text) => ({ id: `i${++n}`, text })) });

/** A resume saved before typed lines: the name is the first heading, the summary is three plain lines, nothing has a kind. */
const OLD = (): DocSection[] => [
  sec("JORDAN LEE", "Toronto, ON | 416-555-0100 | jordan@example.com | linkedin.com/in/jordanlee"),
  sec("PROFESSIONAL SUMMARY", "Analyst with six years in fintech", "building dashboards and reports for product teams", "and writing the SQL behind them."),
  sec("SKILLS AND QUALIFICATIONS", "Programming/Database SQL (Redshift), Python", "Analytics: Tableau, Excel"),
  sec(
    "WORK EXPERIENCE",
    "Acme Corp, Toronto, ON",
    "Senior Analyst Jan 2021 – Present",
    "Reporting: cut weekly report time from 6 hours to 1",
    "Built a churn model used by three teams",
    "Globex Inc, Montreal, QC",
    "Analyst Jun 2018 – Dec 2020",
    "Automation: replaced a manual export with a scheduled job",
  ),
  sec("EDUCATION", "University of Toronto, Toronto, ON", "B.Sc. in Statistics, 2018"),
];

const read = () => rereadAsTemplate(OLD())!;
const find = (sections: DocSection[], heading: string) => sections.find((s) => s.heading.toLowerCase() === heading.toLowerCase())!;

describe("rereadAsTemplate", () => {
  it("returns null when the resume already has a typed line", () => {
    const typed = OLD();
    typed[3].items[0].kind = "org";
    expect(rereadAsTemplate(typed)).toBeNull();
  });

  it("returns null for nothing to read", () => {
    expect(rereadAsTemplate([])).toBeNull();
    expect(rereadAsTemplate([sec("", "")])).toBeNull();
  });

  it("returns null when the reader finds no typed line to improve on", () => {
    expect(rereadAsTemplate([sec("NOTES", "just a thought")])).toBeNull();
  });

  it("recovers the header: the name line and the contact line", () => {
    const header = find(read(), "Header");
    expect(header.items.map((i) => i.text)).toEqual(["JORDAN LEE", "Toronto, ON | 416-555-0100 | jordan@example.com | linkedin.com/in/jordanlee"]);
  });

  it("recovers a summary split across three plain lines as one paragraph", () => {
    const summary = find(read(), "PROFESSIONAL SUMMARY");
    expect(summary.items.map((i) => i.text)).toEqual(["Analyst with six years in fintech building dashboards and reports for product teams and writing the SQL behind them."]);
    expect(summary.items[0].kind).toBeUndefined();
  });

  it("keeps each heading as it was written", () => {
    expect(read().map((s) => s.heading)).toEqual(["Header", "PROFESSIONAL SUMMARY", "SKILLS AND QUALIFICATIONS", "WORK EXPERIENCE", "EDUCATION"]);
  });

  it("recovers skill lines as a bold label and its values, with or without a colon", () => {
    const skills = find(read(), "SKILLS AND QUALIFICATIONS").items;
    expect(skills.map(({ id: _id, ...rest }) => rest)).toEqual([
      { kind: "skill", label: "Programming/Database", text: "SQL (Redshift), Python" },
      { kind: "skill", label: "Analytics", text: "Tableau, Excel" },
    ]);
  });

  it("recovers jobs, titles with their dates, and the plain lines under a job as bullets (a colon makes the lead-in a label)", () => {
    const jobs = find(read(), "WORK EXPERIENCE").items.map(({ id: _id, ...rest }) => rest);
    expect(jobs).toEqual([
      { kind: "org", text: "Acme Corp", right: "Toronto, ON" },
      { kind: "title", text: "Senior Analyst", right: "Jan 2021 – Present" },
      { kind: "bullet", label: "Reporting", text: "cut weekly report time from 6 hours to 1" },
      { kind: "bullet", text: "Built a churn model used by three teams" },
      { kind: "org", text: "Globex Inc", right: "Montreal, QC" },
      { kind: "title", text: "Analyst", right: "Jun 2018 – Dec 2020" },
      { kind: "bullet", label: "Automation", text: "replaced a manual export with a scheduled job" },
    ]);
  });

  it("recovers the school", () => {
    const edu = find(read(), "EDUCATION").items;
    expect(edu[0]).toMatchObject({ kind: "school", text: "University of Toronto", right: "Toronto, ON" });
    // The degree line has no rule of its own in the importer, so it stays a plain line (it is not turned into a bullet).
    expect(edu[1].kind).toBeUndefined();
    expect(edu[1].text).toBe("B.Sc. in Statistics, 2018");
  });

  it("never invents text: every word of the result was in the saved resume", () => {
    const had = new Set(OLD().flatMap((s) => [s.heading, ...s.items.map(itemText)]).join(" ").toLowerCase().split(/[^\p{L}\p{N}]+/u));
    for (const s of read()) for (const t of [s.heading, ...s.items.map(itemText)]) for (const w of t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
      expect(had.has(w) || w === "header").toBe(true);
    }
  });

  it("does not change the sections it was given", () => {
    const given = OLD();
    const before = JSON.stringify(given);
    rereadAsTemplate(given);
    expect(JSON.stringify(given)).toBe(before);
  });
});

import { describe, expect, it } from "vitest";
import { splitSections } from "../../src/documents/read";
import { MAX_DOC_ITEM_CHARS } from "../../src/db/limits";

const shape = (text: string) => splitSections(text).map((s) => [s.heading, s.items.map((i) => i.text)]);

describe("splitSections", () => {
  it("takes all caps, Title Case and colon lines as headings", () => {
    expect(shape("EXPERIENCE\nRan the desk\nWork History\nAcme Corp, 2019 to 2024\nSkills:\nwrites SQL daily")).toEqual([
      ["EXPERIENCE", ["Ran the desk"]],
      ["Work History", ["Acme Corp, 2019 to 2024"]],
      ["Skills", ["writes SQL daily"]],
    ]);
  });

  it("strips bullets and dashes from items, including Word's private-use bullet", () => {
    expect(shape("Skills:\n• SQL\n- Python\n– Excel\n Tableau\n* R")).toEqual([["Skills", ["SQL", "Python", "Excel", "Tableau", "R"]]]);
  });

  it("never takes a bulleted line for a heading", () => {
    expect(shape("Skills:\n- Data Analysis\n- PYTHON")).toEqual([["Skills", ["Data Analysis", "PYTHON"]]]);
  });

  it("does not take a sentence, a long line or a line with a full stop for a heading", () => {
    expect(shape("Education\nBachelor of Commerce.\nAnalyst at Acme in Toronto from 2019 to 2024 working on models")).toEqual([
      ["Education", ["Bachelor of Commerce.", "Analyst at Acme in Toronto from 2019 to 2024 working on models"]],
    ]);
    expect(shape("Summary of my work at Acme Corp and other places I have been")[0][0]).toBe("Summary");
  });

  it("puts text before the first heading under Summary, and makes no Summary when there is none", () => {
    expect(shape("Analyst with five years.\nLoves data.\nSKILLS\nwrites SQL daily")).toEqual([
      ["Summary", ["Analyst with five years.", "Loves data."]],
      ["SKILLS", ["writes SQL daily"]],
    ]);
    expect(shape("SKILLS\nwrites SQL daily").map((s) => s[0])).toEqual(["SKILLS"]);
  });

  it("takes only known section names as Title Case headings, so a company, a job title or a school stays a line", () => {
    expect(shape("Work Experience\nNorthwind Traders Toronto, ON\nSenior Analyst, Operations Aug 2022 – Present\nEducation and Training\nCity University | School of Business")).toEqual([
      ["Work Experience", ["Northwind Traders Toronto, ON", "Senior Analyst, Operations Aug 2022 – Present"]],
      ["Education and Training", ["City University | School of Business"]],
    ]);
  });

  it("joins the lines of a wrapped bullet, the way a PDF breaks them", () => {
    const text = [
      "EXPERIENCE",
      "● Process Design: Own end-to-end design for a team of analysts across the",
      "business and lead a program with 10+ stakeholders across Product, Risk, and",
      "Operations.",
      "● Reporting: Built a dashboard used by the whole group.",
    ].join("\n");
    expect(shape(text)).toEqual([[
      "EXPERIENCE",
      [
        "Process Design: Own end-to-end design for a team of analysts across the business and lead a program with 10+ stakeholders across Product, Risk, and Operations.",
        "Reporting: Built a dashboard used by the whole group.",
      ],
    ]]);
  });

  it("joins a capitalised wrap only after a bullet that hasn't ended, and never an entry line or a bullet that ended", () => {
    expect(shape("EXPERIENCE\n● Led the migration to a new platform with the help of\nFinance and Risk partners\n● Cut close time\nAnalyst, Data Team Jan 2020 – Present")).toEqual([
      ["EXPERIENCE", ["Led the migration to a new platform with the help of Finance and Risk partners", "Cut close time", "Analyst, Data Team Jan 2020 – Present"]],
    ]);
    expect(shape("EXPERIENCE\n● Cut close time by two days.\nSecond Company")).toEqual([["EXPERIENCE", ["Cut close time by two days.", "Second Company"]]]);
  });

  it("keeps a wrapped paragraph as one line, and the skill lines under their heading apart", () => {
    expect(shape("SUMMARY\nProcess and data professional with three years in fintech. Leads work on\nautomation and controls that cut manual effort and\nimprove accuracy across teams.\nSKILLS\nLanguages SQL, Python\nTools Excel · Tableau")).toEqual([
      ["SUMMARY", ["Process and data professional with three years in fintech. Leads work on automation and controls that cut manual effort and improve accuracy across teams."]],
      ["SKILLS", ["Languages SQL, Python", "Tools Excel · Tableau"]],
    ]);
  });

  it("takes a name and a line of contact details at the top as the Header, in any case", () => {
    expect(shape("JANE SMITH\nToronto, Ontario | (416) 555-0100 | LinkedIn | jane@example.com\nSUMMARY\nAnalyst.")).toEqual([
      ["Header", ["JANE SMITH", "Toronto, Ontario | (416) 555-0100 | LinkedIn | jane@example.com"]],
      ["SUMMARY", ["Analyst."]],
    ]);
    expect(shape("Jane Smith\njane@example.com\nSKILLS\nSQL")[0]).toEqual(["Header", ["Jane Smith", "jane@example.com"]]);
    // a name with no contact line under it isn't a header
    expect(shape("Jane Smith\nAnalyst with five years.\nSKILLS\nSQL")[0][0]).toBe("Summary");
  });

  it("splits a whole one-page resume layout into header, summary, skills, experience and education", () => {
    const text = [
      "JORDAN LEE", "Toronto, Ontario | (416) 555-0100 | LinkedIn | jordan@example.com",
      "PROFESSIONAL SUMMARY", "Operations analyst with 3+ years in retail. Leads reporting and", "planning work that reduces manual effort across teams.",
      "SKILLS AND QUALIFICATIONS", "Programming SQL, Python, Excel", "Analytics Tableau · Power BI",
      "WORK EXPERIENCE", "Northwind Traders Toronto, ON", "Senior Analyst, Planning Aug 2024 – Present",
      "● Planning: Own the seasonal plan for 60+ brands across 70 stores, refining demand", "forecasts and markdown decisions with category teams.",
      "● Reporting: Automated the weekly report, reclaiming ~500 hours a year.",
      "Analyst, Reporting", "● Controls: Built reconciliations for the finance team.",
      "EDUCATION", "City University | School of Business Kingston, ON", "Master of Analytics",
    ].join("\n");
    expect(shape(text)).toEqual([
      ["Header", ["JORDAN LEE", "Toronto, Ontario | (416) 555-0100 | LinkedIn | jordan@example.com"]],
      ["PROFESSIONAL SUMMARY", ["Operations analyst with 3+ years in retail. Leads reporting and planning work that reduces manual effort across teams."]],
      ["SKILLS AND QUALIFICATIONS", ["Programming SQL, Python, Excel", "Analytics Tableau · Power BI"]],
      ["WORK EXPERIENCE", [
        "Northwind Traders Toronto, ON", "Senior Analyst, Planning Aug 2024 – Present",
        "Planning: Own the seasonal plan for 60+ brands across 70 stores, refining demand forecasts and markdown decisions with category teams.",
        "Reporting: Automated the weekly report, reclaiming ~500 hours a year.",
        "Analyst, Reporting", "Controls: Built reconciliations for the finance team.",
      ]],
      ["EDUCATION", ["City University | School of Business Kingston, ON", "Master of Analytics"]],
    ]);
  });

  it("returns nothing for empty text, and keeps a heading with no lines", () => {
    expect(splitSections("  \n\n ")).toEqual([]);
    expect(shape("EDUCATION")).toEqual([["EDUCATION", []]]);
  });

  it("gives every section and line its own id and cuts long lines like normalizeSections", () => {
    const sections = splitSections(`SKILLS\n${"x".repeat(MAX_DOC_ITEM_CHARS + 50)}\nwrites SQL`);
    expect(sections[0].items[0].text).toHaveLength(MAX_DOC_ITEM_CHARS);
    const ids = sections.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("handles Windows line endings and uneven spacing", () => {
    expect(shape("SKILLS\r\n  writes   Python \r\n")).toEqual([["SKILLS", ["writes Python"]]]);
  });
});

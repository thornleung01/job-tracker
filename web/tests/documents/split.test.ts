import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, readPastedSections, splitSections } from "../../src/documents/read";
import { MAX_DOC_ITEM_CHARS, MAX_DOC_ITEMS, MAX_DOC_LABEL_CHARS, MAX_DOC_RIGHT_CHARS } from "../../src/db/limits";

import { TEMPLATE_RESUME_LINES } from "./fixtures";

/** Every line with what it is: its text, plus kind, label and right where it has them. */
const detail = (text: string) => splitSections(text).map((s) => [s.heading, s.items.map(({ id: _id, ...rest }) => rest)] as const);
/** The lines under one heading. */
const items = (text: string, heading = "WORK EXPERIENCE") => detail(`Jane Smith\njane@example.com\n${heading}\n${text}`)[1][1];
const shape = (text: string) => splitSections(text).map((s) => [s.heading, s.items.map((i) => i.text)]);

describe("splitSections", () => {
  it("takes all caps, Title Case and colon lines as headings", () => {
    expect(shape("EXPERIENCE\nRan the desk\nWork History\nAcme Corp, 2019 to 2024\nSkills:\nwrites SQL daily")).toEqual([
      ["EXPERIENCE", ["Ran the desk"]],
      ["Work History", ["Acme Corp"]],
      ["Skills", ["writes SQL daily"]],
    ]);
  });

  it("strips bullets and dashes from items, including Word's private-use bullet", () => {
    expect(shape("Skills:\n• SQL\n- Python\n– Excel\n\uF0B7 Tableau\n* R")).toEqual([["Skills", ["SQL", "Python", "Excel", "Tableau", "R"]]]);
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
      ["Work Experience", ["Northwind Traders", "Senior Analyst, Operations"]],
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
        "Own end-to-end design for a team of analysts across the business and lead a program with 10+ stakeholders across Product, Risk, and Operations.",
        "Built a dashboard used by the whole group.",
      ],
    ]]);
  });

  it("joins a capitalised wrap only after a bullet that hasn't ended, and never an entry line or a bullet that ended", () => {
    expect(shape("EXPERIENCE\n● Led the migration to a new platform with the help of\nFinance and Risk partners\n● Cut close time\nAnalyst, Data Team Jan 2020 – Present")).toEqual([
      ["EXPERIENCE", ["Led the migration to a new platform with the help of Finance and Risk partners", "Cut close time", "Analyst, Data Team"]],
    ]);
    expect(shape("EXPERIENCE\n● Cut close time by two days.\nSecond Company")).toEqual([["EXPERIENCE", ["Cut close time by two days.", "Second Company"]]]);
  });

  it("keeps a wrapped paragraph as one line, and the skill lines under their heading apart", () => {
    expect(shape("SUMMARY\nProcess and data professional with three years in fintech. Leads work on\nautomation and controls that cut manual effort and\nimprove accuracy across teams.\nSKILLS\nLanguages SQL, Python\nTools Excel · Tableau")).toEqual([
      ["SUMMARY", ["Process and data professional with three years in fintech. Leads work on automation and controls that cut manual effort and improve accuracy across teams."]],
      ["SKILLS", ["SQL, Python", "Excel · Tableau"]],
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
    expect(shape("NOTES\r\n  writes   Python \r\n")).toEqual([["NOTES", ["writes Python"]]]);
  });

  describe("kinds", () => {
    it("reads the template layout: header, summary, skills, jobs with titles and bullets, schools", () => {
      const got = detail(TEMPLATE_RESUME_LINES.join("\n"));
      expect(got.map(([h]) => h)).toEqual(["Header", "PROFESSIONAL SUMMARY", "SKILLS AND QUALIFICATIONS", "WORK EXPERIENCE", "EDUCATION"]);
      expect(got[0][1]).toEqual([{ text: "JORDAN LEE" }, { text: "Toronto, Ontario | (416) 555-0100 | LinkedIn | jordan@example.com" }]);
      expect(got[1][1]).toEqual([{ text: "Operations analyst with 3+ years in retail and logistics. Leads reporting and planning work that reduces manual effort across teams." }]);
      expect(got[2][1]).toEqual([
        { kind: "skill", label: "Programming/Database", text: "SQL (Redshift), Python, R" },
        { kind: "skill", label: "Analytics", text: "Microsoft Excel · Tableau · Power BI" },
        { kind: "skill", label: "Languages", text: "English, French" },
      ]);
      expect(got[3][1]).toEqual([
        { kind: "org", text: "Northwind Traders", right: "Toronto, ON" },
        { kind: "title", text: "Senior Analyst, Planning", right: "Aug 2024 – Present" },
        { kind: "bullet", label: "Planning", text: "Own the seasonal plan for 60+ brands across 70 stores, refining demand forecasts and markdown decisions with category teams." },
        { kind: "bullet", label: "Reporting", text: "Automated the weekly report, reclaiming ~500 hours a year." },
        { kind: "title", text: "Associate, Data and Analytics" },
        { kind: "bullet", label: "Controls", text: "Built reconciliations for the finance team." },
        { kind: "title", text: "Analyst, Reporting", right: "Jan 2020 - Dec 2022" },
        { kind: "bullet", text: "Reviewed vendor files before each close." },
        { kind: "org", text: "Contoso Retail", right: "New York, NY" },
        { kind: "title", text: "Planner", right: "2019 – 2022" },
        { kind: "bullet", label: "Forecasting", text: "Cut stock-outs by 12% with a weekly review." },
      ]);
      expect(got[4][1]).toEqual([
        { kind: "school", text: "City University | School of Business", right: "Kingston, ON" },
        { text: "Master of Analytics" },
        { kind: "school", text: "Lakeside College", right: "Ottawa, ON" },
        { text: "Bachelor of Commerce" },
      ]);
    });

    it("reads the same layout when the right-hand text is only separated by spaces", () => {
      const spaced = TEMPLATE_RESUME_LINES.map((l) => l.replace("\t", "          ")).join("\n");
      expect(detail(spaced)).toEqual(detail(TEMPLATE_RESUME_LINES.join("\n")));
    });

    it("cuts a bullet's label at the first colon only when it is short and followed by text", () => {
      expect(items("● Planning: Own the plan: with a second colon")).toEqual([{ kind: "bullet", label: "Planning", text: "Own the plan: with a second colon" }]);
      expect(items("● Led a team of five analysts, one of them new: it went well")).toEqual([
        { kind: "bullet", text: "Led a team of five analysts, one of them new: it went well" },
      ]);
      expect(items("● Planning:")).toEqual([{ kind: "bullet", text: "Planning:" }]);
      expect(items("● See https://example.com/work for details")).toEqual([{ kind: "bullet", text: "See https://example.com/work for details" }]);
      expect(items(`● ${"x".repeat(61)}: too long a label`)[0]).not.toHaveProperty("label");
      expect(items("● Reporting and Automation: Built the weekly report.")[0]).toMatchObject({ label: "Reporting and Automation" });
    });

    it("cuts the label after joining a wrapped bullet", () => {
      expect(items("● Planning: Own the seasonal plan for the brands and refine\nforecasts with category teams.")).toEqual([
        { kind: "bullet", label: "Planning", text: "Own the seasonal plan for the brands and refine forecasts with category teams." },
      ]);
    });

    it("takes a tab or gap line with dates on the right as a title, with and without a month", () => {
      expect(items("Senior Analyst\tAug 2024 – Present")).toEqual([{ kind: "title", text: "Senior Analyst", right: "Aug 2024 – Present" }]);
      expect(items("Analyst\tJan 2020 - Dec 2022")).toEqual([{ kind: "title", text: "Analyst", right: "Jan 2020 - Dec 2022" }]);
      expect(items("Analyst   2019 – 2022")).toEqual([{ kind: "title", text: "Analyst", right: "2019 – 2022" }]);
      expect(items("Analyst\t2024")).toEqual([{ kind: "title", text: "Analyst", right: "2024" }]);
    });

    it("takes a line that ends in a date range as a title when there is no gap", () => {
      expect(items("Senior Analyst, Planning Aug 2024 – Present")).toEqual([{ kind: "title", text: "Senior Analyst, Planning", right: "Aug 2024 – Present" }]);
      expect(items("Analyst, Data Team 2019 to 2022")).toEqual([{ kind: "title", text: "Analyst, Data Team", right: "2019 to 2022" }]);
      // a single year with no gap, or a sentence trailing off into a date, stays plain
      expect(items("Analyst 2019")).toEqual([{ text: "Analyst 2019" }]);
      expect(items("Worked at Acme from 2019 - 2022")).toEqual([{ text: "Worked at Acme from 2019 - 2022" }]);
    });

    it("takes a short Title Case job title with no dates as a title, only after an org line or bullets and only when it looks like one", () => {
      expect(items("Northwind Traders\tToronto, ON\nAssociate, Data and Analytics")[1]).toEqual({ kind: "title", text: "Associate, Data and Analytics" });
      expect(items("● Did the work.\nSenior Planner")[1]).toEqual({ kind: "title", text: "Senior Planner" });
      // not after a plain line, with no title word or comma, with a company suffix, or in sentence case
      expect(items("Some line\nSenior Planner")[1]).toEqual({ text: "Senior Planner" });
      expect(items("● Did the work.\nNorthwind Traders")[1]).toEqual({ text: "Northwind Traders" });
      expect(items("● Did the work.\nAcme Corp, Inc")[1]).toEqual({ text: "Acme Corp, Inc" });
      expect(items("● Did the work.\nSenior planner on the team")[1]).toEqual({ text: "Senior planner on the team" });
    });

    it("takes a gap line with a location as an org (work) or a school (education)", () => {
      expect(items("Northwind Traders\tToronto, ON")).toEqual([{ kind: "org", text: "Northwind Traders", right: "Toronto, ON" }]);
      expect(items("Acme\tNew York, NY")).toEqual([{ kind: "org", text: "Acme", right: "New York, NY" }]);
      expect(items("Acme\tRemote")).toEqual([{ kind: "org", text: "Acme", right: "Remote" }]);
      expect(items("City University\tKingston, ON", "EDUCATION")).toEqual([{ kind: "school", text: "City University", right: "Kingston, ON" }]);
      expect(items("City University\tKingston, ON", "Certifications")).toEqual([{ kind: "school", text: "City University", right: "Kingston, ON" }]);
      expect(items("Volunteer Group\tKingston, ON", "VOLUNTEER")).toEqual([{ kind: "org", text: "Volunteer Group", right: "Kingston, ON" }]);
    });

    it("splits a trailing city and province off a line with no gap", () => {
      expect(items("Northwind Traders Toronto, ON")).toEqual([{ kind: "org", text: "Northwind Traders", right: "Toronto, ON" }]);
      expect(items("Contoso Retail New York, NY")).toEqual([{ kind: "org", text: "Contoso Retail", right: "New York, NY" }]);
      expect(items("City University | School of Business Kingston, ON", "EDUCATION")).toEqual([
        { kind: "school", text: "City University | School of Business", right: "Kingston, ON" },
      ]);
      // a code we don't know, no capitalized city, or nothing left of the city
      expect(items("Northwind Traders Toronto, ZZ")).toEqual([{ text: "Northwind Traders Toronto, ZZ" }]);
      expect(items("Planning models, ON")).toEqual([{ text: "Planning models, ON" }]);
      expect(items("Toronto, ON")).toEqual([{ text: "Toronto, ON" }]);
    });

    it("leaves a gap line whose right side is neither dates nor a location as a plain line, gap removed", () => {
      expect(items("Ran the desk\tfor five years")).toEqual([{ text: "Ran the desk for five years" }]);
    });

    it("does not take a right-aligned location or date for a heading, nor join it onto a bullet", () => {
      expect(detail("WORK EXPERIENCE\n● Led the move to a new platform with the help of\nNORTHWIND TRADERS\tTORONTO, ON")[0][1]).toEqual([
        { kind: "bullet", text: "Led the move to a new platform with the help of" },
        { kind: "org", text: "NORTHWIND TRADERS", right: "TORONTO, ON" },
      ]);
    });

    it("makes a skill from Label: values, a gap, or a Title Case label then a list", () => {
      const skills = (t: string) => items(t, "SKILLS");
      expect(skills("Languages: English, French")).toEqual([{ kind: "skill", label: "Languages", text: "English, French" }]);
      expect(skills("Analytics\tExcel, Tableau")).toEqual([{ kind: "skill", label: "Analytics", text: "Excel, Tableau" }]);
      expect(skills("Programming/Database SQL (Redshift), Python")).toEqual([{ kind: "skill", label: "Programming/Database", text: "SQL (Redshift), Python" }]);
      expect(skills("Analytics Microsoft Excel · Tableau")).toEqual([{ kind: "skill", label: "Analytics", text: "Microsoft Excel · Tableau" }]);
      expect(skills("Programming Languages SQL, Python, R, Java, Scala")).toEqual([{ kind: "skill", label: "Programming Languages", text: "SQL, Python, R, Java, Scala" }]);
    });

    it("keeps a skills line plain when it isn't clearly a label and values", () => {
      const skills = (t: string) => items(t, "SKILLS");
      expect(skills("SQL, Python, Excel")).toEqual([{ text: "SQL, Python, Excel" }]); // no label
      expect(skills("Strong communication, leadership")).toEqual([{ text: "Strong communication, leadership" }]); // values start lowercase
      expect(skills("Analytics Tableau")).toEqual([{ text: "Analytics Tableau" }]); // no separator in the values
      expect(skills("Excel")).toEqual([{ text: "Excel" }]);
      expect(skills("Microsoft Excel, R")).toEqual([{ text: "Microsoft Excel, R" }]); // the label would be longer than the values
    });

    it("gives no kinds outside work, education and skills, except for bullets", () => {
      expect(items("Northwind Traders\tToronto, ON\nAnalyst\tAug 2024 – Present", "AWARDS")).toEqual([
        { text: "Northwind Traders Toronto, ON" },
        { text: "Analyst Aug 2024 – Present" },
      ]);
      expect(items("● Won: first place", "AWARDS")).toEqual([{ kind: "bullet", label: "Won", text: "first place" }]);
    });

    it("gives no dates title in an education section, and leaves a degree line plain", () => {
      expect(items("Master of Analytics\t2022", "EDUCATION")).toEqual([{ text: "Master of Analytics 2022" }]);
    });
  });
});

describe("splitSections: guards against slow or huge text", () => {
  /** The label, right and text lengths of every line stay inside the limits normalizeSections sets. */
  const expectCapped = (sections: ReturnType<typeof splitSections>) => {
    expect(sections.length).toBeLessThanOrEqual(30);
    for (const s of sections) {
      expect(s.items.length).toBeLessThanOrEqual(MAX_DOC_ITEMS);
      for (const i of s.items) {
        expect(i.text.length).toBeLessThanOrEqual(MAX_DOC_ITEM_CHARS);
        expect((i.label ?? "").length).toBeLessThanOrEqual(MAX_DOC_LABEL_CHARS);
        expect((i.right ?? "").length).toBeLessThanOrEqual(MAX_DOC_RIGHT_CHARS);
      }
    }
  };
  const timed = <T>(run: () => T): [T, number] => {
    const start = performance.now();
    const result = run();
    return [result, performance.now() - start];
  };

  it("reads 200,000 continuation lines quickly instead of joining them all into one item", () => {
    const [sections, ms] = timed(() => splitSections(`Work Experience\n- a\n${"Bcd efg hij klm nop qrs tuv wxy zab cde\n".repeat(200_000)}`));
    expect(ms).toBeLessThan(3000);
    expectCapped(sections);
  });

  it("stops joining a wrapped bullet once it has as much text as an item can keep, and starts a new item", () => {
    const wrapped = Array.from({ length: 100 }, () => "Bcd efg hij klm nop qrs tuv wxy zab cde").join("\n");
    const lines = items(`● Started\n${wrapped}`);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].text).toHaveLength(MAX_DOC_ITEM_CHARS);
  });

  it("ignores lines past the first 20,000", () => {
    const text = `Notes:\n${"- x\n".repeat(20_000)}LATE HEADING\nlate line`;
    expect(splitSections(text).map((s) => s.heading)).toEqual(["Notes"]);
    expect(splitSections(`Notes:\n${"- x\n".repeat(100)}EARLY HEADING\nline`).map((s) => s.heading)).toEqual(["Notes", "EARLY HEADING"]);
  });

  it("ignores pasted text past the size of a file", () => {
    const text = `Skills:\nwrites SQL daily\n${" ".repeat(MAX_FILE_BYTES)}\nLATE HEADING\nlate line`;
    expect(readPastedSections(text).map((s) => s.heading)).toEqual(["Skills"]);
    expect(splitSections(text).map((s) => s.heading)).toEqual(["Skills"]);
  });

  it("caps a 1 MB single line, with and without a heading before it", () => {
    for (const text of [`Work Experience\n${"A".repeat(1_000_000)}`, "A".repeat(1_000_000), `Work Experience\n- ${"word ".repeat(200_000)}`]) {
      const [sections, ms] = timed(() => splitSections(text));
      expect(ms).toBeLessThan(3000);
      expectCapped(sections);
    }
  });

  it("caps the number of lines in a section", () => {
    const text = `Work Experience\n${Array.from({ length: MAX_DOC_ITEMS + 50 }, (_, i) => `- Bullet number ${i}.`).join("\n")}`;
    const sections = splitSections(text);
    expect(sections[0].items).toHaveLength(MAX_DOC_ITEMS);
    expectCapped(sections);
  });

  it("reads long runs of tabs, spaces and commas in time", () => {
    const run = 1_000_000;
    const texts = [
      `Work Experience\nAcme${"\t".repeat(run)}Toronto, ON`,
      `Work Experience\nAcme${" ".repeat(run)}Toronto, ON`,
      `Work Experience\nAcme${",".repeat(run)}Toronto, ON`,
      `Work Experience\n${"a,".repeat(run / 2)}x 2019 - 2020`,
      `Work Experience\n${",".repeat(run)}x 2019 - 2020`,
      `Work Experience\n${"\t ".repeat(run / 2)}x\t2019 - 2020`,
      `Skills\n${"Tableau, ".repeat(run / 9)}`,
      `Skills\n${"A\t".repeat(run / 2)}`,
    ];
    for (const text of texts) {
      const [sections, ms] = timed(() => splitSections(text));
      expect(ms).toBeLessThan(3000);
      expectCapped(sections);
    }
  });
});

describe("splitSections: rules and their known limits", () => {
  const NBSP = String.fromCharCode(0xa0);
  const skills = (t: string) => items(t, "SKILLS");

  it("leaves no stray comma on the org when a comma stood between the company and the city", () => {
    expect(items("Northwind Traders, Toronto, ON")).toEqual([{ kind: "org", text: "Northwind Traders", right: "Toronto, ON" }]);
  });

  it("known limit: a degree line with a school and city in Education is one school line with the degree in its name", () => {
    expect(items("Bachelor of Commerce, Queen's University, Kingston, ON", "EDUCATION")).toEqual([
      { kind: "school", text: "Bachelor of Commerce, Queen's University", right: "Kingston, ON" },
    ]);
  });

  it("does not take two names in a row for a title, but still takes a comma title that has a title word", () => {
    expect(items("● Did the work.\nSmith, Jones")[1]).toEqual({ text: "Smith, Jones" });
    expect(items("Northwind Traders\tToronto, ON\nSmith, Jones")[1]).toEqual({ text: "Smith, Jones" });
    expect(items("● Did the work.\nAssociate, Data and Analytics")[1]).toEqual({ kind: "title", text: "Associate, Data and Analytics" });
    expect(items("● Did the work.\nSenior Associate, Automations")[1]).toEqual({ kind: "title", text: "Senior Associate, Automations" });
    expect(items("● Did the work.\nAcme Corp, Inc")[1]).toEqual({ text: "Acme Corp, Inc" });
  });

  it("does not take a bare list of capitalized names for a skill with a label, but trusts a colon, a gap or a known label word", () => {
    expect(skills("Tableau Excel, Power BI")).toEqual([{ text: "Tableau Excel, Power BI" }]);
    expect(skills("Tableau: Excel, Power BI")).toEqual([{ kind: "skill", label: "Tableau", text: "Excel, Power BI" }]);
    expect(skills("Tableau\tExcel, Power BI")).toEqual([{ kind: "skill", label: "Tableau", text: "Excel, Power BI" }]);
    expect(skills("Tableau          Excel, Power BI")).toEqual([{ kind: "skill", label: "Tableau", text: "Excel, Power BI" }]);
    expect(skills("Analytics Microsoft Excel · Tableau · Preset · Power BI")).toEqual([
      { kind: "skill", label: "Analytics", text: "Microsoft Excel · Tableau · Preset · Power BI" },
    ]);
    expect(skills("Programming/Database SQL (Redshift), Python, R")).toEqual([{ kind: "skill", label: "Programming/Database", text: "SQL (Redshift), Python, R" }]);
    expect(skills("Technologies Microsoft Suites · Jira · Confluence")).toEqual([{ kind: "skill", label: "Technologies", text: "Microsoft Suites · Jira · Confluence" }]);
    expect(skills("TOOLS Excel, Tableau, Looker")).toEqual([{ kind: "skill", label: "TOOLS", text: "Excel, Tableau, Looker" }]);
    expect(skills("Cloud AWS, Azure, GCP, Snowflake")).toEqual([{ kind: "skill", label: "Cloud", text: "AWS, Azure, GCP, Snowflake" }]);
  });

  it("does not take a sentence that ends in a date range for a title", () => {
    expect(items("Led the Q3 migration, finished Mar 2021 – Jun 2021")).toEqual([{ text: "Led the Q3 migration, finished Mar 2021 – Jun 2021" }]);
    expect(items("Senior Analyst & Co-lead 2019 – 2022")).toEqual([{ kind: "title", text: "Senior Analyst & Co-lead", right: "2019 – 2022" }]);
    expect(items("Analyst, Team 3 2019 – 2022")).toEqual([{ kind: "title", text: "Analyst, Team 3", right: "2019 – 2022" }]);
    expect(items("Planner, R&D 2019 – 2022")).toEqual([{ kind: "title", text: "Planner, R&D", right: "2019 – 2022" }]);
  });

  it("does not take a line that trails off into a date for a title, whichever word it trails off with", () => {
    for (const word of ["from", "in", "since", "during", "between", "until", "through", "and", "of", "at", "From", "At"]) {
      expect(items(`Senior Analyst ${word} 2019 – 2022`)).toEqual([{ text: `Senior Analyst ${word} 2019 – 2022` }]);
    }
  });

  it("known limit: a city of three words with no gap is cut in the wrong place, and with a gap it is exact", () => {
    expect(items("Acme Salt Lake City, UT")).toEqual([{ kind: "org", text: "Acme Salt Lake", right: "City, UT" }]);
    expect(items("Acme\tSalt Lake City, UT")).toEqual([{ kind: "org", text: "Acme", right: "Salt Lake City, UT" }]);
    expect(items("Acme   Salt Lake City, UT")).toEqual([{ kind: "org", text: "Acme", right: "Salt Lake City, UT" }]);
    expect(items(`Acme${NBSP}${NBSP}${NBSP}Salt Lake City, UT`)).toEqual([{ kind: "org", text: "Acme", right: "Salt Lake City, UT" }]);
  });

  it("treats 2 spaces as a plain space (a two-word city split still applies) and 3 spaces or 3 non-breaking spaces as a gap", () => {
    expect(items("Acme  Toronto, ON")).toEqual([{ kind: "org", text: "Acme", right: "Toronto, ON" }]);
    expect(items("Acme   Toronto, ON")).toEqual([{ kind: "org", text: "Acme", right: "Toronto, ON" }]);
    expect(items(`Acme${NBSP}${NBSP}Toronto, ON`)).toEqual([{ kind: "org", text: "Acme", right: "Toronto, ON" }]);
    expect(items(`Acme${NBSP}${NBSP}${NBSP}Toronto, ON`)).toEqual([{ kind: "org", text: "Acme", right: "Toronto, ON" }]);
    // the difference shows when the right side has more words than the guess allows
    expect(items("Acme  Salt Lake City, UT")).toEqual([{ kind: "org", text: "Acme Salt Lake", right: "City, UT" }]);
    expect(items(`Analyst${NBSP}${NBSP}${NBSP}Aug 2024 – Present`)).toEqual([{ kind: "title", text: "Analyst", right: "Aug 2024 – Present" }]);
    expect(items(`Ran${NBSP}${NBSP}the desk`)).toEqual([{ text: "Ran the desk" }]);
  });

  it("reads each form of a date range on the right of a gap", () => {
    for (const range of ["Sept. 2020", "Jan 2020 to Now", "Mar 2020 – Current", "Mar 2020 - Current", "2019—2022", "2019-2022", "2019 to Present", "Sep 2020 – Dec 2021", "2020"]) {
      expect(items(`Analyst\t${range}`)).toEqual([{ kind: "title", text: "Analyst", right: range }]);
    }
    for (const notRange of ["Spring 2020", "2020 2021", "Aug 2024 –", "12/2020"]) {
      expect(items(`Analyst\t${notRange}`)).toEqual([{ text: `Analyst ${notRange}` }]);
    }
  });

  it("does not take a right-aligned date line in capitals for a heading", () => {
    expect(detail("WORK EXPERIENCE\nSENIOR ANALYST\tAUG 2024 – PRESENT\nANALYST   2019 - 2022")).toEqual([
      ["WORK EXPERIENCE", [{ kind: "title", text: "SENIOR ANALYST", right: "AUG 2024 – PRESENT" }, { kind: "title", text: "ANALYST", right: "2019 - 2022" }]],
    ]);
  });

  it("limits the left side of a dated line with no gap to 10 words, and does not limit it with a gap", () => {
    const tenWords = "Senior Analyst Data Planning Reporting Finance Retail Logistics Group Team";
    expect(items(`${tenWords} 2019 – 2022`)).toEqual([{ kind: "title", text: tenWords, right: "2019 – 2022" }]);
    expect(items(`${tenWords} Group 2019 – 2022`)).toEqual([{ text: `${tenWords} Group 2019 – 2022` }]);
    // known limit: with a gap the dates are trusted whatever is on the left
    expect(items(`${tenWords} Group\t2019 – 2022`)[0]).toMatchObject({ kind: "title", right: "2019 – 2022" });
  });

  it("keeps a bullet that is only a label as plain text", () => {
    expect(items("- Label:")).toEqual([{ kind: "bullet", text: "Label:" }]);
    expect(items("● Label:   ")).toEqual([{ kind: "bullet", text: "Label:" }]);
  });

  it("accepts a spelled-out province or state, with a gap, without one, and with a comma after the company", () => {
    expect(items("Northfield Bank\tToronto, Ontario")).toEqual([{ kind: "org", text: "Northfield Bank", right: "Toronto, Ontario" }]);
    expect(items("Harbour Retail   Mississauga, Ontario")).toEqual([{ kind: "org", text: "Harbour Retail", right: "Mississauga, Ontario" }]);
    expect(items("Northfield Bank Toronto, Ontario")).toEqual([{ kind: "org", text: "Northfield Bank", right: "Toronto, Ontario" }]);
    expect(items("Northfield Bank, Toronto, Ontario")).toEqual([{ kind: "org", text: "Northfield Bank", right: "Toronto, Ontario" }]);
    expect(items("Contoso Retail New York, New York")).toEqual([{ kind: "org", text: "Contoso Retail", right: "New York, New York" }]);
    expect(items("Acme\tMontreal, Québec")).toEqual([{ kind: "org", text: "Acme", right: "Montreal, Québec" }]);
    expect(items("Acme\tSt. John's, Newfoundland and Labrador")).toEqual([{ kind: "org", text: "Acme", right: "St. John's, Newfoundland and Labrador" }]);
    expect(items("Acme\tAtlanta, Georgia")).toEqual([{ kind: "org", text: "Acme", right: "Atlanta, Georgia" }]);
    expect(items("Acme\tVictoria, british columbia")).toEqual([{ kind: "org", text: "Acme", right: "Victoria, british columbia" }]);
    expect(items("City University\tKingston, Ontario", "EDUCATION")).toEqual([{ kind: "school", text: "City University", right: "Kingston, Ontario" }]);
    expect(items("City University Kingston, Ontario", "EDUCATION")).toEqual([{ kind: "school", text: "City University", right: "Kingston, Ontario" }]);
  });

  it("keeps a bare region, an unknown region or a lowercase city plain", () => {
    expect(items("Northfield Bank Georgia")).toEqual([{ text: "Northfield Bank Georgia" }]);
    expect(items("Acme\tWashington")).toEqual([{ text: "Acme Washington" }]);
    expect(items("Northfield Bank Toronto, Ontarioo")).toEqual([{ text: "Northfield Bank Toronto, Ontarioo" }]);
    expect(items("Planning models, Ontario")).toEqual([{ text: "Planning models, Ontario" }]);
    expect(items("Toronto, Ontario")).toEqual([{ text: "Toronto, Ontario" }]);
    expect(items("Acme Toronto, on")).toEqual([{ text: "Acme Toronto, on" }]);
  });

  describe("which area a heading is", () => {
    const org = [{ kind: "org", text: "Acme", right: "Toronto, ON" }];
    const plain = [{ text: "Acme Toronto, ON" }];
    it("matches whole words only", () => {
      expect(items("Acme\tToronto, ON", "Volunteer Experience")).toEqual(org);
      expect(items("Acme\tToronto, ON", "Volunteering")).toEqual(org);
      expect(items("Acme\tToronto, ON", "Work History")).toEqual(org);
      expect(items("Acme\tToronto, ON", "Projects")).toEqual(org);
      expect(items("Acme\tToronto, ON", "Teamwork:")).toEqual(plain);
      expect(items("Acme\tToronto, ON", "Network:")).toEqual(plain);
      expect(items("Acme\tToronto, ON", "Frameworks:")).toEqual(plain);
    });
    it("takes the first area that fits: skills, then education, then work, and anything else stays plain", () => {
      expect(items("Analytics\tExcel", "Skills and Work Experience:")).toEqual([{ kind: "skill", label: "Analytics", text: "Excel" }]);
      expect(items("Spanish\tFluent", "Languages")).toEqual([{ kind: "skill", label: "Spanish", text: "Fluent" }]);
      expect(items("City University\tKingston, ON", "Training")).toEqual([{ kind: "school", text: "City University", right: "Kingston, ON" }]);
      expect(items("Acme\tToronto, ON", "Awards")).toEqual(plain);
      expect(items("Acme\tToronto, ON", "Interests")).toEqual(plain);
    });
  });
});

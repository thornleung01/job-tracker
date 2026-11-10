// The skill-like words in a posting, worked out from its text alone.
import { describe, expect, it } from "vitest";
import { postingTerms } from "../../src/documents/postingTerms";
import type { DocSection } from "../../src/db/schema";

const resume = (...texts: string[]): DocSection[] => [{ id: "s", heading: "Skills", items: texts.map((text, i) => ({ id: `i${i}`, text })) }];

const POSTING = `Gringotts Bank is hiring a Product Analyst.

About the role
We are looking for someone who loves data. You will build dashboards in Tableau, write SQL every day and run A/B tests with Python.
Requirements:
- 3+ years of experience with Excel, stakeholder reporting and Power BI
- Strong knowledge of Google Analytics
- Comfortable with C++ or Node.js
The Team is friendly. Gringotts offers great benefits.`;

const names = (posting: string, sections: DocSection[] = [], opts?: { company?: string; max?: number }) => postingTerms(posting, sections, opts).map((t) => t.term);

describe("postingTerms", () => {
  it("finds technical terms, capitalised names and phrases, and the lists after 'experience with'", () => {
    const got = names(POSTING, [], { company: "Gringotts Bank" });
    for (const term of ["Tableau", "SQL", "Python", "Excel", "Power BI", "Google Analytics", "C++", "Node.js", "stakeholder reporting"]) expect(got, term).toContain(term);
  });

  it("drops stop words, headings and sentence openers", () => {
    const got = names(POSTING, [], { company: "Gringotts Bank" }).map((t) => t.toLowerCase());
    for (const word of ["we", "you", "the", "about", "requirements", "team", "strong", "a", "is"]) expect(got, word).not.toContain(word);
    expect(got).not.toContain("the team");
  });

  it("drops the company's name, in any term that holds it", () => {
    expect(names(POSTING, [], { company: "Gringotts Bank" }).join(" ")).not.toMatch(/Gringotts|Bank/);
    expect(names("Join Acme Corp. Acme Analytics uses Snowflake.", [], { company: "Acme Corp" })).toEqual(["Snowflake"]);
    // without the company it is only a capitalised name
    expect(names("Our stack: Snowflake and Gringotts tools.")).toContain("Gringotts");
  });

  it("marks a term found when the resume has it as a whole word, ignoring case, and missing otherwise", () => {
    const got = postingTerms("Tools: Tableau, SQL, Python3, C++.", resume("Built dashboards in tableau", "Wrote sql daily", "Knows Python", "Used C++ and Rust"), { company: "X" });
    const by = Object.fromEntries(got.map((t) => [t.term, t.found]));
    expect(by.Tableau).toBe(true);
    expect(by.SQL).toBe(true);
    expect(by["C++"]).toBe(true);
    expect(by.Python3).toBe(false);
  });

  it("doesn't count a term inside a longer word", () => {
    const by = Object.fromEntries(postingTerms("We use SQL and Java.", resume("MySQL and JavaScript experience")).map((t) => [t.term, t.found]));
    expect(by.SQL).toBe(false);
    expect(by.Java).toBe(false);
  });

  it("reads the resume's headings and labels too", () => {
    const sections: DocSection[] = [{ id: "s", heading: "Tableau", items: [{ id: "i", text: "x", kind: "skill", label: "SQL" }] }];
    const by = Object.fromEntries(postingTerms("We need Tableau and SQL.", sections).map((t) => [t.term, t.found]));
    expect(by).toMatchObject({ Tableau: true, SQL: true });
  });

  it("caps at 20 by default and at max when given, most mentioned first", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Tool${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}x`).join(", ");
    const posting = `We use ${many}. Daily we use Tableau and Tableau and Tableau.`;
    expect(postingTerms(posting, [])).toHaveLength(20);
    expect(names(posting, [], { max: 3 })).toHaveLength(3);
    expect(names(posting, [], { max: 3 })[0]).toBe("Tableau");
    expect(names(posting, [], { max: 0 })).toEqual([]);
  });

  it("lists a term once, whatever its case", () => {
    const got = names("We use SQL. Then sql again? Experience with SQL, SQL.");
    expect(got.filter((t) => t.toLowerCase() === "sql")).toHaveLength(1);
  });

  it("gives nothing for an empty or word-only posting", () => {
    expect(postingTerms("", resume("a"))).toEqual([]);
    expect(postingTerms("   \n ", [])).toEqual([]);
    expect(names("We are looking for a great person to join our team and do good work.")).toEqual([]);
  });

  it("leaves out calendar words, places in the stop list, and vague 'experience in' phrases", () => {
    const got = names("Start in January or Monday. Experience in a fast-paced environment. Based in Toronto.");
    expect(got).toEqual([]);
  });

  it("is stable: the same input gives the same list", () => {
    expect(postingTerms(POSTING, resume("SQL"), { company: "Gringotts" })).toEqual(postingTerms(POSTING, resume("SQL"), { company: "Gringotts" }));
  });
});

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
    expect(shape("a line that is lowercase\nanother one\nSKILLS\nwrites SQL daily")).toEqual([
      ["Summary", ["a line that is lowercase", "another one"]],
      ["SKILLS", ["writes SQL daily"]],
    ]);
    expect(shape("SKILLS\nwrites SQL daily").map((s) => s[0])).toEqual(["SKILLS"]);
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

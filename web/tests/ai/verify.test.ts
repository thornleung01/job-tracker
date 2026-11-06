// The reply checks: shape, the sections the editor gets, and the comparison with the person's own text.
import { describe, expect, it } from "vitest";
import { AiError } from "../../src/ai";
import { buildSections, checkAgainstSource, parseConvertReply, type ConvertReply } from "../../src/ai/verify";
import { HEADER_HEADING } from "../../src/db/documentShape";
import { MAX_DOC_ITEMS } from "../../src/db/limits";
import type { DocSection } from "../../src/db/schema";

const item = (kind: string, text: string, label = "", right = "") => ({ kind, text, label, right });
const reply = (items: ReturnType<typeof item>[], header = { name: "Jordan Lee", contact: ["jordan@example.com"] }) => ({
  header, sections: [{ heading: "Work experience", items }],
});
const ids = (sections: DocSection[]) => sections.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]);

describe("parseConvertReply", () => {
  it("accepts a good reply and ignores extra properties", () => {
    const parsed = parseConvertReply({ ...reply([item("org", "Northwind", "", "Toronto")]), extra: 1 });
    expect(parsed.header).toEqual({ name: "Jordan Lee", contact: ["jordan@example.com"] });
    expect(parsed.sections[0].items[0]).toEqual({ kind: "org", text: "Northwind", label: "", right: "Toronto" });
  });

  it("fills missing strings with empty ones", () => {
    const parsed = parseConvertReply({ header: { name: "A B" }, sections: [{ heading: "Education", items: [{ kind: "school", text: "Lakeside" }] }] });
    expect(parsed.header.contact).toEqual([]);
    expect(parsed.sections[0].items[0]).toEqual({ kind: "school", text: "Lakeside", label: "", right: "" });
  });

  it("turns an unknown or missing kind into a plain line, so one odd line doesn't lose the resume", () => {
    const parsed = parseConvertReply(reply([item("heading", "Odd"), { text: "No kind" } as never, item("bullet", "Fine")]));
    expect(parsed.sections[0].items.map((i) => i.kind)).toEqual(["line", "line", "bullet"]);
  });

  it.each([
    ["not an object", "text"],
    ["an array", []],
    ["null", null],
    ["sections not an array", { header: { name: "A", contact: [] }, sections: {} }],
    ["no sections", { header: { name: "A", contact: [] } }],
    ["a section that isn't an object", { header: { name: "A", contact: [] }, sections: ["x"] }],
    ["items not an array", { header: { name: "A", contact: [] }, sections: [{ heading: "x", items: "y" }] }],
    ["an item that isn't an object", { header: { name: "A", contact: [] }, sections: [{ heading: "x", items: ["y"] }] }],
    ["text that isn't a string", { header: { name: "A", contact: [] }, sections: [{ heading: "x", items: [{ kind: "line", text: 5 }] }] }],
    ["a header that isn't an object", { header: "A", sections: [] }],
    ["contact that isn't an array", { header: { name: "A", contact: "x" }, sections: [] }],
    ["nothing at all", { header: { name: "", contact: [] }, sections: [] }],
  ])("rejects %s as badReply", (_name, json) => {
    expect(() => parseConvertReply(json)).toThrow(AiError);
    try {
      parseConvertReply(json);
    } catch (e) {
      expect((e as AiError).code).toBe("badReply");
    }
  });
});

describe("buildSections", () => {
  const parsed: ConvertReply = parseConvertReply({
    header: { name: "Jordan Lee", contact: ["Toronto | jordan@example.com", "416 555 0100"] },
    sections: [
      { heading: "Work experience", items: [
        item("org", "Northwind", "", "Toronto, ON"), item("title", "Analyst", "", "2020 - 2022"),
        item("bullet", "Cut costs", "Savings"), item("skill", "SQL, Python", "Tools"), item("line", "Plain"),
        item("line", "dropped label", "ignored", "ignored"), item("bullet", "x", "", "right is dropped on a bullet"),
      ] },
    ],
  });

  it("makes a Header section: the name first, then the contact lines as plain lines", () => {
    const [header] = buildSections(parsed);
    expect(header.heading).toBe(HEADER_HEADING);
    expect(header.items.map((i) => i.text)).toEqual(["Jordan Lee", "Toronto | jordan@example.com", "416 555 0100"]);
    expect(header.items.every((i) => i.kind === undefined)).toBe(true);
  });

  it("keeps kind, label and right, and a line has no kind", () => {
    const [, work] = buildSections(parsed);
    expect(work.items.slice(0, 5)).toMatchObject([
      { kind: "org", text: "Northwind", right: "Toronto, ON" },
      { kind: "title", text: "Analyst", right: "2020 - 2022" },
      { kind: "bullet", text: "Cut costs", label: "Savings" },
      { kind: "skill", text: "SQL, Python", label: "Tools" },
      { text: "Plain" },
    ]);
    expect(work.items[4]).not.toHaveProperty("kind");
    expect(work.items[4]).not.toHaveProperty("label");
    expect(work.items[5]).toEqual({ id: expect.any(String), text: "dropped label" });
    expect(work.items[6]).not.toHaveProperty("right");
  });

  it("has no Header section without a name", () => {
    const sections = buildSections(parseConvertReply(reply([item("line", "Only a line")], { name: "", contact: [] })));
    expect(sections.map((s) => s.heading)).toEqual(["Work experience"]);
  });

  it("never keeps the model's ids and every id is unique", () => {
    const withIds = {
      header: { name: "A B", contact: [], id: "evil" },
      sections: [{ id: "sec", heading: "x", items: [{ id: "same", kind: "line", text: "1", label: "", right: "" }, { id: "same", kind: "line", text: "2", label: "", right: "" }] }],
    };
    const sections = buildSections(parseConvertReply(withIds));
    const all = ids(sections);
    expect(all).not.toContain("same");
    expect(all).not.toContain("sec");
    expect(new Set(all).size).toBe(all.length);
  });

  it("caps through normalizeSections", () => {
    const many = Array.from({ length: MAX_DOC_ITEMS + 20 }, (_, i) => item("line", `line ${i}`));
    const sections = buildSections(parseConvertReply(reply(many)));
    expect(sections[1].items).toHaveLength(MAX_DOC_ITEMS);
  });

  it("drops empty lines and sections", () => {
    const sections = buildSections(parseConvertReply({
      header: { name: "A B", contact: ["", "  "] },
      sections: [{ heading: "", items: [item("line", "")] }, { heading: "Kept", items: [item("line", " x ")] }],
    }));
    expect(sections.map((s) => s.heading)).toEqual([HEADER_HEADING, "Kept"]);
    expect(sections[1].items[0].text).toBe("x");
  });
});

const SOURCE = [
  "Jordan Lee",
  "Worked at Northwind Traders in Toronto from Aug 2024 to the present.",
  "Cut stock-outs by 12% and saved $1,200 per store. Led a team of 8.",
  "Planning: Own the seasonal plan across 70 stores.",
].join("\n");

function check(items: ReturnType<typeof item>[], source = SOURCE) {
  const sections = buildSections(parseConvertReply(reply(items, { name: "", contact: [] })));
  return { sections, ...checkAgainstSource(source, sections) };
}

describe("checkAgainstSource: details", () => {
  it("flags an invented number", () => {
    const r = check([item("bullet", "Cut stock-outs by 40% across 70 stores")]);
    expect(r.flags).toEqual([{ itemId: r.sections[0].items[0].id, kind: "detail", note: "Not in your file: 40" }]);
  });

  it("flags a changed year and a made-up company", () => {
    const r = check([item("org", "Contoso Retail", "", "Toronto"), item("title", "Planning", "", "Aug 2023 - Present")]);
    expect(r.flags.map((f) => f.note)).toEqual(["Not in your file: Contoso, Retail", "Not in your file: 2023"]);
    expect(r.flags.map((f) => f.itemId)).toEqual(r.sections[0].items.map((i) => i.id));
  });

  it("does not flag the same details with different case, punctuation, dashes or quotes", () => {
    const r = check([
      item("bullet", "CUT STOCK–OUTS by 12 % and saved $1200 per store"),
      item("org", "NORTHWIND  TRADERS", "", "toronto"),
      item("title", "PLANNING", "", "AUG 2024 – Present"),
    ]);
    expect(r.flags).toEqual([]);
  });

  it("matches numbers with and without commas and with a currency or percent sign", () => {
    expect(check([item("bullet", "Saved 1,200 dollars and 12 percent")]).flags).toEqual([]);
    expect(check([item("bullet", "Saved $12,000")]).flags).toHaveLength(1);
  });

  it("does not flag a capitalised word that only starts a sentence, but does flag one inside it", () => {
    expect(check([item("line", "Managed a team of 8. Delivered results.")]).flags).toEqual([]);
    expect(check([item("line", "Managed a team of 8 at Initech.")]).flags).toHaveLength(1);
  });

  it("checks the first word of a company, a school and a skill category", () => {
    const r = check([item("org", "Initech"), item("school", "Zeta College"), item("skill", "SQL", "Analytics")]);
    expect(r.flags.map((f) => f.note)).toEqual(["Not in your file: Initech", "Not in your file: Zeta, College", "Not in your file: SQL, Analytics"]);
  });

  it("joins words that a line break split in the source", () => {
    const source = "Led market-\ning work at Northwind";
    expect(check([item("line", "Led marketing work at Northwind")], source).flags).toEqual([]);
  });

  it("works with accented letters", () => {
    const source = "Directrice des opérations chez Café Müller à Montréal depuis 2019";
    expect(check([item("line", "Directrice des opérations chez Café Müller à Montréal depuis 2019")], source).flags).toEqual([]);
    expect(check([item("line", "Directrice chez CAFE MULLER à MONTREAL")], source).flags).toEqual([]);
    expect(check([item("line", "Directrice chez Café Dupont à Montréal")], source).flags).toHaveLength(1);
    expect(check([item("line", "Directrice chez Éclair à Montréal")], source).flags).toHaveLength(1);
  });

  it("lists at most 3 details in the note", () => {
    const r = check([item("org", "Alpha Beta Gamma Delta")]);
    expect(r.flags[0].note).toBe("Not in your file: Alpha, Beta, Gamma");
  });
});

describe("checkAgainstSource: labels", () => {
  it("flags a bullet label the model made up", () => {
    const r = check([item("bullet", "Own the seasonal plan across 70 stores", "Leadership")]);
    expect(r.flags).toEqual([{ itemId: r.sections[0].items[0].id, kind: "label", note: "Label added by AI" }]);
  });

  it("does not flag a label taken from the bullet's own words, or the person's own label", () => {
    expect(check([item("bullet", "Own the seasonal plan across 70 stores", "Seasonal plan")]).flags).toEqual([]);
    expect(check([item("bullet", "Own the seasonal plan across 70 stores", "Planning")]).flags).toEqual([]);
    expect(check([item("bullet", "Own the seasonal plan across 70 stores", "planning and the plan")]).flags).toEqual([]);
  });

  it("flags a made-up label and a detail on the same line separately", () => {
    const r = check([item("bullet", "Cut stock-outs by 99%", "Leadership")]);
    expect(r.flags.map((f) => f.kind)).toEqual(["detail", "label"]);
  });
});

describe("checkAgainstSource: unused words", () => {
  it("lists source words that appear nowhere in the result", () => {
    const source = "Jordan Lee\nManaged vendors and negotiated contracts with suppliers";
    const sections = buildSections(parseConvertReply(reply([item("line", "Managed vendors")], { name: "Jordan Lee", contact: [] })));
    expect(checkAgainstSource(source, sections).unused).toEqual(["negotiated", "contracts", "suppliers"]);
  });

  it("ignores stopwords, short words, page numbers and single characters", () => {
    const source = ["Page 2 of 3", "2", "with this that from", "a b c ok", "• ● x", "Kept words", "Page 3"].join("\n");
    const sections = buildSections(parseConvertReply(reply([item("line", "Nothing")], { name: "", contact: [] })));
    expect(checkAgainstSource(source, sections).unused).toEqual(["kept", "words"]);
  });

  it("is case-insensitive, lists a word once, and counts the heading, labels and right-hand text as present", () => {
    const source = "TORONTO toronto Toronto Analyst Planning Kingston Consulting";
    const sections = buildSections(parseConvertReply(reply([item("org", "X", "", "toronto"), item("bullet", "b", "ANALYST"), item("title", "t", "", "Kingston")], { name: "", contact: [] })));
    expect(checkAgainstSource(source, sections).unused).toEqual(["planning", "consulting"]);
  });

  it("caps the list at 40 distinct words", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}x`);
    const sections = buildSections(parseConvertReply(reply([item("line", "Nothing")], { name: "", contact: [] })));
    const unused = checkAgainstSource(words.join(" ") + " " + words.join(" "), sections).unused;
    expect(unused).toHaveLength(40);
    expect(new Set(unused).size).toBe(40);
  });

  it("works with accented words", () => {
    const sections = buildSections(parseConvertReply(reply([item("line", "Directrice des opérations")], { name: "", contact: [] })));
    const unused = checkAgainstSource("Directrice des OPÉRATIONS et gestion équipe", sections).unused;
    expect(unused).toEqual(["gestion", "équipe"]);
  });
});

// What the reply checks can't catch (pinned on purpose, so a change is a decision), text quirks, and a hostile reply.
import { describe, expect, it } from "vitest";
import { buildSections, checkAgainstSource, parseConvertReply } from "../../src/ai/verify";
import { HEADER_HEADING } from "../../src/db/documentShape";
import { MAX_DOC_ITEMS } from "../../src/db/limits";

const item = (kind: string, text: string, label = "", right = "") => ({ kind, text, label, right });
const reply = (items: ReturnType<typeof item>[], header = { name: "", contact: [] as string[] }) => ({
  header, sections: [{ heading: "Work experience", items }],
});
function check(items: ReturnType<typeof item>[], source: string) {
  const sections = buildSections(parseConvertReply(reply(items)));
  return { sections, ...checkAgainstSource(source, sections) };
}

describe("known limits: what is not caught", () => {
  const source = "Led a team of 8 at Northwind. Cut stock-outs by 12% and returns by 5%. Used Excel.";

  it("misses an invented tool written in lower case", () => {
    expect(check([item("bullet", "Used Excel and kubernetes")], source).flags).toEqual([]);
  });

  it("misses a number that appears elsewhere in the source (it isn't tied to its line)", () => {
    expect(check([item("bullet", "Led a team of 12 at Northwind")], source).flags).toEqual([]);
  });

  it("misses swapped percentages", () => {
    expect(check([item("bullet", "Cut stock-outs by 5% and returns by 12%")], source).flags).toEqual([]);
  });

  it("misses an invented name that begins a sentence in a bullet", () => {
    expect(check([item("bullet", "Initech grew. Used Excel")], source).flags).toEqual([]);
  });

  it("skips a name after an abbreviation's period", () => {
    expect(check([item("bullet", "Served in the U.S. Zebra")], "Served in the U.S. army").flags).toEqual([]);
  });
});

describe("known false alarms", () => {
  it("flags August when the file says Aug", () => {
    const r = check([item("title", "Analyst", "", "August 2024")], "Analyst\nAug 2024");
    expect(r.flags.map((f) => f.note)).toEqual(["Not in your file: August"]);
  });

  it("flags Ontario when the file says ON", () => {
    const r = check([item("org", "Northwind", "", "Toronto, Ontario")], "Northwind Toronto, ON");
    expect(r.flags.map((f) => f.note)).toEqual(["Not in your file: Ontario"]);
  });

  it("lists a word that a line-end hyphen joined wrongly, as unused", () => {
    const r = check([item("bullet", "Led a well-known project")], "Led a well-\nknown project");
    expect(r.unused).toEqual(["wellknown"]);
  });
});

describe("text quirks", () => {
  it("treats curly and straight apostrophes alike", () => {
    expect(check([item("bullet", "Led Maria's team")], "Led Maria’s team").flags).toEqual([]);
    expect(check([item("bullet", "Led Maria’s team")], "Led Maria's team").flags).toEqual([]);
  });

  it("reads a source with Windows line ends, including a page number and a split word", () => {
    const source = "Led market-\r\ning work at Northwind\r\nPage 2 of 3\r\nPlanning";
    const r = check([item("bullet", "Led marketing work at Northwind"), item("line", "Planning")], source);
    expect(r.flags).toEqual([]);
    expect(r.unused).toEqual([]);
  });

  it("matches ligatures and decomposed accents in the source", () => {
    expect(check([item("bullet", "Led Financial reporting at Cafe")], "Led ﬁnancial reporting at Café").flags).toEqual([]);
    expect(check([item("bullet", "Led Financial reporting at Café")], "Led financial reporting at Café").flags).toEqual([]);
  });
});

describe("parseConvertReply: details", () => {
  const section = { heading: "Education", items: [item("line", "x")] };

  it("drops contact entries that aren't strings and empty ones", () => {
    const parsed = parseConvertReply({ header: { name: "A B", contact: ["a@b.c", 5, null, { x: 1 }, "  ", " 416 "] }, sections: [section] });
    expect(parsed.header.contact).toEqual(["a@b.c", "416"]);
  });

  it("keeps a reply with only a name, and builds a Header section of one line", () => {
    const parsed = parseConvertReply({ header: { name: " Jordan Lee " }, sections: [] });
    expect(parsed.header).toEqual({ name: "Jordan Lee", contact: [] });
    expect(buildSections(parsed).map((s) => [s.heading, s.items.map((i) => i.text)])).toEqual([[HEADER_HEADING, ["Jordan Lee"]]]);
  });

  it("builds no Header for a whitespace-only name, and the contact words then show up as unused", () => {
    const parsed = parseConvertReply({ header: { name: "   ", contact: ["jordanlee@example.com"] }, sections: [section] });
    const sections = buildSections(parsed);
    expect(sections.map((s) => s.heading)).toEqual(["Education"]);
    expect(checkAgainstSource("jordanlee@example.com\nx", sections).unused).toEqual(["jordanlee", "example"]);
  });

  it("keeps two sections with the same heading as they come", () => {
    const sections = buildSections(parseConvertReply({ header: { name: "A B", contact: [] }, sections: [
      { heading: "Projects", items: [item("line", "one")] }, { heading: "Projects", items: [item("line", "two")] },
    ] }));
    expect(sections.map((s) => s.heading)).toEqual([HEADER_HEADING, "Projects", "Projects"]);
    expect(new Set(sections.map((s) => s.id)).size).toBe(3);
  });

  it("keeps a section the model headed Header next to the real one, each with its own ids", () => {
    const sections = buildSections(parseConvertReply({ header: { name: "A B", contact: [] }, sections: [{ heading: HEADER_HEADING, items: [item("line", "extra")] }] }));
    expect(sections.map((s) => s.heading)).toEqual([HEADER_HEADING, HEADER_HEADING]);
    expect(sections[0].items.map((i) => i.text)).toEqual(["A B"]);
    expect(sections[1].items.map((i) => i.text)).toEqual(["extra"]);
  });
});

describe("a hostile reply", () => {
  it("ignores a __proto__ key and doesn't pollute anything", () => {
    const json: unknown = JSON.parse('{"__proto__":{"polluted":true},"header":{"name":"A B","contact":[],"__proto__":{"polluted":true}},"sections":[{"heading":"x","items":[{"kind":"line","text":"t","__proto__":{"polluted":true}}]}]}');
    const sections = buildSections(parseConvertReply(json));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((sections[0] as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(sections.map((s) => s.heading)).toEqual([HEADER_HEADING, "x"]);
  });

  it("caps 10,000 items and 10,000 sections", () => {
    const items = Array.from({ length: 10_000 }, (_, i) => item("line", `line ${i}`));
    const sections = buildSections(parseConvertReply(reply(items)));
    expect(sections[0].items).toHaveLength(MAX_DOC_ITEMS);
    const many = parseConvertReply({ header: { name: "A B", contact: [] }, sections: Array.from({ length: 10_000 }, (_, i) => ({ heading: `h${i}`, items: [item("line", "x")] })) });
    expect(buildSections(many).length).toBeLessThan(10_000);
  });

  it("ignores deeply nested extra objects", () => {
    const depth = 3000;
    const nested = "{\"a\":".repeat(depth) + "1" + "}".repeat(depth);
    const json: unknown = JSON.parse(`{"extra":${nested},"header":{"name":"A B","contact":[]},"sections":[]}`);
    expect(buildSections(parseConvertReply(json)).map((s) => s.heading)).toEqual([HEADER_HEADING]);
  });

  it("keeps HTML and script text as plain text, unchanged", () => {
    const html = '<img src=x onerror="alert(1)"><script>alert(2)</script> &amp; <b>bold</b>';
    const sections = buildSections(parseConvertReply(reply([item("line", html)])));
    expect(sections[0].items[0].text).toBe(html);
  });

  it("keeps control characters as plain text without throwing", () => {
    const text = "a\u0000b\u0007c‮d";
    const sections = buildSections(parseConvertReply(reply([item("line", text)])));
    expect(sections[0].items[0].text).toBe(text);
    expect(() => checkAgainstSource("a b c d", sections)).not.toThrow();
  });
});

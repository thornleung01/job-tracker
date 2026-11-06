// A resume line can say what it is (a job, a title, a bullet, a skill, a school) with an optional bold label and right-hand text.
// These fields are additive: lines without them stay plain, and old data is unchanged.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { itemText, normalizeSections, sectionsToText } from "../../src/db/documentShape";
import { MAX_DOC_ITEM_CHARS, MAX_DOC_ITEMS, MAX_DOC_LABEL_CHARS, MAX_DOC_RIGHT_CHARS, MAX_DOC_SECTIONS } from "../../src/db/limits";
import { DOC_ITEM_KINDS, isDocItemKind } from "../../src/db/schema";
import { exportAll, importAll } from "../../src/portability";
import { saveMaster } from "../../src/sync/documents";
import { closeAll, freshDb } from "../sync/helpers";

afterEach(closeAll);

const one = (item: Record<string, unknown>) => normalizeSections([{ heading: "Experience", items: [item] }])[0]?.items[0];

describe("normalizeSections with kinds, labels and right-hand text", () => {
  it("keeps a known kind, a label and a right-hand value, and gives the line an id", () => {
    const item = one({ text: "Northwind Traders", kind: "org", right: "Toronto, ON" })!;
    expect(item).toMatchObject({ text: "Northwind Traders", kind: "org", right: "Toronto, ON" });
    expect(item.id).toBeTruthy();
    expect(one({ text: "Built a model.", kind: "bullet", label: "Reporting" })).toMatchObject({ kind: "bullet", label: "Reporting", text: "Built a model." });
  });

  it("accepts every kind in the list and nothing else", () => {
    for (const kind of DOC_ITEM_KINDS) expect(one({ text: "x", kind })!.kind).toBe(kind);
    for (const kind of ["heading", "BULLET", "", 3, null, {}]) expect("kind" in one({ text: "x", kind })!).toBe(false);
    expect(isDocItemKind("org")).toBe(true);
    expect(isDocItemKind("nope")).toBe(false);
  });

  it("leaves a plain line without the new fields, so old data is unchanged", () => {
    expect(Object.keys(one({ id: "a", text: "Plain line" })!).sort()).toEqual(["id", "text"]);
  });

  it("trims and cuts each field to its own limit", () => {
    const bullet = one({ text: "y".repeat(MAX_DOC_ITEM_CHARS + 10), label: `  ${"l".repeat(MAX_DOC_LABEL_CHARS + 10)} `, kind: "bullet" })!;
    expect(bullet.text).toHaveLength(MAX_DOC_ITEM_CHARS);
    expect(bullet.label).toHaveLength(MAX_DOC_LABEL_CHARS);
    expect(one({ text: "x", right: "r".repeat(MAX_DOC_RIGHT_CHARS + 10), kind: "org" })!.right).toHaveLength(MAX_DOC_RIGHT_CHARS);
  });

  it("drops a label unless the line is a bullet or skill, and a right-hand value unless it is an org, school or title", () => {
    // so every path agrees with the editor: a hidden field never rides along into the text export
    const plain = one({ text: "x", label: "L", right: "R" })!;
    expect(Object.keys(plain).sort()).toEqual(["id", "text"]);
    expect(one({ text: "Acme", kind: "org", label: "L", right: "Toronto" })).toMatchObject({ kind: "org", right: "Toronto" });
    expect("label" in one({ text: "Acme", kind: "org", label: "L", right: "Toronto" })!).toBe(false);
    expect(one({ text: "Body", kind: "bullet", label: "L", right: "R" })).toMatchObject({ kind: "bullet", label: "L" });
    expect("right" in one({ text: "Body", kind: "bullet", label: "L", right: "R" })!).toBe(false);
    expect("right" in one({ text: "SQL", kind: "skill", label: "Tools", right: "R" })!).toBe(false);
    expect(one({ text: "Analyst", kind: "title", label: "L", right: "2024" })).not.toHaveProperty("label");
    expect(one({ text: "U of T", kind: "school", label: "L", right: "Toronto" })).not.toHaveProperty("label");
  });

  it("drops a line left with nothing once the hidden fields are gone", () => {
    expect(one({ text: "", label: "Only a label", kind: "org" })).toBeUndefined();
    expect(one({ text: "", right: "Only a place", kind: "bullet" })).toBeUndefined();
    expect(one({ text: "", label: "L", right: "R" })).toBeUndefined();
  });

  it("leaves a whitespace-only label or right-hand value out, not as an empty string", () => {
    const bullet = one({ text: "x", kind: "bullet", label: "   " })!;
    expect("label" in bullet).toBe(false);
    const org = one({ text: "x", kind: "org", right: " \n " })!;
    expect("right" in org).toBe(false);
  });

  it("keeps at most MAX_DOC_ITEMS kinded lines per section and MAX_DOC_SECTIONS sections", () => {
    const items = Array.from({ length: MAX_DOC_ITEMS + 5 }, (_, n) => ({ text: `Line ${n}`, kind: "bullet", label: "L" }));
    expect(normalizeSections([{ heading: "Experience", items }])[0].items).toHaveLength(MAX_DOC_ITEMS);
    const many = Array.from({ length: MAX_DOC_SECTIONS + 5 }, (_, n) => ({ heading: `S${n}`, items: [{ text: "x", kind: "org", right: "R" }] }));
    expect(normalizeSections(many)).toHaveLength(MAX_DOC_SECTIONS);
  });

  it("re-issues a repeated id on kinded lines, keeping each line's own fields", () => {
    const [section] = normalizeSections([{ heading: "Experience", items: [
      { id: "same", text: "Acme", kind: "org", right: "Toronto" },
      { id: "same", text: "Did it", kind: "bullet", label: "Impact" },
    ] }]);
    expect(section.items[0]).toMatchObject({ id: "same", kind: "org", right: "Toronto" });
    expect(section.items[1].id).not.toBe("same");
    expect(section.items[1]).toMatchObject({ kind: "bullet", label: "Impact" });
  });

  it("drops a line only when text, label and right are all empty", () => {
    expect(one({ text: "  ", label: " ", right: "" })).toBeUndefined();
    expect(one({ text: "", right: "Toronto, ON", kind: "org" })).toMatchObject({ right: "Toronto, ON" });
    expect(one({ text: "", label: "Reporting", kind: "bullet" })).toMatchObject({ label: "Reporting" });
  });

  it("ignores fields of the wrong type", () => {
    expect(Object.keys(one({ text: "ok", label: 5, right: { a: 1 }, kind: ["org"] })!).sort()).toEqual(["id", "text"]);
  });
});

describe("itemText and sectionsToText", () => {
  const sections = normalizeSections([
    { heading: "Experience", items: [
      { text: "Northwind Traders", kind: "org", right: "Toronto, ON" },
      { text: "Senior Analyst, Planning", kind: "title", right: "Aug 2024 – Present" },
      { text: "Owned the seasonal plan.", kind: "bullet", label: "Planning" },
    ] },
    { heading: "Skills", items: [{ text: "SQL, Python", kind: "skill", label: "Programming" }, { text: "A plain line" }] },
  ]);

  it("prints a job with its location, a title with its dates, a bullet and a skill with their label", () => {
    expect(itemText(sections[0].items[0])).toBe("Northwind Traders, Toronto, ON");
    expect(itemText(sections[0].items[1])).toBe("Senior Analyst, Planning Aug 2024 – Present");
    expect(itemText(sections[0].items[2])).toBe("Planning: Owned the seasonal plan.");
    expect(itemText(sections[1].items[0])).toBe("Programming: SQL, Python");
    expect(itemText(sections[1].items[1])).toBe("A plain line");
  });

  it("keeps all of it in the whole document's text, which search and Download as text use", () => {
    expect(sectionsToText(sections)).toBe(
      "Experience\nNorthwind Traders, Toronto, ON\nSenior Analyst, Planning Aug 2024 – Present\nPlanning: Owned the seasonal plan.\n\nSkills\nProgramming: SQL, Python\nA plain line",
    );
  });

  it("prints a title with a label, and a title with its dates but no text", () => {
    expect(itemText({ id: "a", text: "Analyst", kind: "title", label: "Lead", right: "2024" })).toBe("Lead: Analyst 2024");
    expect(itemText({ id: "a", text: "", kind: "title", right: "2024 – Present" })).toBe("2024 – Present");
  });

  it("handles a line that is only a label or only a right-hand value", () => {
    expect(itemText({ id: "a", text: "", kind: "bullet", label: "Reporting" })).toBe("Reporting");
    expect(itemText({ id: "a", text: "", kind: "org", right: "Toronto, ON" })).toBe("Toronto, ON");
  });
});

describe("through the database and an export", () => {
  const sections = [
    { id: "h", heading: "Header", items: [{ id: "n", text: "JORDAN LEE" }, { id: "c", text: "Toronto | jordan@example.com" }] },
    { id: "e", heading: "Experience", items: [
      { id: "o", text: "Northwind Traders", kind: "org", right: "Toronto, ON" },
      { id: "t", text: "Senior Analyst", kind: "title", right: "Aug 2024 – Present" },
      { id: "b", text: "Owned the plan.", kind: "bullet", label: "Planning" },
    ] },
  ];

  it("saves, exports and imports every field, and an old master without them still loads", async () => {
    const from = freshDb();
    await saveMaster(from, sections, "paste");
    const to = freshDb();
    await importAll(to, JSON.parse(JSON.stringify(await exportAll(from))));
    expect((await to.documents.toArray())[0].sections).toEqual(sections);

    const plain = freshDb();
    await saveMaster(plain, [{ id: "s", heading: "Skills", items: [{ id: "i", text: "SQL" }] }], "paste");
    expect((await plain.documents.toArray())[0].sections[0].items[0]).toEqual({ id: "i", text: "SQL" });
  });

  it("still imports a real old-format export, plain lines and all", async () => {
    // an export from before resume lines had kinds: version 3, items with only an id and text
    const old = {
      format: "jobtracker-export", version: 3, exportedAt: "2026-10-01T00:00:00Z", source: "web",
      data: { documents: [{
        id: 1, kind: "resume", master: true, applicationId: null, title: "Master resume", source: "paste",
        createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
        sections: [
          { id: "s1", heading: "Experience", items: [{ id: "i1", text: "Built a reporting model." }, { id: "i2", text: "Cut close time by 2 days." }] },
          { id: "s2", heading: "Skills", items: [{ id: "i3", text: "SQL, Python" }] },
        ],
      }] },
    };
    const to = freshDb();
    await importAll(to, old);
    const doc = (await to.documents.get(1))!;
    expect(doc.sections).toEqual(old.data.documents[0].sections);
    expect(sectionsToText(doc.sections)).toBe("Experience\nBuilt a reporting model.\nCut close time by 2 days.\n\nSkills\nSQL, Python");
  });

  it("drops a bad kind and cuts over-long fields when a file is imported", async () => {
    const to = freshDb();
    const file = {
      format: "jobtracker-export", version: 3, exportedAt: "2026-11-01T00:00:00Z", source: "web",
      data: { documents: [{
        id: 1, kind: "resume", master: true, applicationId: null, title: "Master resume", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
        sections: [{ id: "s", heading: "Experience", items: [
          { id: "a", text: "x", kind: "hacker", label: "l", right: "r" },
          { id: "b", text: "y", kind: "bullet", label: "l".repeat(500) },
          { id: "c", text: "z", kind: "org", right: "r".repeat(500) },
        ] }],
      }] },
    };
    await importAll(to, file);
    const [bad, bullet, org] = (await to.documents.get(1))!.sections[0].items;
    expect(bad).toEqual({ id: "a", text: "x" });
    expect(bullet.label).toHaveLength(MAX_DOC_LABEL_CHARS);
    expect(org.right).toHaveLength(MAX_DOC_RIGHT_CHARS);
  });
});

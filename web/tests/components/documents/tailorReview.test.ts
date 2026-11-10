// The logic of the tailor review: which lines start ticked, which words are marked, and the resume that is composed from the ticks.
import { describe, expect, it } from "vitest";
import type { DocSection } from "../../../src/db/schema";
import { composeResume, initialTicks, lineText, resumeLabel } from "../../../src/components/documents/tailorReview";
import type { TailorLine } from "../../../src/sync/tailor";

const master: DocSection[] = [
  { id: "ms", heading: "Summary", items: [{ id: "m-sum", text: "Analyst who likes data." }] },
  { id: "me", heading: "Experience", items: [
    { id: "m-org", text: "Acme", kind: "org" },
    { id: "m-b1", text: "Built dashboards", kind: "bullet" },
    { id: "m-b2", text: "Cut reporting time", kind: "bullet" },
  ] },
  { id: "mk", heading: "Skills", items: [{ id: "m-sk", text: "SQL", kind: "skill", label: "Tools" }] },
];
const draft = {
  resume: [
    { id: "ds", heading: "Summary", items: [{ id: "d-sum", text: "Data analyst." }] },
    { id: "de", heading: "Experience", items: [
      { id: "m-org", text: "Acme", kind: "org" },
      { id: "d-b1", text: "Built sales dashboards", kind: "bullet" },
      { id: "d-b2", text: "Cut reporting time by 40%", kind: "bullet" },
    ] },
    { id: "dk", heading: "Skills", items: [{ id: "d-sk", text: "SQL, Python", kind: "skill", label: "Tools" }] },
  ] as DocSection[],
  lines: [
    { id: "d-sum", sourceId: "m-sum", changed: true, flags: [] },
    { id: "d-b1", sourceId: "m-b1", changed: true, flags: [] },
    { id: "d-b2", sourceId: "m-b2", changed: true, flags: ["40% isn't in your master."] },
    { id: "d-sk", sourceId: "m-sk", changed: true, flags: [] },
  ] as TailorLine[],
};
const itemTexts = (s: DocSection[]) => s.flatMap((x) => x.items.map((i) => i.text));

describe("initialTicks", () => {
  it("ticks every line except the flagged ones", () => {
    expect(initialTicks(draft.lines)).toEqual({ "d-sum": true, "d-b1": true, "d-b2": false, "d-sk": true });
  });
});

describe("composeResume with a multi-line summary", () => {
  const twoLines: DocSection[] = [{ id: "ms", heading: "Summary", items: [{ id: "m1", text: "First line." }, { id: "m2", text: "Second line." }] }];
  const one = {
    resume: [{ id: "ds", heading: "Summary", items: [{ id: "d1", text: "One new line." }] }] as DocSection[],
    lines: [{ id: "d1", sourceId: "m1", sourceIds: ["m1", "m2"], changed: true, flags: [] }] as TailorLine[],
  };

  it("puts back every original line when the summary is unticked, and keeps the new one when ticked", () => {
    expect(itemTexts(composeResume(one, twoLines, { d1: false }))).toEqual(["First line.", "Second line."]);
    expect(itemTexts(composeResume(one, twoLines, { d1: true }))).toEqual(["One new line."]);
  });
});

describe("composeResume", () => {
  it("keeps every new line when all are ticked", () => {
    const ticks = Object.fromEntries(draft.lines.map((l) => [l.id, true]));
    expect(itemTexts(composeResume(draft, master, ticks))).toEqual(itemTexts(draft.resume));
  });

  it("starts the flagged line on the master's line", () => {
    const out = composeResume(draft, master, initialTicks(draft.lines));
    expect(itemTexts(out)).toEqual(["Data analyst.", "Acme", "Built sales dashboards", "Cut reporting time", "SQL, Python"]);
  });

  it("falls back to the master's whole line, kind and label included, for an unticked one", () => {
    const out = composeResume(draft, master, { "d-sk": false });
    const skill = out[2].items[0];
    expect(skill).toMatchObject({ id: "m-sk", text: "SQL", kind: "skill", label: "Tools" });
  });

  it("uses the master's line for every line when all are unticked, in the draft's order", () => {
    const ticks = Object.fromEntries(draft.lines.map((l) => [l.id, false]));
    expect(itemTexts(composeResume(draft, master, ticks))).toEqual(["Analyst who likes data.", "Acme", "Built dashboards", "Cut reporting time", "SQL"]);
  });

  it("treats a line with no tick as ticked", () => {
    expect(itemTexts(composeResume(draft, master, {}))).toEqual(itemTexts(draft.resume));
  });

  it("keeps the new line when the master has no line to go back to", () => {
    const lost = { ...draft, lines: [...draft.lines.slice(0, 3), { id: "d-sk", sourceId: "gone", changed: true, flags: [] }] };
    expect(itemTexts(composeResume(lost, master, { "d-sk": false }))).toContain("SQL, Python");
  });

  it("never puts a master line in twice", () => {
    const twice = {
      resume: [{ id: "x", heading: "Experience", items: [{ id: "n1", text: "Dashboards one", kind: "bullet" as const }, { id: "n2", text: "Dashboards two", kind: "bullet" as const }] }],
      lines: [{ id: "n1", sourceId: "m-b1", changed: true, flags: [] }, { id: "n2", sourceId: "m-b1", changed: true, flags: [] }],
    };
    expect(itemTexts(composeResume(twice, master, { n1: true, n2: false }))).toEqual(["Dashboards one"]);
    expect(itemTexts(composeResume(twice, master, { n1: false, n2: false }))).toEqual(["Built dashboards"]);
  });

  it("does not change the draft or the master", () => {
    const before = JSON.stringify([draft, master]);
    composeResume(draft, master, { "d-b1": false });
    expect(JSON.stringify([draft, master])).toBe(before);
  });
});

describe("labels", () => {
  it("shows a label before the text", () => {
    expect(lineText({ label: "Tools", text: "SQL" })).toBe("Tools: SQL");
    expect(lineText({ text: "SQL" })).toBe("SQL");
  });

  it("says Tailored for an application's own resume, once", () => {
    expect(resumeLabel({ kind: "resume", master: false, applicationId: 3, title: "Resume for Acme" })).toBe("Resume for Acme (tailored)");
    expect(resumeLabel({ kind: "resume", master: false, applicationId: 3, title: "Resume for Acme (tailored)" })).toBe("Resume for Acme (tailored)");
    expect(resumeLabel({ kind: "resume", master: false, applicationId: null, title: "Analyst v2" })).toBe("Analyst v2");
    expect(resumeLabel({ kind: "resume", master: true, applicationId: null, title: "Master resume" })).toBe("Master resume");
  });
});

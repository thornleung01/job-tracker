// The steps' work in progress: the reducer's fill rules and the session-storage copy, which must survive bad data.
import { afterEach, describe, expect, it } from "vitest";
import { emptyFlow, flowKey, flowReducer, loadFlow, storeFlow } from "../../../src/pages/resume/flowState";

afterEach(() => sessionStorage.clear());

describe("flowReducer", () => {
  it("fills only blank or guessed fields from a read, and a typed field stops being a guess", () => {
    let s = flowReducer(emptyFlow(), { type: "posting", value: "x", found: { company: "Acme", role: "" } });
    expect(s).toMatchObject({ company: "Acme", role: "", guessed: { company: true, role: false } });
    s = flowReducer(s, { type: "field", name: "company", value: "Acme Corp" });
    expect(s.guessed.company).toBe(false);
    s = flowReducer(s, { type: "fill", company: "Other", role: "Analyst" });
    expect(s).toMatchObject({ company: "Acme Corp", role: "Analyst", guessed: { company: false, role: true } });
  });

  it("won't open Review or Add without a draft", () => {
    expect(flowReducer(emptyFlow(), { type: "go", step: "add" }).step).toBe("job");
  });
});

describe("the stored flow", () => {
  it("reads back what was stored, under jobtracker:resume-steps:<database name>", () => {
    storeFlow("db1", { ...emptyFlow(), posting: "A posting", company: "Acme" });
    expect(sessionStorage.getItem(flowKey("db1"))).not.toBeNull();
    expect(flowKey("db1")).toBe("jobtracker:resume-steps:db1");
    expect(loadFlow("db1")).toMatchObject({ posting: "A posting", company: "Acme", step: "job" });
    expect(loadFlow("db2")).toEqual(emptyFlow());
  });

  it("starts fresh from data it can't read, and leaves nothing for a finished or empty flow", () => {
    sessionStorage.setItem(flowKey("db1"), "{not json");
    expect(loadFlow("db1")).toEqual(emptyFlow());
    sessionStorage.setItem(flowKey("db1"), JSON.stringify({ step: "review", posting: 3, draft: "x" }));
    expect(loadFlow("db1")).toEqual(emptyFlow());
    storeFlow("db1", emptyFlow());
    expect(sessionStorage.getItem(flowKey("db1"))).toBeNull();
  });

  const section = { id: "s1", heading: "SUMMARY", items: [{ id: "i1", text: "Analyst" }] };
  const goodDraft = { baselineId: 3, resume: [section], lines: [{ id: "i1", sourceId: "m1", changed: true, flags: [] }], cover: [section], coverFlags: [], unused: [] };
  const good = { v: 1, step: "review", posting: "P", company: "Acme", draft: goodDraft, resume: [section], letter: { text: "Hi", base: [section], flags: [] } };

  it("reads back a draft stored with its version", () => {
    sessionStorage.setItem(flowKey("db1"), JSON.stringify(good));
    expect(loadFlow("db1")).toMatchObject({ step: "review", company: "Acme", draft: { baselineId: 3 }, resume: [section], letter: { text: "Hi" } });
  });

  it("starts fresh, and never throws, for another version or the wrong types anywhere in the draft", () => {
    const bad: unknown[] = [
      { ...good, v: undefined }, { ...good, v: 2 }, { ...good, draft: { ...goodDraft, baselineId: "3" } }, { ...good, draft: { ...goodDraft, lines: [{ id: 1 }] } },
      { ...good, draft: { ...goodDraft, cover: "x" } }, { ...good, resume: "x" }, { ...good, letter: { text: 5, base: [] } }, { ...good, letter: { text: "x", base: {} } },
      { ...good, draft: [] }, [], "text", 7, null,
    ];
    for (const item of bad) {
      sessionStorage.setItem(flowKey("db1"), JSON.stringify(item));
      expect(() => loadFlow("db1")).not.toThrow();
      expect(loadFlow("db1")).toEqual(emptyFlow());
    }
  });

  it("cleans the stored sections the way every document is cleaned", () => {
    sessionStorage.setItem(flowKey("db1"), JSON.stringify({ ...good, resume: [section, { nonsense: true }, 4] }));
    expect(loadFlow("db1").resume).toEqual([section]);
  });
});

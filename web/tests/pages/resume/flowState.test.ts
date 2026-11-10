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
});

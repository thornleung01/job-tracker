// match.py: same_role and the matching order (the Python behaviour is exercised end to end in tests/test_pipeline.py).
import { describe, expect, it } from "vitest";
import { findApplication, matchApplication, roleKey, sameRole, type MatchCandidate } from "../../src/pipeline";

const app = (id: number, role: string, stage = "Applied"): MatchCandidate => ({ id, role, roleKey: roleKey(role), stage });
const same = (a: string, b: string) => sameRole(roleKey(a), roleKey(b), a, b);

describe("sameRole", () => {
  it("equal keys are the same job", () => expect(same("Data Analyst", "data  ANALYST")).toBe(true));
  it("something added on the end that is not a level", () => expect(same("Operations Manager | NAM", "Operations Manager")).toBe(true));
  it("a level added on the end is a different job", () => expect(same("Senior Engineering Manager", "Senior Engineer")).toBe(false));
  it("a one-word prefix is not enough", () => expect(same("Product", "Product Manager - Growth")).toBe(false));
  it("unknown roles never match", () => expect(sameRole("", "x", "", "x")).toBe(false));
});

describe("matchApplication", () => {
  it("the same thread wins", () => expect(matchApplication(7, [], "", "")).toEqual({ kind: "matched", applicationId: 7 }));
  it("no company key is ambiguous", () => expect(matchApplication(null, [], "", "").kind).toBe("ambiguous"));
  it("same company and role matches the newest", () => {
    const apps = [app(1, "Data Analyst"), app(2, "Data Analyst")];
    expect(matchApplication(null, apps, "acme", roleKey("Data Analyst"), "interview", "Data Analyst")).toEqual({ kind: "matched", applicationId: 2 });
  });
  it("a fresh applied mail after a rejection is a new application", () => {
    const apps = [app(1, "Data Analyst", "Rejected")];
    expect(matchApplication(null, apps, "acme", roleKey("Data Analyst"), "applied", "Data Analyst").kind).toBe("new");
  });
  it("the one open application matches when no role is named", () => {
    expect(matchApplication(null, [app(3, "Data Analyst")], "acme", "", "interview", "")).toEqual({ kind: "matched", applicationId: 3 });
  });
  it("a different named role is a new application", () => {
    expect(matchApplication(null, [app(3, "Data Analyst")], "acme", roleKey("Cook"), "interview", "Cook").kind).toBe("new");
  });
  it("several open applications and no role is ambiguous", () => {
    expect(matchApplication(null, [app(1, "A B"), app(2, "C D")], "acme", "", "interview", "").kind).toBe("ambiguous");
  });
  it("nothing open at the company is new", () => {
    expect(matchApplication(null, [app(1, "A B", "Rejected")], "acme", "", "interview", "").kind).toBe("new");
  });
});

describe("findApplication (async store)", () => {
  it("looks the thread up first and skips an empty thread id", async () => {
    const calls: string[] = [];
    const store = {
      threadApplication: (t: string) => (calls.push(`thread:${t}`), t === "t1" ? 9 : null),
      applicationsFor: async (k: string) => (calls.push(`apps:${k}`), [app(4, "Data Analyst")]),
    };
    expect(await findApplication(store, "t1", "acme", "")).toEqual({ kind: "matched", applicationId: 9 });
    expect(await findApplication(store, "", "acme", "", "interview")).toEqual({ kind: "matched", applicationId: 4 });
    expect(calls).toEqual(["thread:t1", "apps:acme"]);
  });
});

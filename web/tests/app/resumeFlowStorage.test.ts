// The Resume page's saved job lives in session storage under one key per database; log out and Delete all my data clear it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAllFlows, clearFlow, flowKey } from "../../src/app/resumeFlowStorage";

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("clearing the saved job", () => {
  it("clearFlow removes one database's item only", () => {
    sessionStorage.setItem(flowKey("a"), "1");
    sessionStorage.setItem(flowKey("b"), "2");
    clearFlow("a");
    expect(sessionStorage.getItem(flowKey("a"))).toBeNull();
    expect(sessionStorage.getItem(flowKey("b"))).toBe("2");
  });

  it("clearAllFlows removes every database's item and nothing else", () => {
    sessionStorage.setItem(flowKey("a"), "1");
    sessionStorage.setItem(flowKey("b"), "2");
    sessionStorage.setItem("jobtracker:other", "3");
    clearAllFlows();
    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.getItem("jobtracker:other")).toBe("3");
  });

  it("never throws when storage is off", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("off");
    });
    expect(() => clearFlow("a")).not.toThrow();
    sessionStorage.setItem(flowKey("a"), "1");
    expect(() => clearAllFlows()).not.toThrow();
  });
});

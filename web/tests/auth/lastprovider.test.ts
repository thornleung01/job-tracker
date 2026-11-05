// The one thing kept between visits: which provider logged in last. A hint only, so a blocked or hostile store must never throw.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readLastProvider, writeLastProvider } from "../../src/auth/session";

afterEach(() => localStorage.clear());

describe("the last provider hint", () => {
  it("round-trips through localStorage, and holds nothing but the provider name", () => {
    expect(readLastProvider()).toBeNull();
    writeLastProvider("microsoft");
    expect(readLastProvider()).toBe("microsoft");
    writeLastProvider("google");
    expect(readLastProvider()).toBe("google");
    expect(Object.fromEntries(Object.entries(localStorage))).toEqual({ "jobtracker:lastProvider": "google" });
  });

  it("ignores a value it doesn't know", () => {
    for (const value of ["facebook", "", "GOOGLE", "google ", "{}"]) {
      localStorage.setItem("jobtracker:lastProvider", value);
      expect(readLastProvider(), value).toBeNull();
    }
  });

  it("carries on when the store throws on read or write", () => {
    const broken = {
      getItem: () => { throw new DOMException("denied", "SecurityError"); },
      setItem: () => { throw new DOMException("full", "QuotaExceededError"); },
    };
    expect(readLastProvider(broken)).toBeNull();
    expect(() => writeLastProvider("google", broken)).not.toThrow();
  });

  it("carries on when the browser blocks localStorage altogether", () => {
    const blocked = vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    expect(readLastProvider()).toBeNull();
    expect(() => writeLastProvider("microsoft")).not.toThrow();
    blocked.mockRestore();
    expect(readLastProvider()).toBeNull();      // and nothing was written anywhere
  });
});

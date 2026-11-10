import { describe, expect, it } from "vitest";
import { share } from "../../src/app/share";

describe("share", () => {
  it("returns the previous value when the new one has the same content", () => {
    const prev = { rows: [{ id: 1, name: "a" }, { id: 2, name: "b" }], n: 2 };
    expect(share(prev, JSON.parse(JSON.stringify(prev)))).toBe(prev);
  });

  it("keeps the rows that did not change and replaces the one that did", () => {
    const prev = { rows: [{ id: 1, name: "a" }, { id: 2, name: "b" }] };
    const next = { rows: [{ id: 1, name: "a" }, { id: 2, name: "changed" }] };
    const out = share(prev, next);
    expect(out).not.toBe(prev);
    expect(out.rows[0]).toBe(prev.rows[0]);
    expect(out.rows[1]).toEqual({ id: 2, name: "changed" });
  });

  it("treats a longer, shorter or reordered list as changed", () => {
    const a = { id: 1 }, b = { id: 2 };
    expect(share([a, b], [a])).toEqual([a]);
    expect(share([a, b], [b, a])).toEqual([b, a]);
    expect(share([a, b], [b, a])).not.toBe([a, b]);
  });

  it("never merges what it cannot compare by content", () => {
    const m1 = new Map([[1, "a"]]);
    const m2 = new Map([[1, "a"]]);
    expect(share({ m: m1 }, { m: m2 }).m).toBe(m2);
    expect(share(undefined, 5)).toBe(5);
    expect(share(null, { a: 1 })).toEqual({ a: 1 });
  });
});

import { describe, expect, it } from "vitest";
import { groupBy } from "../../src/sync/groupBy";

describe("groupBy", () => {
  it("groups by the key, keeping each group in its original order and the groups in first-seen order", () => {
    const groups = groupBy(["apple", "avocado", "banana", "blueberry", "cherry", "apricot"], (s) => s[0]);
    expect([...groups.keys()]).toEqual(["a", "b", "c"]);
    expect(groups.get("a")).toEqual(["apple", "avocado", "apricot"]);
    expect(groups.get("b")).toEqual(["banana", "blueberry"]);
  });

  it("is empty for no items and takes any iterable", () => {
    expect(groupBy([], (x: number) => x).size).toBe(0);
    expect(groupBy(new Set([1, 2, 3, 4]), (x) => x % 2 === 0).get(true)).toEqual([2, 4]);
  });

  it("adds to one array per key rather than copying it", () => {
    const first = { k: 1 };
    const groups = groupBy([first, { k: 1 }], (x) => x.k);
    const group = groups.get(1)!;
    expect(group).toHaveLength(2);
    expect(group[0]).toBe(first);
  });
});

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StatTiles, tilesFor } from "../../../src/pages/statistics/StatTiles";
import type { FlowData } from "../../../src/sync/stats";
import type { Pace, Speed } from "../../../src/sync/statistics";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flow = (over: Partial<FlowData> = {}): FlowData => ({
  total: 8, nodes: [], links: [], heardBack: 3, interviews: 1, offers: 0, rejected: 1, outcomes: { offer: 0, rejected: 1, noOutcomeYet: 7 }, ...over,
});
const spreadOf = (n: number, median: number | null) => ({ n, median, p25: median, p75: median });
const speed = (reply = spreadOf(5, 6)): Speed => ({ reply, interview: spreadOf(0, null), outcome: spreadOf(0, null) });
const pace = (perWeek: number): Pace => ({ weeks: [], goal: null, perWeek, best: null, streak: 0 });

describe("tilesFor", () => {
  it("shows the count, the shares and the median reply time", () => {
    expect(tilesFor(flow(), speed(), pace(4.2))).toEqual([
      { label: "Applications", value: "8", sub: "4.2 a week" },
      { label: "Heard back", value: "38%", sub: "3 of 8" }, // 37.5 goes to the even neighbour, 38
      { label: "Interviewed", value: "12%", sub: "1 of 8" }, // 12.5 goes to the even neighbour, 12
      { label: "Time to first reply", value: "6 days", sub: "median, from 5 applications" },
    ]);
  });

  it("uses the same rounding as the funnel's sentence", () => {
    const f = flow({ total: 8, heardBack: 1, interviews: 3 });
    expect(tilesFor(f, speed(), null)[1].value).toBe("12%"); // 12.5 -> 12
    expect(tilesFor(f, speed(), null)[2].value).toBe("38%"); // 37.5 -> 38
  });

  it("says one day, leaves out the weekly average with no pace, and says when a median isn't there yet", () => {
    const tiles = tilesFor(flow(), speed(spreadOf(3, 1)), null);
    expect(tiles[0].sub).toBeUndefined();
    expect(tiles[3]).toEqual({ label: "Time to first reply", value: "1 day", sub: "median, from 3 applications" });
    expect(tilesFor(flow(), speed(spreadOf(2, null)), null)[3]).toEqual({ label: "Time to first reply", value: "Not enough yet" });
  });
});

describe("StatTiles", () => {
  let root: Root;
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("is a labelled list of terms and values", async () => {
    root = createRoot(host);
    await act(async () => root.render(createElement(StatTiles, { flow: flow(), speed: speed(spreadOf(2, null)), pace: pace(2) })));
    expect(host.querySelector("section")!.getAttribute("aria-label")).toBe("Summary");
    expect([...host.querySelectorAll("dt")].map((e) => e.textContent)).toEqual(["Applications", "Heard back", "Interviewed", "Time to first reply"]);
    expect([...host.querySelectorAll(".tile-value")].map((e) => e.textContent)).toEqual(["8", "38%", "12%", "Not enough yet"]);
    expect(host.querySelectorAll(".tile.quiet")).toHaveLength(1);
  });
});

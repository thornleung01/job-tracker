import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WeeklyBars, labelStep, W } from "../../../src/pages/statistics/WeeklyBars";
import { paceNote, type Pace, type WeekCount } from "../../../src/sync/statistics";
import { shiftDay } from "../../../src/db/time";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

/** Weeks of the given counts, Mondays from `first`, the last one current. */
function pace(counts: number[], goal: number | null, first = "2026-08-03"): Pace {
  const weeks: WeekCount[] = counts.map((count, i) => {
    const start = shiftDay(first, 7 * i);
    return { start, end: shiftDay(start, 6), count, current: i === counts.length - 1 };
  });
  const done = weeks.length > 1 ? weeks.slice(0, -1) : weeks;
  const perWeek = Math.round((done.reduce((s, w) => s + w.count, 0) / done.length) * 10) / 10;
  let best: WeekCount | null = null;
  for (const w of weeks) if (w.count && (!best || w.count >= best.count)) best = w;
  return { weeks, goal, perWeek, best, streak: 0 };
}
async function render(p: Pace) {
  root = createRoot(host);
  await act(async () => root.render(createElement(WeeklyBars, { pace: p })));
}
const svg = () => host.querySelector<SVGSVGElement>("svg.pace-chart")!;
const bars = () => [...host.querySelectorAll<SVGRectElement>("rect.pace-bar")];
const marks = () => [...host.querySelectorAll<SVGElement>("[data-key]")];
const tip = () => host.querySelector<HTMLElement>(".tip")!;
const num = (el: Element, a: string) => Number(el.getAttribute(a));
/** the drawn height: the rect runs 4 below the baseline so the bottom corners are clipped */
const barH = (el: Element) => num(el, "height") - 4;
const rows = () => [...host.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent));

interface Box { text: string; a: number; b: number }
const xBoxes = (): Box[] =>
  [...host.querySelectorAll(".x-label")].map((t) => {
    const x = num(t, "x");
    const w = t.textContent!.length * 6.6;
    return t.getAttribute("text-anchor") === "end" ? { text: t.textContent!, a: x - w, b: x } : { text: t.textContent!, a: x - w / 2, b: x + w / 2 };
  });
function noOverlap(boxes: Box[]) {
  const s = [...boxes].sort((p, q) => p.a - q.a);
  for (let i = 1; i < s.length; i++) expect(s[i].a, `${s[i - 1].text} vs ${s[i].text}`).toBeGreaterThan(s[i - 1].b);
}
const gutterYs = () => [...host.querySelectorAll(".y-label, .goal-label")].map((t) => num(t, "y")).sort((a, b) => a - b);

const P13 = pace([2, 3, 5, 4, 6, 9, 4, 3, 5, 2, 4, 6, 3], 5);

describe("WeeklyBars", () => {
  it("is a Pace card with the note and a takeaway label", async () => {
    await render(P13);
    expect(host.querySelector("h2")!.textContent).toBe("Pace");
    expect(host.querySelector(".chart-note")?.textContent ?? null).toBe(paceNote(P13));
    expect(svg().getAttribute("role")).toBe("group");
    expect(svg().getAttribute("aria-label")).toBe(`Applications per week over the last 13 weeks. This week 3, average ${P13.perWeek} a week, best week 9, goal 5.`);
  });

  it("omits best with no applications and goal when null, and the note when there is none", async () => {
    const p = pace([0, 0, 0], null);
    await render(p);
    expect(svg().getAttribute("aria-label")).toBe("Applications per week over the last 3 weeks. This week 0, average 0 a week.");
    expect(host.querySelector(".chart-note")).toBeNull();
    expect(host.querySelector(".goal-line")).toBeNull();
    expect(bars()).toHaveLength(0);
    expect(marks()).toHaveLength(3);
  });

  it("draws a column per week with heights in proportion to the count on a 0..max scale", async () => {
    await render(P13);
    const nonZero = P13.weeks.filter((w) => w.count);
    expect(bars()).toHaveLength(nonZero.length);
    const unit = barH(bars()[5]) / 9; // the busiest week is the max (goal 5 is lower)
    bars().forEach((b, i) => expect(barH(b)).toBeCloseTo(P13.weeks[i].count * unit, 5));
    const top = Math.min(...bars().map((b) => num(b, "y")));
    expect(top).toBe(20); // the max reaches the plot top
    const xs = bars().map((b) => num(b, "x"));
    expect([...xs].sort((a, b) => a - b)).toEqual(xs); // oldest left
    expect(num(bars()[0], "width")).toBeLessThanOrEqual(28);
  });

  it("puts the accent on this week only, and a This week label under it, end-aligned", async () => {
    await render(P13);
    expect(host.querySelectorAll("rect.pace-bar.now")).toHaveLength(1);
    expect(bars()[12].classList.contains("now")).toBe(true);
    const now = host.querySelector(".now-label")!;
    expect(now.textContent).toBe("This week");
    expect(now.getAttribute("text-anchor")).toBe("end");
    expect(num(now, "x")).toBeLessThanOrEqual(W);
  });

  it("draws one dashed goal line at the goal height, labelled in the gutter", async () => {
    await render(P13);
    const line = host.querySelectorAll(".goal-line");
    expect(line).toHaveLength(1);
    const y = num(line[0], "y1");
    const base = num(host.querySelectorAll(".gridline")[1], "y1");
    const unit = barH(bars()[5]) / 9;
    expect(base - y).toBeCloseTo(5 * unit, 5);
    expect(host.querySelector(".goal-label")!.textContent).toBe("Goal 5");
    // the label sits left of the plot, so no bar can be under it
    const label = host.querySelector(".goal-label")!;
    const left = Math.min(...bars().map((b) => num(b, "x")));
    expect(num(label, "x")).toBeLessThan(left);
    const gaps = gutterYs();
    for (let i = 1; i < gaps.length; i++) expect(gaps[i] - gaps[i - 1]).toBeGreaterThanOrEqual(12);
  });

  it("shows tooltips on hover and focus, and moves with the arrow keys", async () => {
    await render(P13);
    expect(marks().map((m) => m.getAttribute("data-key"))).toEqual(P13.weeks.map((w) => `w:${w.start}`));
    await act(async () => marks()[0].dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 10 })));
    expect(tip().textContent).toBe("Week of Aug 32 applicationsGoal 5, 3 short");
    expect(tip().querySelector("b")!.textContent).toBe("Week of Aug 3");
    expect(marks()[0].getAttribute("aria-label")).toBe("Week of Aug 3: 2 applications, 3 short of the goal.");
    await act(async () => marks()[2].focus());
    expect(tip().textContent).toBe("Week of Aug 175 applicationsGoal 5, met");
    expect(marks()[2].getAttribute("aria-label")).toBe("Week of Aug 17: 5 applications, goal met.");
    await act(async () => marks()[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement).toBe(marks()[3]);
    await act(async () => marks()[3].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(document.activeElement).toBe(marks()[2]);
  });

  it("keeps the hit target for a week with nothing between busy weeks", async () => {
    const p = pace([4, 0, 6], 3);
    await render(p);
    expect(bars()).toHaveLength(2);
    expect(marks()).toHaveLength(3);
    await act(async () => marks()[1].focus());
    expect(tip().textContent).toBe("Week of Aug 100 applicationsGoal 3, 3 short");
    expect(rows()[1]).toEqual(["Aug 10", "0", "No"]);
  });

  it("says 1 application, not 1 applications", async () => {
    await render(pace([1, 2], null));
    await act(async () => marks()[0].focus());
    expect(tip().textContent).toBe("Week of Aug 31 application");
    expect(marks()[0].getAttribute("aria-label")).toBe("Week of Aug 3: 1 application.");
  });

  it("handles a single week", async () => {
    const p = pace([3], 5);
    await render(p);
    expect(svg().getAttribute("aria-label")).toBe("Applications per week over the last week. This week 3, average 3 a week, best week 3, goal 5.");
    expect(bars()).toHaveLength(1);
    expect(bars()[0].classList.contains("now")).toBe(true);
    expect(marks()).toHaveLength(1);
    expect(rows()).toEqual([["Aug 3", "3", "No"]]);
    noOverlap(xBoxes());
    expect(xBoxes().map((b) => b.text)).toEqual(["This week"]);
  });

  it("puts the goal line above every column when the goal is larger than every count", async () => {
    await render(pace([1, 2, 1], 10));
    const base = num(host.querySelectorAll(".gridline")[host.querySelectorAll(".gridline").length - 1], "y1");
    const goalY = num(host.querySelector(".goal-line")!, "y1");
    expect(goalY).toBe(20);
    expect(Math.min(...bars().map((b) => num(b, "y")))).toBeGreaterThan(goalY);
    expect(barH(bars()[1])).toBeCloseTo((base - goalY) * 0.2, 5);
    // the goal and the max share a line: one label and one dashed line, no second number
    expect([...host.querySelectorAll(".y-label")].map((t) => t.textContent)).toEqual(["0"]);
  });

  it("labels the max and the zero when there is no goal", async () => {
    await render(pace([1, 7, 3], null));
    expect([...host.querySelectorAll(".y-label")].map((t) => t.textContent)).toEqual(["0", "7"]);
    expect(host.querySelector(".goal-label")).toBeNull();
    expect(host.querySelectorAll(".mark-hit")).toHaveLength(3);
    expect(tip().hidden).toBe(true);
  });

  it("keeps the gutter labels apart for a goal near zero or near the max", async () => {
    await render(pace([30, 50, 40], 1));
    let ys = gutterYs();
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(12);
    await act(async () => root.unmount());
    await render(pace([30, 50, 40], 49));
    ys = gutterYs();
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(12);
  });

  it("scales very large counts and a goal of 50", async () => {
    const p = pace([50, 12, 50, 25, 0, 49], 50);
    await render(p);
    const hs = bars().map(barH);
    expect(Math.max(...hs)).toBeCloseTo(152, 5);
    expect(barH(bars()[3]) / hs[0]).toBeCloseTo(0.5, 5);
    expect(host.querySelector(".goal-label")!.textContent).toBe("Goal 50");
    expect(num(host.querySelector(".goal-line")!, "y1")).toBe(20);
    expect(svg().getAttribute("aria-label")).toContain("goal 50");
  });

  it("table matches the data, oldest first, with the goal column only when there is a goal", async () => {
    await render(P13);
    expect([...host.querySelectorAll("th")].map((t) => t.textContent)).toEqual(["Week of", "Applications", "Goal met"]);
    expect(rows()).toEqual(P13.weeks.map((w) => [w.start === "2026-08-03" ? "Aug 3" : rows()[P13.weeks.indexOf(w)][0], String(w.count), w.count >= 5 ? "Yes" : "No"]));
    expect(rows()[0][0]).toBe("Aug 3");
    expect(rows()[12][0]).toBe("Oct 26");
    await act(async () => root.unmount());
    await render(pace([2, 3], null));
    expect([...host.querySelectorAll("th")].map((t) => t.textContent)).toEqual(["Week of", "Applications"]);
    expect(rows()).toEqual([["Aug 3", "2"], ["Aug 10", "3"]]);
  });

  it("picks label steps from the number of weeks", () => {
    expect([1, 6, 7, 13, 14, 26, 27, 52].map(labelStep)).toEqual([1, 1, 2, 2, 4, 4, 8, 8]);
  });

  it("never lets x labels collide, for every size up to 52 weeks", async () => {
    for (const n of [1, 2, 5, 6, 7, 13, 14, 26, 27, 52]) {
      const counts = Array.from({ length: n }, (_, i) => (i * 7) % 11);
      await render(pace(counts, 4));
      const boxes = xBoxes();
      noOverlap(boxes);
      expect(boxes[0].a, `${n} weeks`).toBeGreaterThanOrEqual(0);
      expect(Math.max(...boxes.map((b) => b.b)), `${n} weeks`).toBeLessThanOrEqual(W);
      expect(boxes.some((b) => b.text === "This week")).toBe(true);
      expect(boxes.length).toBeLessThanOrEqual(Math.ceil(n / labelStep(n)) + 1);
      await act(async () => root.unmount());
    }
    root = createRoot(host);
  });

  it("labels 52 weeks sparsely and still draws and tabs through all of them", async () => {
    await render(pace(Array.from({ length: 52 }, (_, i) => i % 6), 3));
    expect(xBoxes().length).toBeLessThanOrEqual(8);
    expect(marks()).toHaveLength(52);
    expect(marks().filter((m) => m.getAttribute("tabindex") === "0")).toHaveLength(1);
    const widths = bars().map((b) => num(b, "width"));
    expect(Math.min(...widths)).toBeGreaterThan(0);
    expect(rows()).toHaveLength(52);
  });

  it("adds the year only when the weeks cross a year boundary", async () => {
    const p = pace([2, 3, 4, 5], 3, "2026-12-14"); // Dec 14, 21, 28, Jan 4
    await render(p);
    await act(async () => marks()[0].focus());
    expect(tip().querySelector("b")!.textContent).toBe("Week of Dec 14, 2026");
    expect(marks()[3].getAttribute("aria-label")).toBe("Week of Jan 4, 2027: 5 applications, goal met.");
    expect(rows().map((r) => r[0])).toEqual(["Dec 14, 2026", "Dec 21, 2026", "Dec 28, 2026", "Jan 4, 2027"]);
    await act(async () => root.unmount());
    await render(pace([2, 3], 3, "2026-12-14"));
    expect(rows().map((r) => r[0])).toEqual(["Dec 14", "Dec 21"]);
  });

  it("uses the day strings as they are, whatever the time zone", async () => {
    await render(pace([1, 1], null, "2026-03-02")); // the week of a DST change in Toronto
    expect(rows().map((r) => r[0])).toEqual(["Mar 2", "Mar 9"]);
    expect(xBoxes().map((b) => b.text)).toContain("Mar 2");
  });

  it("has a stylesheet with forced-colors rules and no raw colours", async () => {
    const fs = await import(/* @vite-ignore */ "node" + ":fs");
    const css: string = fs.readFileSync(`${(globalThis as unknown as { process: { cwd(): string } }).process.cwd()}/src/pages/statistics/pace.css`, "utf8");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toContain("tabular-nums");
    expect(css).not.toMatch(/text-decoration:\s*underline/);
    expect(css).not.toContain("!important");
    expect(css).toContain("var(--stage-applied)");
    expect(css).toContain("var(--neutral)");
    for (const line of css.split("\n").filter((l) => /^\s*\.viz-root|^\s*\./.test(l))) expect(line.trim().startsWith(".viz-root svg.pace-chart")).toBe(true);
  });
});

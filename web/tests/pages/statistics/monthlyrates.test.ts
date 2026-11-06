import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MonthlyRates } from "../../../src/pages/statistics/MonthlyRates";
import type { MonthRate } from "../../../src/sync/statistics";

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

async function render(months: readonly MonthRate[]) {
  root = createRoot(host);
  await act(async () => root.render(createElement(MonthlyRates, { months })));
}
async function readCss(): Promise<string> {
  const fs = await import(/* @vite-ignore */ "node" + ":fs");
  return fs.readFileSync(`${(globalThis as unknown as { process: { cwd(): string } }).process.cwd()}/src/pages/statistics/monthly.css`, "utf8");
}

function rate(month: string, applied: number, heardBack: number, settling = false): MonthRate {
  return { month, applied, heardBack, pct: applied ? Math.round((100 * heardBack) / applied) : null, settling };
}
const JUN_NOV: MonthRate[] = [rate("2026-06", 8, 3), rate("2026-07", 10, 5), rate("2026-08", 20, 9), rate("2026-09", 25, 13), rate("2026-10", 10, 2, true), rate("2026-11", 4, 0, true)];
/** n consecutive months starting 2025-01 */
function run(n: number, settleLast = 0): MonthRate[] {
  return Array.from({ length: n }, (_, i) => rate(`${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, 10, 4, i >= n - settleLast));
}

const svg = () => host.querySelector("svg.monthly-chart")!;
const cols = () => [...host.querySelectorAll<SVGElement>("path.col[data-month]")];
const marks = () => [...host.querySelectorAll<SVGElement>("[data-key]")];
const tip = () => host.querySelector<HTMLElement>(".tip")!;
const note = () => host.querySelector(".chart-note")?.textContent ?? null;
const monthLabels = () => [...host.querySelectorAll<SVGTextElement>("text.month-label")];
const countLabels = () => [...host.querySelectorAll("text.count-label")].map((t) => t.textContent);
const heights = () => cols().map((c) => Number(c.getAttribute("data-height")));
const rows = () => [...host.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent));

describe("MonthlyRates", () => {
  it("renders nothing without months", async () => {
    await render([]);
    expect(host.innerHTML).toBe("");
  });

  it("titles the card, writes the note and states the takeaway on the svg", async () => {
    await render(JUN_NOV);
    expect(host.querySelector("h2")!.textContent).toBe("Reply rate by month sent");
    expect(note()).toBe("Replies came to 38% of applications sent in Jun and 52% of those sent in Sep.");
    expect(svg().getAttribute("role")).toBe("group");
    expect(svg().getAttribute("aria-label")).toBe(
      "Reply rate by month sent, from Jun 2026 to Nov 2026. 52% of applications sent in Sep heard back. The two latest months are still coming in.",
    );
  });

  it("draws one column per month on a fixed 0 to 100 scale", async () => {
    await render(JUN_NOV);
    expect(cols()).toHaveLength(6);
    const h = heights();
    expect(h[3] / h[0]).toBeCloseTo(52 / 38, 5);
    expect(h[1] / h[3]).toBeCloseTo(50 / 52, 5);
    expect(h[5]).toBe(2); // 0% stub
  });

  it("uses the Heard back colour through solid and hatched columns, no other accent", async () => {
    await render(JUN_NOV);
    expect(cols().map((c) => c.getAttribute("class"))).toEqual(["col solid", "col solid", "col solid", "col solid", "col hatched", "col hatched"]);
    expect(cols()[4].getAttribute("fill")).toMatch(/^url\(#hatch-[^:]+\)$/);
    expect(cols()[0].getAttribute("fill")).toBeNull();
    const pattern = svg().querySelector("pattern")!;
    expect(pattern.getAttribute("patternTransform")).toBe("rotate(45)");
    expect(pattern.getAttribute("id")).toBe(cols()[4].getAttribute("fill")!.slice(5, -1));
    const css = await readCss();
    expect(css).toMatch(/\.col\.solid \{ fill: var\(--stage-heard-back\)/);
    expect(css).toMatch(/\.hatch-line \{ stroke: var\(--stage-heard-back\)/);
  });

  it("explains the hatch in the footer only when a month is settling", async () => {
    await render(JUN_NOV);
    const legend = host.querySelector(".monthly-legend")!;
    expect(legend.textContent).toBe("Still coming in");
    expect(legend.querySelector("svg")!.getAttribute("width")).toBe("12");
    expect(legend.querySelector("pattern")).not.toBeNull();
    await act(async () => root.render(createElement(MonthlyRates, { months: JUN_NOV.slice(0, 4) })));
    expect(host.querySelector(".monthly-legend")).toBeNull();
    expect(svg().getAttribute("aria-label")).toBe("Reply rate by month sent, from Jun 2026 to Sep 2026. 52% of applications sent in Sep heard back.");
  });

  it("labels the axis and the months, with counts under each month", async () => {
    await render(JUN_NOV);
    expect([...host.querySelectorAll("text.axis")].slice(0, 3).map((t) => t.textContent)).toEqual(["0%", "50%", "100%"]);
    expect(host.querySelectorAll("line.gridline")).toHaveLength(3);
    expect(monthLabels().map((t) => t.textContent)).toEqual(["Jun2026", "Jul", "Aug", "Sep", "Oct", "Nov"]);
    expect(countLabels()).toEqual(["8 applied", "10 applied", "20 applied", "25 applied", "10 applied", "4 applied"]);
  });

  it("works with exactly two months and counts of 1", async () => {
    await render([rate("2026-08", 1, 1), rate("2026-09", 1, 0)]);
    expect(cols()).toHaveLength(2);
    expect(countLabels()).toEqual(["1 applied", "1 applied"]);
    expect(note()).toBe("Replies came to 100% of applications sent in Aug and 0% of those sent in Sep.");
    await act(async () => marks()[0].focus());
    expect(tip().textContent).toBe("August 2026100% heard back1 of 1 application");
    expect(marks()[0].getAttribute("aria-label")).toBe("August 2026: 100% heard back, 1 of 1 application.");
  });

  it("shortens counts to the bare number when the slot is narrower than the text, and drops them past 12 months", async () => {
    await render(run(12));
    expect(countLabels()).toEqual(Array(12).fill("10"));
    await act(async () => root.render(createElement(MonthlyRates, { months: run(13) })));
    expect(countLabels()).toEqual([]);
  });

  it("leaves a gap month as a label only and says so in the tooltip", async () => {
    await render([rate("2026-06", 5, 2), rate("2026-07", 0, 0), rate("2026-08", 5, 5)]);
    expect(cols()).toHaveLength(2);
    expect(monthLabels()).toHaveLength(3);
    expect(marks()).toHaveLength(3);
    await act(async () => marks()[1].focus());
    expect(tip().textContent).toBe("July 2026No applications");
    expect(marks()[1].getAttribute("aria-label")).toBe("July 2026: no applications.");
    expect(rows()[1]).toEqual(["July 2026", "0", "0", "", ""]);
  });

  it("omits the note when every month is still settling, or only one has settled", async () => {
    await render([rate("2026-10", 5, 1, true), rate("2026-11", 5, 1, true)]);
    expect(note()).toBeNull();
    expect(svg().getAttribute("aria-label")).toBe("Reply rate by month sent, from Oct 2026 to Nov 2026. The two latest months are still coming in.");
    await act(async () => root.render(createElement(MonthlyRates, { months: [rate("2026-09", 5, 1), rate("2026-10", 5, 1, true)] })));
    expect(note()).toBeNull();
    expect(svg().getAttribute("aria-label")).toContain("The latest month is still coming in.");
  });

  it("names the year in the note when both months share a name", async () => {
    await render([rate("2025-06", 10, 3), rate("2025-12", 10, 4), rate("2026-06", 10, 5)]);
    expect(note()).toBe("Replies came to 30% of applications sent in Jun 2025 and 50% of those sent in Jun 2026.");
  });

  it("adds the year on the first month and each January", async () => {
    await render([rate("2025-10", 4, 2), rate("2025-11", 4, 2), rate("2025-12", 4, 2), rate("2026-01", 4, 2), rate("2026-02", 4, 2)]);
    expect(monthLabels().map((t) => t.textContent)).toEqual(["Oct2025", "Nov", "Dec", "Jan2026", "Feb"]);
  });

  it("thins labels past 12 months, ends on the last month and never lets two collide", async () => {
    for (const [n, step] of [[13, 2], [18, 2], [19, 3], [24, 3], [40, 3]] as const) {
      await act(async () => root?.unmount());
      await render(run(n));
      const xs = monthLabels().map((t) => Number(t.getAttribute("x")));
      expect(xs.length).toBeGreaterThan(0);
      expect(xs[xs.length - 1]).toBeCloseTo(40 + (n - 0.5) * (432 / n), 5);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(34);
      expect(xs.length).toBeLessThanOrEqual(Math.ceil(n / step)); // a narrower chart may thin further to keep the gap
      expect(xs.length).toBeGreaterThanOrEqual(4);
      expect(countLabels()).toEqual([]);
    }
  });

  it("labels 24 months every third month, years on the first labelled and on each January", async () => {
    await render(run(24));
    const texts = monthLabels().map((t) => t.textContent);
    expect(texts).toHaveLength(8);
    expect(texts[texts.length - 1]).toBe("Dec"); // ends on the last month, 2026-12
    expect(texts[0]).toMatch(/2025$/);
    expect(texts.filter((t) => /20\d\d$/.test(t!))).toHaveLength(2);
  });

  it("draws a 0% month as a 2px stub and a 100% month at full height", async () => {
    await render([rate("2026-08", 4, 0), rate("2026-09", 4, 4), rate("2026-10", 4, 2)]);
    expect(heights()[0]).toBe(2);
    expect(heights()[1]).toBe(140);
    expect(heights()[2]).toBe(70);
  });

  it("shows the tooltip on hover and on focus, and moves with the arrow keys", async () => {
    await render(JUN_NOV);
    await act(async () => marks()[4].dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 10 })));
    expect(tip().hidden).toBe(false);
    expect(tip().textContent).toBe("October 202620% heard back2 of 10 applicationsStill coming in. Replies can take weeks.");
    expect(marks()[0].getAttribute("data-key")).toBe("m:2026-06");
    await act(async () => marks()[0].focus());
    expect(tip().textContent).toBe("June 202638% heard back3 of 8 applications");
    await act(async () => marks()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement).toBe(marks()[1]);
    expect(tip().textContent).toBe("July 202650% heard back5 of 10 applications");
    expect(marks()[4].getAttribute("aria-label")).toBe("October 2026: 20% heard back, 2 of 10 applications. Still coming in. Replies can take weeks.");
  });

  it("matches the table to the data, with an empty rate for a month without applications", async () => {
    await render([...JUN_NOV.slice(0, 2), rate("2026-08", 0, 0), ...JUN_NOV.slice(3)]);
    expect([...host.querySelectorAll("th")].map((t) => t.textContent)).toEqual(["Month sent", "Applications", "Heard back", "Rate", "Status"]);
    expect(rows()).toEqual([
      ["June 2026", "8", "3", "38%", ""],
      ["July 2026", "10", "5", "50%", ""],
      ["August 2026", "0", "0", "", ""],
      ["September 2026", "25", "13", "52%", ""],
      ["October 2026", "10", "2", "20%", "Still coming in"],
      ["November 2026", "4", "0", "0%", "Still coming in"],
    ]);
  });

  it("has a stylesheet with a forced-colors block and no hex, tabular-nums or underline", async () => {
    const css = await readCss();
    expect(css).toMatch(/@media \(forced-colors: active\)/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toContain("tabular-nums");
    expect(css).not.toMatch(/text-decoration:\s*underline/);
    expect(css).not.toContain("!important");
  });
});

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listUrl } from "../../../src/pages/applications";
import { SpeedRanges, axisMax, niceMax } from "../../../src/pages/statistics/SpeedRanges";
import type { Speed, Spread, Waiting } from "../../../src/sync/statistics";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host.remove();
});

const sp = (n: number, median: number | null, p25: number | null = median, p75: number | null = median): Spread => ({ n, median, p25, p75 });
const SPEED: Speed = { reply: sp(14, 6, 3, 9), interview: sp(5, 11, 8, 20), outcome: sp(2, null) };
const WAIT: Waiting = { fresh: 3, followUp: 2, ghosted: 1 };

async function render(speed: Speed = SPEED, waiting: Waiting = WAIT, account = 0) {
  root = createRoot(host);
  await act(async () => root!.render(createElement(SpeedRanges, { speed, waiting, account })));
}
const marks = () => [...host.querySelectorAll<SVGElement>("[data-key]")];
const tip = () => host.querySelector<HTMLElement>(".tip")!;
const dots = () => [...host.querySelectorAll<SVGCircleElement>("circle.median")];
const bars = () => [...host.querySelectorAll<SVGRectElement>("rect.range")];
const links = () => [...host.querySelectorAll<HTMLAnchorElement>(".waiting-now a")];

describe("niceMax", () => {
  it("rounds up to a round number", () => {
    const got = [1, 4, 5, 6, 47, 120, 1000].map(niceMax);
    expect(got).toEqual([5, 5, 5, 10, 50, 200, 1000]);
    expect([0, 10, 11, 20, 21, 30, 31, 100, 101, 300, 301].map(niceMax)).toEqual([5, 10, 20, 20, 30, 30, 50, 100, 200, 300, 500]);
  });
  it("takes the largest p75 across the rows and ignores empty rows", () => {
    expect(axisMax(SPEED)).toBe(20);
    expect(axisMax({ reply: sp(1, null), interview: sp(1, null), outcome: sp(1, null) })).toBe(5);
  });
});

describe("SpeedRanges chart", () => {
  it("is a card titled 'How fast companies reply' with no note and no h3", async () => {
    await render();
    expect(host.querySelector("h2")!.textContent).toBe("How fast companies reply");
    expect(host.querySelector(".chart-note")).toBeNull();
    expect(host.querySelector("h3")).toBeNull();
  });

  it("states the takeaway on the svg", async () => {
    await render();
    expect(host.querySelector("svg.chart")!.getAttribute("aria-label")).toBe(
      "How long companies take. First reply: median 6 days. Interview: median 11 days. Outcome: not enough yet.",
    );
    expect(host.querySelector("svg.chart")!.getAttribute("role")).toBe("group");
  });

  it("draws three rows in order with the row text and an axis with 0 and the max only", async () => {
    await render();
    const t = [...host.querySelectorAll("text")].map((e) => e.textContent);
    expect(t).toEqual(["0", "20 days", "To first reply", "Median 6 days, from 14 applications", "To interview", "Median 11 days, from 5 applications", "To an outcome", "Not enough yet"]);
    expect(host.querySelectorAll("line.gridline")).toHaveLength(2);
    expect(marks().map((m) => m.getAttribute("data-key"))).toEqual(["s:reply", "s:interview", "s:outcome"]);
  });

  it("puts bars and dots on one shared scale, and draws nothing for a not-enough row", async () => {
    await render();
    expect(bars()).toHaveLength(2);
    expect(dots()).toHaveLength(2);
    const [a, b] = bars();
    // reply 3..9 and interview 8..20 on a 0..20 axis over 356 units
    expect(Number(a.getAttribute("width"))).toBeCloseTo((6 / 20) * 356);
    expect(Number(b.getAttribute("width"))).toBeCloseTo((12 / 20) * 356);
    expect(Number(a.getAttribute("x"))).toBeCloseTo(12 + (3 / 20) * 356);
    expect(a.getAttribute("height")).toBe("6");
    expect(dots()[0].getAttribute("r")).toBe("5");
    expect(Number(dots()[1].getAttribute("cx"))).toBeCloseTo(12 + (11 / 20) * 356);
  });

  it("draws only the dot when p25 equals p75", async () => {
    await render({ ...SPEED, reply: sp(4, 5, 5, 5) });
    expect(bars()).toHaveLength(1);
    expect(dots()).toHaveLength(2);
  });

  it("says Median 0 days for a same-day median, and uses singular forms", async () => {
    await render({ reply: sp(3, 0, 0, 1), interview: sp(3, 1, 1, 2), outcome: sp(1, null) });
    const text = host.querySelector("svg")!.textContent!;
    expect(text).toContain("Median 0 days, from 3 applications");
    expect(text).toContain("Median 1 day, from 3 applications");
    expect(marks()[2].getAttribute("aria-label")).toBe("To an outcome: not enough yet. 1 application so far.");
    expect(Number(dots()[0].getAttribute("cx"))).toBe(12);
  });

  it("draws nothing and says so when all three rows are not enough", async () => {
    await render({ reply: sp(0, null), interview: sp(1, null), outcome: sp(2, null) });
    expect(bars()).toHaveLength(0);
    expect(dots()).toHaveLength(0);
    expect(host.querySelector("svg")!.getAttribute("aria-label")).toBe(
      "How long companies take. First reply: not enough yet. Interview: not enough yet. Outcome: not enough yet.",
    );
    expect(host.querySelector("svg")!.textContent).not.toContain("Median");
    expect(marks()).toHaveLength(3);
  });

  it("words each mark's aria-label as one sentence", async () => {
    await render();
    expect(marks()[0].getAttribute("aria-label")).toBe("To first reply: median 6 days. Middle half took 3 to 9 days, from 14 applications.");
    expect(marks()[2].getAttribute("aria-label")).toBe("To an outcome: not enough yet. 2 applications so far.");
  });

  it("shows the tooltip on hover and on focus", async () => {
    await render();
    await act(async () => marks()[0].dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 5 })));
    expect(tip().hidden).toBe(false);
    expect(tip().querySelector("b")!.textContent).toBe("To first reply");
    expect(tip().textContent).toBe("To first replyMedian 6 daysMiddle half took 3 to 9 days, from 14 applications");
    expect(tip().querySelector(".t2")!.textContent).toBe("Middle half took 3 to 9 days, from 14 applications");
    await act(async () => marks()[2].focus());
    expect(tip().textContent).toBe("To an outcomeNot enough yet. 2 applications so far.");
  });

  it("moves between rows with the arrow keys", async () => {
    await render();
    await act(async () => marks()[0].focus());
    await act(async () => marks()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(marks()[1]);
    await act(async () => marks()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(document.activeElement).toBe(marks()[0]);
  });

  it("keeps labels from colliding: the longest row text fits beside the longest label", async () => {
    await render({ reply: sp(1000, 120, 100, 1000), interview: sp(1000, 120, 100, 1000), outcome: sp(1000, 120, 100, 1000) });
    // 13px text is about 7px a character: label and text plus a gap must fit the 356 wide track
    const label = "To an outcome".length * 7;
    const text = "Median 120 days, from 1000 applications".length * 6.2;
    expect(label + text + 16).toBeLessThan(356);
    expect(host.querySelector("svg")!.textContent).toContain("1000 days");
  });
});

describe("table view", () => {
  it("has the same numbers as the chart, with empty cells for a not-enough row", async () => {
    await render();
    const heads = [...host.querySelectorAll("th")].map((e) => e.textContent);
    expect(heads).toEqual(["Step", "Median", "Middle half", "Applications"]);
    const rows = [...host.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((c) => c.textContent));
    expect(rows).toEqual([
      ["To first reply", "6 days", "3 to 9 days", "14"],
      ["To interview", "11 days", "8 to 20 days", "5"],
      ["To an outcome", "Not enough yet", "", "2"],
    ]);
    expect(host.querySelector("table")!.textContent).not.toMatch(/[-–—]/);
  });
});

describe("Waiting now", () => {
  it("lists the three counts and links the two that are above zero", async () => {
    await render();
    expect(host.querySelector("h3")).toBeNull();
    expect(host.querySelector(".waiting-now p")!.textContent).toBe("Waiting now");
    const items = [...host.querySelectorAll(".waiting-now li")].map((e) => e.textContent);
    expect(items).toEqual(["Under 7 days: 3", "7 to 29 days: 2 follow up", "30 days or more: 1 no reply"]);
    expect(links().map((a) => a.getAttribute("href"))).toEqual(["#/?followUp=1", "#/?ghosted=1"]);
    expect(host.querySelectorAll(".waiting-now .small").length).toBeGreaterThan(0);
  });

  it("appends the account when it is non-zero and matches the list's own address", async () => {
    await render(SPEED, WAIT, 3);
    const hrefs = links().map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["#" + listUrl({ followUp: true, account: 3 }), "#" + listUrl({ ghosted: true, account: 3 })]);
    expect(hrefs[0]).toContain("account=3");
  });

  it("leaves the account out when it is 0", async () => {
    await render(SPEED, WAIT, 0);
    expect(links().map((a) => a.getAttribute("href"))).toEqual(["#" + listUrl({ followUp: true }), "#" + listUrl({ ghosted: true })]);
    expect(links()[0].getAttribute("href")).not.toContain("account");
  });

  it("shows a zero count as plain text", async () => {
    await render(SPEED, { fresh: 4, followUp: 0, ghosted: 2 });
    expect(links().map((a) => a.textContent)).toEqual(["2 no reply"]);
    expect(host.querySelectorAll(".waiting-now li")[1].textContent).toBe("7 to 29 days: 0 follow up");
  });

  it("is hidden when all three are 0", async () => {
    await render(SPEED, { fresh: 0, followUp: 0, ghosted: 0 });
    expect(host.querySelector(".waiting-now")).toBeNull();
    expect(host.textContent).not.toContain("Waiting now");
  });

  it("uses no exclamation marks", async () => {
    await render(SPEED, WAIT, 2);
    expect(host.textContent).not.toContain("!");
  });
});

describe("speed.css", () => {
  it("has a forced-colors block and no hex, tabular-nums, underline or !important", async () => {
    const fs = await import(/* @vite-ignore */ "node" + ":fs");
    const css: string = fs.readFileSync(`${(globalThis as unknown as { process: { cwd(): string } }).process.cwd()}/src/pages/statistics/speed.css`, "utf8");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toContain("tabular-nums");
    expect(css).not.toMatch(/text-decoration:\s*underline/);
    expect(css).not.toContain("!important");
  });
});

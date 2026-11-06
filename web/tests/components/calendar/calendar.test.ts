// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../../../src/sync/calendar";

const labelCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("../../../src/components/calendar/eventMeta", async (original) => {
  const real = await original<typeof import("../../../src/components/calendar/eventMeta")>();
  return { ...real, cellLabel: (...args: Parameters<typeof real.cellLabel>) => { labelCalls.n++; return real.cellLabel(...args); } };
});

import { CalendarAgenda } from "../../../src/components/calendar/CalendarAgenda";
import { CalendarExport, interviewsOf } from "../../../src/components/calendar/CalendarExport";
import { CalendarGrid } from "../../../src/components/calendar/CalendarGrid";
import { cellLabel, dayHeading, longDay } from "../../../src/components/calendar/eventMeta";
import { useMediaQuery } from "../../../src/components/calendar/useMediaQuery";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; el: HTMLElement }[] = [];
async function render(ui: ReactElement): Promise<{ el: HTMLElement; root: Root }> {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  mounted.push({ root, el });
  await act(async () => root.render(ui));
  return { el, root };
}
afterEach(async () => {
  for (const { root, el } of mounted.splice(0)) {
    await act(async () => root.unmount());
    el.remove();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const event = (o: Partial<CalendarEvent> & Pick<CalendarEvent, "kind" | "day">): CalendarEvent => ({
  key: `${o.kind}:${o.appId ?? 1}:${o.day}:${o.label ?? o.kind}`, appId: 1, company: "Acme", role: "Analyst", stage: "Interview", label: o.kind === "interview" ? "Interview" : o.kind, past: false, ...o,
});

describe("eventMeta", () => {
  it("writes a day out in full, and without the year for the agenda", () => {
    expect(longDay("2026-10-15")).toBe("Thursday, October 15, 2026");
    expect(longDay("2028-02-29")).toBe("Tuesday, February 29, 2028");
    expect(dayHeading("2026-12-31")).toBe("Thursday, December 31");
  });

  it("labels a cell with its date, the count and the distinct kinds in order", () => {
    const day = "2026-10-15";
    expect(cellLabel(day, [])).toBe("Thursday, October 15, 2026. No events");
    expect(cellLabel(day, [event({ kind: "interview", day }), event({ kind: "followUp", day, label: "Follow up due" })])).toBe("Thursday, October 15, 2026. 2 events: interview, follow up due");
    expect(cellLabel(day, [event({ kind: "interview", day, appId: 1 }), event({ kind: "interview", day, appId: 2 })])).toBe("Thursday, October 15, 2026. 2 events: interview");
    expect(cellLabel(day, [event({ kind: "followUp", day, label: "Follow up was due" })])).toBe("Thursday, October 15, 2026. 1 event: follow up was due");
    // a step's own name could be anything, so the label says "step"
    expect(cellLabel(day, [event({ kind: "step", day, label: "Phone screen" })])).toBe("Thursday, October 15, 2026. 1 event: step");
  });
});

describe("useMediaQuery", () => {
  function Probe({ query }: { query: string }) {
    return createElement("p", null, String(useMediaQuery(query)));
  }

  it("is false where the browser has no matchMedia", async () => {
    expect((window as { matchMedia?: unknown }).matchMedia).toBeUndefined();
    const { el } = await render(createElement(Probe, { query: "(max-width: 720px)" }));
    expect(el.textContent).toBe("false");
  });

  it("follows the query as it changes, and stops listening on unmount", async () => {
    let matches = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (media: string) => ({
      get matches() { return matches; }, media,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    const { el, root } = await render(createElement(Probe, { query: "(max-width: 720px)" }));
    expect(el.textContent).toBe("true");
    expect(listeners.size).toBe(1);
    matches = false;
    await act(async () => listeners.forEach((fn) => fn()));
    expect(el.textContent).toBe("false");
    await act(async () => root.unmount());
    expect(listeners.size).toBe(0);
    mounted.pop();
    el.remove();
  });
});

describe("the grid's cells", () => {
  const noop = () => {};
  const grid = (selected: string, events = new Map<string, readonly CalendarEvent[]>()) =>
    createElement(CalendarGrid, { month: "2026-11", today: "2026-11-05", selected, events, labelledBy: "t", onSelect: noop, onMonth: noop, gridRef: { current: null } });

  it("redraws only the cells whose own props changed", async () => {
    const events = new Map<string, readonly CalendarEvent[]>([["2026-11-10", [event({ kind: "interview", day: "2026-11-10" })]]]);
    labelCalls.n = 0;
    const { root } = await render(grid("", events));
    expect(labelCalls.n).toBe(42);
    labelCalls.n = 0;
    await act(async () => root.render(grid("2026-11-10", events)));   // one cell gains the selection (and the tab stop, which leaves today)
    expect(labelCalls.n).toBe(2);
    labelCalls.n = 0;
    await act(async () => root.render(grid("2026-11-12", events)));   // one loses it, one gains it
    expect(labelCalls.n).toBe(2);
    labelCalls.n = 0;
    await act(async () => root.render(grid("2026-11-12", events)));
    expect(labelCalls.n).toBe(0);
  });

  it("draws at most three chips and says how many more", async () => {
    const day = "2026-11-10";
    const many = [1, 2, 3, 4, 5].map((id) => event({ kind: "interview", day, appId: id, company: `Co ${id}` }));
    const { el } = await render(grid("", new Map([[day, many]])));
    const target = el.querySelector(`[data-day="${day}"]`)!;
    expect([...target.querySelectorAll(".cal-chip")].map((c) => c.textContent)).toEqual(["Co 1", "Co 2", "Co 3"]);
    expect(target.querySelector(".cal-more")!.textContent).toBe("+2 more");
    expect(target.getAttribute("aria-label")).toContain("5 events");
  });
});

describe("CalendarAgenda", () => {
  const events = new Map<string, readonly CalendarEvent[]>([
    ["2026-11-02", [event({ kind: "applied", day: "2026-11-02", label: "Applied", past: true, appId: 4 })]],
    ["2026-11-20", [event({ kind: "interview", day: "2026-11-20", appId: 5 }), event({ kind: "step", day: "2026-11-20", label: "Phone screen", appId: 6 })]],
    ["2026-12-01", [event({ kind: "interview", day: "2026-12-01", appId: 7 })]],
  ]);

  it("lists the month's days with events, today first, and leaves the neighbouring month out", async () => {
    const { el } = await render(createElement(CalendarAgenda, { month: "2026-11", today: "2026-11-05", events }));
    expect([...el.querySelectorAll("section")].map((s) => s.getAttribute("data-day"))).toEqual(["2026-11-05", "2026-11-02", "2026-11-20"]);
    expect(el.querySelectorAll("section ol")).toHaveLength(2);   // one list per day that has events
    expect([...el.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["#/app/4", "#/app/5", "#/app/6"]);
    expect(el.querySelector("h3")!.textContent).toBe("Today, Thursday, November 5");
    expect(el.querySelector(".cal-event-past")!.textContent).toBe("Past");
    expect(el.textContent).toContain("Phone screen");
  });

  it("starts at the first day with events when today is in another month", async () => {
    const { el } = await render(createElement(CalendarAgenda, { month: "2026-12", today: "2026-11-05", events }));
    expect([...el.querySelectorAll("section")].map((s) => s.getAttribute("data-day"))).toEqual(["2026-12-01"]);
  });
});

describe("CalendarExport", () => {
  it("keeps only the interviews and renders nothing without any", async () => {
    const day = "2026-11-10";
    const mixed = [event({ kind: "interview", day }), event({ kind: "followUp", day, appId: 2 }), event({ kind: "applied", day, appId: 3 }), event({ kind: "step", day, appId: 4 })];
    expect(interviewsOf(mixed)).toEqual([{ appId: 1, company: "Acme", role: "Analyst", stage: "Interview", day }]);
    const none = await render(createElement(CalendarExport, { events: mixed.slice(1), period: day, label: "Download" }));
    expect(none.el.querySelector("button")).toBeNull();
    const some = await render(createElement(CalendarExport, { events: mixed, period: day, label: "Download" }));
    expect(some.el.querySelector("button")!.textContent).toBe("Download");
  });
});

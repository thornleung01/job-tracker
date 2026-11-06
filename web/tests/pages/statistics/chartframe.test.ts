import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChartFrame } from "../../../src/pages/statistics/ChartFrame";

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

const KEYS = ["a", "b", "c"];
async function render() {
  root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(ChartFrame, {
        title: "Pace", note: "Best week: 3", keys: KEYS, table: createElement("table", { id: "t" }),
        children: (bind) => createElement("svg", { className: "chart" }, KEYS.map((k) => createElement("rect", { key: k, className: "mark-hit", ...bind(k, `tip ${k}`, `label ${k}`) }))),
      }),
    ),
  );
}
const marks = () => [...host.querySelectorAll<SVGElement>("[data-key]")];
const tip = () => host.querySelector<HTMLElement>(".tip")!;

describe("ChartFrame", () => {
  it("is a labelled card with a heading, a note and a closed table view", async () => {
    await render();
    const section = host.querySelector("section.card.viz-root")!;
    expect(section.getAttribute("aria-labelledby")).toBe(section.querySelector("h2")!.id);
    expect(section.querySelector("h2")!.textContent).toBe("Pace");
    expect(host.querySelector(".chart-note")!.textContent).toBe("Best week: 3");
    expect(host.querySelector<HTMLDetailsElement>("details")!.open).toBe(false);
    expect(host.querySelector("summary")!.textContent).toBe("Table view");
  });

  it("gives every mark a label and one tab stop, on the first", async () => {
    await render();
    expect(marks().map((m) => m.getAttribute("aria-label"))).toEqual(["label a", "label b", "label c"]);
    expect(marks().map((m) => m.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(marks().every((m) => m.getAttribute("role") === "img")).toBe(true);
  });

  it("shows the tooltip on hover and hides it on leave", async () => {
    await render();
    expect(tip().hidden).toBe(true);
    await act(async () => marks()[1].dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 10 })));
    expect(tip().hidden).toBe(false);
    expect(tip().textContent).toBe("tip b");
    await act(async () => marks()[1].dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    // React's onMouseLeave listens for mouseout leaving the element.
    await act(async () => marks()[1].dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));
    expect(tip().hidden).toBe(true);
  });

  it("shows the tooltip on focus, moves with the arrow keys and moves the tab stop with it", async () => {
    await render();
    await act(async () => marks()[0].focus());
    expect(tip().textContent).toBe("tip a");
    await act(async () => marks()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement).toBe(marks()[1]);
    expect(tip().textContent).toBe("tip b");
    expect(marks().map((m) => m.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    await act(async () => marks()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(document.activeElement).toBe(marks()[2]);
    await act(async () => marks()[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement).toBe(marks()[2]); // stops at the end
    await act(async () => marks()[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(document.activeElement).toBe(marks()[0]);
    await act(async () => marks()[0].blur());
    expect(tip().hidden).toBe(true);
  });
});

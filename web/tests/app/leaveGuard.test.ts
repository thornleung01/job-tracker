// The leave guard: what it stops, what it lets through, and the Shell's links asking it first.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blockLeave, registerLeaveGuard } from "../../src/app/leaveGuard";
import { Header } from "../../src/app/Shell";

const stops: (() => void)[] = [];
afterEach(() => {
  while (stops.length) stops.pop()!();
  window.location.hash = "";
});
const guard = (dirty: boolean) => {
  const g = { isDirty: vi.fn(() => dirty), onBlocked: vi.fn() };
  stops.push(registerLeaveGuard(g));
  return g;
};
const hashchange = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

describe("blockLeave", () => {
  it("lets everything through with no guard or nothing unsaved", () => {
    expect(blockLeave("#/people")).toBe(false);
    const g = guard(false);
    expect(blockLeave("#/people")).toBe(false);
    expect(g.onBlocked).not.toHaveBeenCalled();
  });

  it("stops a move to another page and tells the guard where it was going, but not a move within the page", () => {
    window.location.hash = "#/tailor/3";
    const g = guard(true);
    expect(blockLeave("#/tailor/3?baseline=2")).toBe(false);
    expect(blockLeave("#/people")).toBe(true);
    expect(g.onBlocked).toHaveBeenCalledWith("#/people");
  });

  it("stops guarding when the guard is stopped", () => {
    const stop = registerLeaveGuard({ isDirty: () => true, onBlocked: () => {} });
    stop();
    expect(blockLeave("#/people")).toBe(false);
  });
});

describe("a changed address", () => {
  it("is put back and handed to the guard when there is unsaved work", async () => {
    window.location.hash = "#/tailor/3";
    await hashchange();
    const g = guard(true);
    window.location.hash = "#/statistics";
    await hashchange();
    expect(window.location.hash).toBe("#/tailor/3");
    expect(g.onBlocked).toHaveBeenCalledWith("#/statistics");
  });

  it("is left alone when nothing is unsaved, and the page it moved to becomes the one that is guarded", async () => {
    window.location.hash = "#/tailor/3";
    await hashchange();
    const g = guard(false);
    window.location.hash = "#/statistics";
    await hashchange();
    expect(window.location.hash).toBe("#/statistics");
    expect(g.onBlocked).not.toHaveBeenCalled();
  });
});

describe("the Shell links", () => {
  async function clickLink(label: string, init: MouseEventInit = {}) {
    const box = document.createElement("div");
    document.body.append(box);
    const root = createRoot(box);
    await act(async () => root.render(createElement(Header, { page: "tailor" })));
    const link = [...box.querySelectorAll("a")].find((a) => a.textContent === label || a.getAttribute("aria-label") === label)!;
    // what the Shell's own handler decided, read once it has run; the click is then cancelled so jsdom doesn't follow the link
    let stopped = false;
    const see = (e: Event) => {
      stopped = e.defaultPrevented;
      e.preventDefault();
    };
    document.addEventListener("click", see);
    await act(async () => void link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init })));
    document.removeEventListener("click", see);
    await act(async () => root.unmount());
    box.remove();
    return stopped;
  }

  it("ask the guard and stay put while there is unsaved work", async () => {
    const g = guard(true);
    expect(await clickLink("People")).toBe(true);
    expect(g.onBlocked).toHaveBeenCalledWith("#/people");
    expect(await clickLink("Settings")).toBe(true);
    expect(g.onBlocked).toHaveBeenLastCalledWith("#/settings");
  });

  it("go through with nothing unsaved, and a new-tab click is never stopped", async () => {
    const g = guard(false);
    expect(await clickLink("People")).toBe(false);
    g.isDirty.mockReturnValue(true);
    expect(await clickLink("People", { ctrlKey: true })).toBe(false);
    expect(g.onBlocked).not.toHaveBeenCalled();
  });
});

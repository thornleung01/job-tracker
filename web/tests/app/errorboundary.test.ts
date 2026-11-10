// The error boundary shows its fallback when a page throws, and recovers when the address changes (resetKey) or Try again is pressed (retry).
import { createElement as h } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../src/app/ErrorBoundary";
import { cleanupRendered, q, render } from "./helpers";

afterEach(() => {
  cleanupRendered();
  vi.restoreAllMocks();
});
beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => undefined));

let broken = true;
const Page = () => {
  if (broken) throw new Error("boom");
  return h("p", { id: "page" }, "the page");
};
const fallback = (error: unknown, retry: () => void) => h("div", { id: "fallback" }, String((error as Error).message), h("button", { id: "retry", onClick: retry }, "Try again"));
const boundary = (resetKey: string) => h(ErrorBoundary, { resetKey, fallback }, h(Page));

describe("ErrorBoundary", () => {
  it("shows the fallback with the error, and logs it", async () => {
    broken = true;
    await render(boundary("/a"));
    expect(q("#fallback")!.textContent).toContain("boom");
    expect(q("#page")).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("stays on the fallback when the key is the same, and clears when the key changes (moving to another page)", async () => {
    broken = true;
    const view = await render(boundary("/a"));
    broken = false;
    await view.rerender(boundary("/a"));
    expect(q("#fallback")).not.toBeNull();
    await view.rerender(boundary("/b"));
    expect(q("#fallback")).toBeNull();
    expect(q("#page")!.textContent).toBe("the page");
  });

  it("Try again clears it without a new key; if the page still throws, the fallback returns", async () => {
    broken = true;
    await render(boundary("/a"));
    await act(async () => q<HTMLButtonElement>("#retry")!.click());
    expect(q("#fallback")).not.toBeNull();   // still broken
    broken = false;
    await act(async () => q<HTMLButtonElement>("#retry")!.click());
    expect(q("#fallback")).toBeNull();
    expect(q("#page")).not.toBeNull();
  });
});

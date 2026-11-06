import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GhostedTag } from "../../../src/components/ghosted/GhostedTag";
import { GhostedToggle } from "../../../src/components/ghosted/GhostedToggle";
import { GHOSTED_DAYS } from "../../../src/sync/followUp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let box: HTMLElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  box?.remove();
  root = box = null;
});
async function render(node: ReturnType<typeof h>): Promise<HTMLElement> {
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  await act(async () => root!.render(node));
  return box;
}

describe("GhostedTag", () => {
  it("says no reply in the number of days that makes a row ghosted", async () => {
    const c = await render(h(GhostedTag));
    expect(c.textContent).toBe(`No reply in ${GHOSTED_DAYS} days`);
    expect(c.querySelector(".ghosted-tag")).not.toBeNull();
  });
});

describe("GhostedToggle", () => {
  it("is a checkbox with a real label that reports each change", async () => {
    const onChange = vi.fn();
    const c = await render(h(GhostedToggle, { checked: false, onChange }));
    const input = c.querySelector("input") as HTMLInputElement;
    expect(c.querySelector("label[for=f-ghosted]")?.textContent).toBe("No reply");
    expect([input.type, input.checked]).toEqual(["checkbox", false]);
    await act(async () => input.click());
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

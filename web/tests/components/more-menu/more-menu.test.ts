import "fake-indexeddb/auto";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { MoreMenu } from "../../../src/components/detail/MoreMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = host = null;
});

const picked: string[] = [];
async function mount(disabled = false) {
  picked.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const items = ["First", "Second", "Third"].map((label) => ({ key: label, label, onSelect: () => void picked.push(label) }));
  await act(async () => root!.render(h("div", null, h("button", { id: "elsewhere" }, "Elsewhere"), h(MoreMenu, { items, disabled }))));
  return host;
}
const trigger = () => host!.querySelector<HTMLButtonElement>("button[aria-haspopup=menu]")!;
const items = () => [...host!.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
const press = (el: Element, key: string) => act(async () => void el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
const click = (el: Element) => act(async () => void (el as HTMLElement).click());

describe("MoreMenu", () => {
  it("is a labelled menu button that starts closed", async () => {
    await mount();
    expect(trigger().getAttribute("aria-label")).toBe("More actions");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().querySelector("svg.lucide-ellipsis")).not.toBeNull();
    expect(host!.querySelector("[role=menu]")).toBeNull();
  });

  it("opens on click with real menuitem buttons and focuses the first", async () => {
    await mount();
    await click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(host!.querySelector("[role=menu]")).not.toBeNull();
    expect(items().map((b) => b.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON"]);
    expect(document.activeElement).toBe(items()[0]);
  });

  it("opens with ArrowDown and ArrowUp on the button", async () => {
    await mount();
    await press(trigger(), "ArrowDown");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(items()[0]);
  });

  it("moves with the arrow keys, wrapping, and with Home and End", async () => {
    await mount();
    await click(trigger());
    await press(items()[0], "ArrowDown");
    expect(document.activeElement).toBe(items()[1]);
    await press(items()[1], "ArrowDown");
    await press(items()[2], "ArrowDown");
    expect(document.activeElement).toBe(items()[0]);
    await press(items()[0], "ArrowUp");
    expect(document.activeElement).toBe(items()[2]);
    await press(items()[2], "Home");
    expect(document.activeElement).toBe(items()[0]);
    await press(items()[0], "End");
    expect(document.activeElement).toBe(items()[2]);
  });

  it("closes on Escape and returns focus to the button", async () => {
    await mount();
    await click(trigger());
    await press(items()[1], "Escape");
    expect(host!.querySelector("[role=menu]")).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on a click outside, and on Tab", async () => {
    await mount();
    await click(trigger());
    await act(async () => void document.getElementById("elsewhere")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(host!.querySelector("[role=menu]")).toBeNull();
    await click(trigger());
    await press(items()[0], "Tab");
    expect(host!.querySelector("[role=menu]")).toBeNull();
  });

  it("stays open for a click inside the menu until an item is chosen", async () => {
    await mount();
    await click(trigger());
    await act(async () => void items()[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(host!.querySelector("[role=menu]")).not.toBeNull();
    await click(items()[1]);
    expect(picked).toEqual(["Second"]);
    expect(host!.querySelector("[role=menu]")).toBeNull();
  });

  it("toggles shut when the button is clicked again", async () => {
    await mount();
    await click(trigger());
    await click(trigger());
    expect(host!.querySelector("[role=menu]")).toBeNull();
  });

  it("does not open while disabled", async () => {
    await mount(true);
    expect(trigger().disabled).toBe(true);
    await click(trigger());
    expect(host!.querySelector("[role=menu]")).toBeNull();
  });
});

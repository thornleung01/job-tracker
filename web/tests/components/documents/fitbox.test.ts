// FitBox's first measure: the width decides the scale, and the height is read only once the sheet is at its real 8.5in width (the scaled class),
// so the box is the right height from the first paint and does not jump when the observer fires.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FitBox } from "../../../src/components/documents/FitBox";
import { SHEET_WIDTH_PX } from "../../../src/components/documents/onepage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The column is `column` px wide; the sheet is 900px tall at its real width but 2000px tall wrapped narrow (without the scaled class). */
function mount(column: number): HTMLElement {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(column);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("is-scaled") ? 900 : 2000;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(FitBox, { on: true, children: createElement("article", null, "sheet") })));
  return host;
}

describe("FitBox", () => {
  it("reads the height at the sheet's real width on the very first measure", () => {
    const h = mount(SHEET_WIDTH_PX / 2);
    const box = h.querySelector<HTMLElement>(".fit-box")!;
    expect(h.querySelector(".fit-inner")!.className).toBe("fit-inner is-scaled");
    expect(box.style.height).toBe("450px");
    expect((h.querySelector(".fit-inner") as HTMLElement).style.transform).toBe("scale(0.5)");
  });

  it("leaves a column as wide as the sheet alone", () => {
    const h = mount(SHEET_WIDTH_PX + 100);
    expect(h.querySelector(".fit-inner")!.className).toBe("fit-inner");
    expect((h.querySelector(".fit-box") as HTMLElement).style.height).toBe("");
  });

  it("leaves the sheet alone on a phone", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: /max-width: 720px/.test(q), addEventListener: () => undefined, removeEventListener: () => undefined }));
    const h = mount(300);
    expect(h.querySelector(".fit-inner")!.className).toBe("fit-inner");
  });
});

// What the browser would do that jsdom does not: the test runner empties imported CSS and jsdom has no layout, so focus() on an
// element a stylesheet hides (display: none) quietly works in a test and silently does nothing in a real browser.
// loadCss puts a component's real stylesheet in the document; isHidden asks the way a browser does; trackFocus records, at the moment of
// every focus() call, whether the element could actually take it.
import { vi } from "vitest";

const NODE_FS = "node:fs";

// the app tsconfig has no Node types; the tests run in Node, from the web folder
declare const process: { cwd(): string };

/** Adds the stylesheets at `paths` (relative to src/) to the document. Returns a function that takes them out again. */
export async function loadCss(...paths: string[]): Promise<() => void> {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync(path: string, enc: string): string };
  const style = document.createElement("style");
  style.textContent = paths.map((p) => fs.readFileSync(`${process.cwd()}/src/${p}`, "utf8")).join("\n");
  document.head.append(style);
  return () => style.remove();
}

/** True when the element, or anything around it, has display: none or the hidden attribute: a browser can't focus it or read it out. */
export function isHidden(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.hasAttribute("hidden") || getComputedStyle(n).display === "none") return true;
  }
  return false;
}

export interface FocusCall {
  el: Element;
  /** whether it was hidden at the moment focus() was called */
  hidden: boolean;
}

/** Records every focus() call with whether the element was hidden then. The spy is removed after the test (restoreMocks). */
export function trackFocus(): FocusCall[] {
  const calls: FocusCall[] = [];
  const real = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, ...args: Parameters<typeof real>) {
    calls.push({ el: this, hidden: isHidden(this) });
    return real.apply(this, args);
  });
  return calls;
}

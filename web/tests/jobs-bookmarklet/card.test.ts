import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookmarkletCard } from "../../src/components/BookmarkletCard";
import { buildBookmarkletSource } from "../../src/jobs/bookmarklet";
import { byText, cleanupRendered, click, q, render } from "../app/helpers";

afterEach(() => {
  cleanupRendered();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const expected = () => buildBookmarkletSource(window.location.origin + import.meta.env.BASE_URL);

describe("BookmarkletCard", () => {
  it("renders the section with a draggable link whose href is the javascript: source, set through the DOM", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warns = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await render(h(BookmarkletCard));
    expect(q("h2")?.textContent).toBe("Save jobs from any site");
    const link = byText("Save to Job Tracker", "a")!;
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe(expected());
    expect(link.getAttribute("href")!.startsWith("javascript:")).toBe(true);
    expect(link.getAttribute("draggable")).toBe("true");
    expect(document.body.textContent).toContain("Drag this to your bookmarks bar. Choosing it here does nothing.");
    expect(document.body.textContent).toContain("Your browser may ask to allow pop-ups the first time.");
    expect(document.querySelectorAll("ol li")).toHaveLength(3);
    expect(errors).not.toHaveBeenCalled();
    expect(warns).not.toHaveBeenCalled();
  });

  it("points the bookmarklet at this app (origin and base path)", async () => {
    await render(h(BookmarkletCard));
    const href = decodeURIComponent(byText("Save to Job Tracker", "a")!.getAttribute("href")!);
    expect(href).toContain(`"${window.location.origin}/job-tracker/\\x23/?"`);
  });

  it("does nothing when the link is clicked inside the page", async () => {
    await render(h(BookmarkletCard));
    const link = byText("Save to Job Tracker", "a")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("copies the source to the clipboard and says so", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await render(h(BookmarkletCard));
    await click(byText("Copy bookmarklet", "button")!);
    expect(writeText).toHaveBeenCalledWith(expected());
    expect(q("[role=status]")?.textContent).toMatch(/^Copied/);
  });

  it("says so when the clipboard is unavailable", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    await render(h(BookmarkletCard));
    await click(byText("Copy bookmarklet", "button")!);
    expect(q("[role=status]")?.textContent).toMatch(/Couldn't copy/);
  });

  it("has a real button as the keyboard path", async () => {
    await render(h(BookmarkletCard));
    const button = byText("Copy bookmarklet", "button")!;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
  });
});

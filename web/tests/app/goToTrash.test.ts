// @vitest-environment jsdom
// "Recently deleted" opens Settings, Data and scrolls the trash card (id "trash") into view.
import { afterEach, describe, expect, it, vi } from "vitest";
import { goToTrash } from "../../src/app/goToTrash";

afterEach(() => {
  document.body.innerHTML = "";
  window.location.hash = "";
});

describe("goToTrash", () => {
  it("goes to Settings, Data and scrolls to the trash card, focusing its heading", async () => {
    document.body.innerHTML = `<section id="trash"><h2 tabindex="-1">Recently deleted</h2></section>`;
    const scroll = vi.fn();
    document.getElementById("trash")!.scrollIntoView = scroll;
    goToTrash();
    expect(window.location.hash).toBe("#/settings/data");
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.textContent).toBe("Recently deleted");
  });

  it("waits for the card to appear", async () => {
    goToTrash();
    const scroll = vi.fn();
    document.body.innerHTML = `<section id="trash"><h2 tabindex="-1">Recently deleted</h2></section>`;
    document.getElementById("trash")!.scrollIntoView = scroll;
    await new Promise((r) => setTimeout(r, 200));
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});

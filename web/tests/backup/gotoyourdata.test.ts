import { afterEach, describe, expect, it, vi } from "vitest";
import { goToYourData } from "../../src/backup/goToYourData";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  window.location.hash = "";
});

describe("goToYourData", () => {
  it("opens Settings, Data and focuses the Back up heading", async () => {
    document.body.innerHTML = '<section id="data"><h2 tabindex="-1">Back up</h2></section>';
    goToYourData();
    expect(window.location.hash).toBe("#/settings/data");
    expect(document.activeElement).toBe(document.querySelector("#data h2"));
  });

  it("waits for the card to appear", async () => {
    goToYourData();
    document.body.innerHTML = '<section id="data"><h2 tabindex="-1">Back up</h2></section>';
    await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector("#data h2")));
  });
});

// The row of links at the top of Settings has one for every card you can act in, Recently deleted included, and each moves focus to its card's heading.
import "fake-indexeddb/auto";
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_USER } from "../../../src/app/localUser";
import { SettingsView } from "../../../src/pages/settings/SettingsPage";
import { byText, click, cleanupRendered, closeDbs, freshDb, q, render, waitFor } from "../../app/helpers";

afterEach(() => {
  cleanupRendered();
  closeDbs();
});

describe("Settings section links", () => {
  it("include Recently deleted, and it jumps to that card's heading", async () => {
    await render(h(SettingsView, { db: freshDb(), user: LOCAL_USER, params: {}, query: new URLSearchParams(), navigate: () => undefined }));
    await waitFor(() => q("#trash"));
    expect([...document.querySelectorAll("nav.sub a")].map((a) => a.textContent)).toEqual(["Email accounts", "Appearance", "Recently deleted", "Your data"]);
    Element.prototype.scrollIntoView = vi.fn();
    await click(byText("Recently deleted", "nav a")!);
    expect(document.activeElement).toBe(q("#h-trash"));
  });
});

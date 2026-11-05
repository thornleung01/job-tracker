import "fake-indexeddb/auto";
import { act, createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import type { PageProps } from "../../src/app/pageProps";
import type { PageLoaders } from "../../src/app/pages";
import { addApp } from "../pages/applications/harness";
import { byText, cleanupRendered, click, closeDbs, freshDb, q, render, waitFor } from "./helpers";

// The real application page behind the real router, so a route that keeps its component between two ids is caught.
const loaders: PageLoaders = {
  applications: async () => ({ default: (_p: PageProps) => h("h1", { className: "page" }, "Applications page") }),
  detail: () => import("../../src/pages/detail"),
};

const go = async (hash: string) => {
  await act(async () => {
    window.location.hash = hash;
    await new Promise((r) => setTimeout(r, 30));
  });
};
const heading = () => q("h1")!.textContent;
const mergeForm = () => q("select[aria-label='Merge into']");

async function openMergeForm() {
  await click(q("button[aria-label='More actions']")!);
  await click(byText("Merge into…", "[role=menuitem]")!);
  expect(mergeForm()).not.toBeNull();
}

async function start() {
  const db = freshDb();
  const acme = await addApp(db, "Acme");
  const beta = await addApp(db, "Beta");
  await addApp(db, "Gamma");   // a third, so the target still has someone to merge into
  await render(h(App, { local: true, loaders, openDb: () => db }));
  await waitFor(() => q("h1"));
  return { acme, beta };
}

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(() => {
  cleanupRendered();
  closeDbs();
});

describe("a route with a parameter", () => {
  it("opens the target without the merge form, and with focus on its own heading, after a merge", async () => {
    const { acme, beta } = await start();
    await go(`#/app/${acme}`);
    await waitFor(() => heading() === "Acme");
    await openMergeForm();
    await act(async () => {
      const select = mergeForm() as HTMLSelectElement;
      select.value = String(beta);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(byText("Merge applications", "button")!);
    await waitFor(() => window.location.hash === `#/app/${beta}` && heading() === "Beta");
    expect(mergeForm()).toBeNull();   // it was the other application's form
    expect(document.activeElement).toBe(q("h1"));
    expect(document.activeElement!.textContent).toBe("Beta");
  });

  it("gives each application its own state when you move between two", async () => {
    const { acme, beta } = await start();
    await go(`#/app/${acme}`);
    await waitFor(() => heading() === "Acme");
    await openMergeForm();
    await go(`#/app/${beta}`);
    await waitFor(() => heading() === "Beta");
    expect(mergeForm()).toBeNull();
    await go(`#/app/${acme}`);
    await waitFor(() => heading() === "Acme");
    expect(mergeForm()).toBeNull();   // and it isn't remembered on the way back either
  });

  it("does not flash Loading when moving between pages", async () => {
    const { acme } = await start();
    await go(`#/app/${acme}`);
    await waitFor(() => heading() === "Acme");
    const seen: string[] = [];
    const watch = new MutationObserver(() => seen.push(q("main")?.textContent ?? ""));
    watch.observe(q("main")!, { childList: true, subtree: true, characterData: true });
    await go("#/");
    await waitFor(() => heading() === "Applications page");
    watch.disconnect();
    expect(seen.some((t) => t === "Loading")).toBe(false);
  });
});

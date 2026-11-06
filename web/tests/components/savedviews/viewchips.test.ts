import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SaveViewForm } from "../../../src/components/savedviews/SaveViewForm";
import { ViewChips } from "../../../src/components/savedviews/ViewChips";
import { SAVED_VIEWS_MAX } from "../../../src/db/limits";
import type { SavedView, ViewFilters } from "../../../src/sync/savedViews";
import { createDbPool } from "../../support/db";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const pool = createDbPool("chips");

let root: Root | null = null;
let box: HTMLElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  box?.remove();
  root = box = null;
  pool.closeAll();
});
async function render(node: ReturnType<typeof h>): Promise<HTMLElement> {
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  await act(async () => root!.render(node));
  return box;
}

const view = (id: number, name: string, o: Partial<SavedView> = {}): SavedView => ({ id, name, stage: "Applied", q: "", account: 0, followUp: false, ghosted: false, sort: "", dir: "", ...o });
const filters = (o: Partial<ViewFilters> = {}): ViewFilters => ({ stage: "Applied", q: "", account: 0, followUp: false, ghosted: false, sort: "", dir: "", ...o });

describe("ViewChips", () => {
  const props = (views: SavedView[], currentUrl = "/") => ({
    db: pool.open(), views, currentUrl, urlFor: (v: SavedView) => `/?stage=${v.stage}&n=${v.id}`, navigate: vi.fn(), accountName: () => undefined,
  });

  it("renders nothing without views", async () => {
    const c = await render(h(ViewChips, props([])));
    expect(c.innerHTML).toBe("");
  });

  it("is a labelled list of links, one marked current, each with its own options button", async () => {
    const c = await render(h(ViewChips, props([view(1, "One"), view(2, "Two")], "/?stage=Applied&n=2")));
    expect(c.querySelector("nav")!.getAttribute("aria-label")).toBe("Saved views");
    const links = [...c.querySelectorAll<HTMLAnchorElement>("a.view-chip-link")];
    expect(links.map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")])).toEqual([
      ["One", "#/?stage=Applied&n=1", null], ["Two", "#/?stage=Applied&n=2", "true"],
    ]);
    expect([...c.querySelectorAll("button.view-chip-menu")].map((b) => b.getAttribute("aria-label"))).toEqual(["Options for One", "Options for Two"]);
  });

  it("goes to the view's address on a plain click", async () => {
    const p = props([view(1, "One")]);
    const c = await render(h(ViewChips, p));
    await act(async () => c.querySelector<HTMLAnchorElement>("a.view-chip-link")!.click());
    expect(p.navigate).toHaveBeenCalledWith("/?stage=Applied&n=1");
  });

  it("shows a name made of markup as plain text", async () => {
    const c = await render(h(ViewChips, props([view(1, "<script>alert(1)</script><b>x</b>")])));
    expect(c.querySelector("script, b")).toBeNull();
    expect(c.querySelector("a.view-chip-link")!.textContent).toBe("<script>alert(1)</script><b>x</b>");
  });
});

describe("SaveViewForm", () => {
  it("is labelled, focuses its field, and says what it will save", async () => {
    const c = await render(h(SaveViewForm, { db: pool.open(), filters: filters({ q: "acme" }), count: 0, onClose: vi.fn() }));
    expect(c.querySelector("section")!.getAttribute("aria-labelledby")).toBeTruthy();
    const input = c.querySelector("input[name=view_name]") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(c.querySelector("label")!.getAttribute("for")).toBe(input.id);
    expect(c.querySelector(".help")!.textContent).toBe("Saves: Stage: Applied, Search: acme.");
    expect(input.maxLength).toBe(40);
  });

  it("warns up front when the list is full", async () => {
    const c = await render(h(SaveViewForm, { db: pool.open(), filters: filters(), count: SAVED_VIEWS_MAX, onClose: vi.fn() }));
    expect(c.textContent).toContain("You can keep 12 saved views. Delete one to save another.");
  });
});

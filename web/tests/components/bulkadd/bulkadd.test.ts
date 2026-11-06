import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BulkAdd } from "../../../src/components/bulkadd/BulkAdd";
import { EMPTY_DRAFT, type JobDraft } from "../../../src/jobs/types";
import type { BulkAddDeps } from "../../../src/sync/bulkAdd";
import { isHidden, loadCss } from "../../support/browserview";
import { createDbPool } from "../../support/db";
import { quiesce as settle } from "../../support/helpers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const pool = createDbPool("bulkadd");

let root: Root | null = null;
let box: HTMLElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  box?.remove();
  root = box = null;
  pool.closeAll();
});

const fake = (o: Partial<BulkAddDeps> = {}): BulkAddDeps => ({
  parseJobUrl: (u) => (u.includes("jobs.example") ? { ...EMPTY_DRAFT, company: "Acme", role: "Analyst", url: u, guessed: { company: true, role: false } } : null),
  enrichJobDraft: async (d) => d,
  ...o,
});
async function render(deps: BulkAddDeps) {
  const db = pool.open();
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  await act(async () => root!.render(h(BulkAdd, { db, deps })));
  return { db, c: box };
}
const click = async (el: Element | null) => { await act(async () => (el as HTMLElement).click()); await act(async () => { await settle(30); }); };
const typeInto = async (el: HTMLTextAreaElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const btn = (c: HTMLElement, label: string) => [...c.querySelectorAll("button")].find((b) => b.textContent === label)!;

describe("BulkAdd with injected deps", () => {
  it("adds from the box using the deps it is handed, and says what happened", async () => {
    const parse = vi.fn(fake().parseJobUrl);
    const { db, c } = await render(fake({ parseJobUrl: parse }));
    await click(btn(c, "Add several links"));
    await typeInto(c.querySelector("textarea")!, "https://jobs.example/a\nhttps://other.example/b");
    await click(btn(c, "Add these"));
    expect(parse).toHaveBeenCalledTimes(2);
    expect(c.querySelector(".bulk-add-progress")!.textContent).toBe("Added 1. 1 couldn't be read: https://other.example/b.");
    expect((await db.applications.toArray()).map((a) => [a.company, a.role])).toEqual([["Acme", "Analyst"]]);
    expect(c.querySelectorAll(".bulk-add-results li").length).toBe(2);
  });

  it("aborts what is in flight when it goes away, and saves nothing more", async () => {
    let signal: AbortSignal | undefined;
    const enrich = vi.fn((d: JobDraft, o?: { signal?: AbortSignal }) => new Promise<JobDraft>((resolve) => {
      signal = o?.signal;
      o?.signal?.addEventListener("abort", () => resolve(d));
    }));
    const { db, c } = await render(fake({ enrichJobDraft: enrich }));
    await click(btn(c, "Add several links"));
    await typeInto(c.querySelector("textarea")!, "https://jobs.example/a");
    await click(btn(c, "Add these"));
    expect(signal?.aborted).toBe(false);
    await act(async () => root!.unmount());
    root = null;
    expect(signal?.aborted).toBe(true);
    await act(async () => { await settle(30); });
    expect(await db.applications.count()).toBe(0);
  });
});

describe("BulkAdd's progress and focus", () => {
  /** An enrich that waits until the test lets it finish. */
  function held() {
    const release: (() => void)[] = [];
    const enrich = (d: JobDraft) => new Promise<JobDraft>((resolve) => release.push(() => resolve(d)));
    return { enrich, finish: async () => { await act(async () => { release.splice(0).forEach((r) => r()); await settle(30); }); } };
  }

  it("keeps its status line on the page, not display: none, so the words that arrive in it are read out", async () => {
    const unload = await loadCss("styles/base.css", "components/bulkadd/bulkadd.css");
    try {
      const { c } = await render(fake());
      await click(btn(c, "Add several links"));
      const status = c.querySelector<HTMLElement>("[role=status]")!;
      expect(status.textContent).toBe("");
      expect(isHidden(status)).toBe(false);
      expect(status.id).toBe(c.querySelector("textarea")!.getAttribute("aria-describedby"));
    } finally {
      unload();
    }
  });

  it("keeps the box, Stop and the progress in reach when the toggle is pressed during a run", async () => {
    const wait = held();
    const { c } = await render(fake({ enrichJobDraft: wait.enrich }));
    const toggle = btn(c, "Add several links");
    await click(toggle);
    await typeInto(c.querySelector("textarea")!, "https://jobs.example/a");
    await click(btn(c, "Add these"));
    expect(c.querySelector("[role=status]")!.textContent).toBe("Adding 0 of 1");
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(btn(c, "Stop")).toBeDefined();
    expect(c.querySelector<HTMLElement>(".bulk-add-box")!.hidden).toBe(false);
    await wait.finish();
    expect(c.querySelector("[role=status]")!.textContent).toBe("Added 1.");
    // once it is over the toggle works again
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("moves focus to Stop while it works and back to Add these when it is done", async () => {
    const wait = held();
    const { c } = await render(fake({ enrichJobDraft: wait.enrich }));
    await click(btn(c, "Add several links"));
    await typeInto(c.querySelector("textarea")!, "https://jobs.example/a");
    const add = btn(c, "Add these");
    add.focus();
    await click(add);
    expect(document.activeElement).toBe(btn(c, "Stop"));
    await wait.finish();
    expect(btn(c, "Stop")).toBeUndefined();
    expect(document.activeElement).toBe(btn(c, "Add these"));
  });

  it("doesn't pull focus back when it was moved elsewhere during the run", async () => {
    const wait = held();
    const { c } = await render(fake({ enrichJobDraft: wait.enrich }));
    await click(btn(c, "Add several links"));
    await typeInto(c.querySelector("textarea")!, "https://jobs.example/a");
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    await click(btn(c, "Add these"));
    elsewhere.focus();
    await wait.finish();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
});

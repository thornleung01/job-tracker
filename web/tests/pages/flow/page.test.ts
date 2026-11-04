import "fake-indexeddb/auto";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FlowPage from "../../../src/pages/flow";
import { createApplication, upsertAccount } from "../../../src/db/repo";
import { saveSettings } from "../../../src/sync/settings";
import { iso } from "../../../src/db/time";
import type { Stage } from "../../../src/db/stages";
import type { JobTrackerDB } from "../../../src/db/schema";
import { closeAll, freshDb } from "../../sync/helpers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// vitest blanks stylesheets on import, so read the file itself. (No @types/node here, hence the computed specifier.)
async function readCss(): Promise<string> {
  const fs = await import(/* @vite-ignore */ "node" + ":fs");
  return fs.readFileSync(`${(globalThis as unknown as { process: { cwd(): string } }).process.cwd()}/src/pages/flow/flow.css`, "utf8");
}

const user = { iss: "https://accounts.google.com", sub: "1", provider: "google" } as const;
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

let root: Root | null = null;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
  await closeAll();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function app(db: JobTrackerDB, company: string, stage: Stage, ago = 5, account?: number) {
  const id = await createApplication(db, { company, companyKey: company.toLowerCase(), role: "Analyst", roleKey: "analyst", stage, when: daysAgo(ago) });
  if (account) {
    await db.emails.add({
      accountId: account, providerMsgId: `m-${id}`, threadId: null, receivedAt: daysAgo(ago), sender: null, subject: null, body: null, related: true,
      event: "applied", confidence: "high", applicationId: id, needsReview: false, webLink: null, bulk: false, hold: false, reason: null,
    });
  }
  return id;
}

async function render(db: JobTrackerDB, search = "", navigate = vi.fn()) {
  root = createRoot(host);
  await act(async () => root!.render(createElement(FlowPage, { db, user, params: {}, query: new URLSearchParams(search), navigate })));
  await settle();
  return navigate;
}
async function settle() {
  for (let i = 0; i < 30; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 15)); });
    if (host.querySelector("form")) return;
  }
}
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);

async function seed() {
  const db = freshDb();
  await app(db, "Acme", "Offer");
  await app(db, "Initech", "Rejected");
  await app(db, "Hooli", "Applied");
  return db;
}

describe("flow page: sentence", () => {
  it("says there is nothing to chart with no applications", async () => {
    await render(freshDb());
    expect(host.textContent).toContain("No applications to chart. Sync your mail, or add one on the Applications page.");
    expect(q("svg")).toBeNull();
    expect(q(".lede")).toBeNull();
  });

  it("writes the singular sentence for one application", async () => {
    const db = freshDb();
    await app(db, "Acme", "Applied");
    await render(db);
    expect(q(".lede")!.innerHTML).toContain("Of <strong>1</strong> application, ");
    expect(q(".lede")!.textContent).toBe("Of 1 application, 0 heard back (0%), 0 reached an interview, 0 led to offers and 0 were rejected.");
    expect(q(".stats")).toBeNull();
  });

  it("writes the plural sentence for many", async () => {
    await render(await seed());
    expect(q(".lede")!.innerHTML).toContain("Of <strong>3</strong> applications, ");
    expect(q(".lede")!.textContent).toBe("Of 3 applications, 2 heard back (67%), 0 reached an interview, 1 led to an offer and 1 was rejected.");
  });

  it("has no em dashes, uppercase transforms or tabular numbers in its own text and styles", async () => {
    await render(await seed());
    expect(host.textContent).not.toContain("—");
    const css = await readCss();
    expect(css).not.toMatch(/tabular-nums|uppercase|text-decoration:\s*underline/);
    expect(css).toContain(".viz-root .lbl { fill: var(--ink); font-size: 14px");
    expect(css).toContain(".viz-root .sub { fill: var(--ink2); font-size: 13px");
    // the stage colours are the shared map, not defined again here
    expect(css).not.toMatch(/--ord-\d|--good|--crit|--stage-[\w-]+:/);
    expect(css).toContain(':root[data-theme="dark"] .viz-root');
  });
});

describe("flow page: chart", () => {
  it("draws nodes with rounded bars, and the Lucide check and x on Offer and Rejected", async () => {
    await render(await seed());
    const rects = [...host.querySelectorAll("svg rect")];
    expect(rects).toHaveLength(5); // Applied, Heard back, No response yet, Offer, Rejected
    rects.forEach((r) => expect(r.getAttribute("rx")).toBe("2"));
    const icons = [...host.querySelectorAll("[data-icon]")];
    expect(icons.map((i) => i.getAttribute("data-icon")).sort()).toEqual(["check", "x"]);
    const paths = icons.flatMap((i) => [...i.querySelectorAll("path")].map((p) => p.getAttribute("d")));
    expect(paths).toContain("M20 6 9 17l-5-5");
    expect(paths).toContain("M18 6 6 18");
    expect(paths).toContain("m6 6 12 12");
    icons.forEach((i) => {
      expect(i.getAttribute("transform")).toContain(`scale(${16 / 24})`);
      expect(i.getAttribute("aria-hidden")).toBe("true");
    });
    expect(host.querySelectorAll(".node")).toHaveLength(host.querySelectorAll("svg rect").length);
  });

  it("gives each node and flow one keyboard stop with a spoken label", async () => {
    await render(await seed());
    const stops = [...host.querySelectorAll("svg [tabindex='0']")];
    const labels = stops.map((s) => s.getAttribute("aria-label"));
    expect(labels).toContain("Applied: 3 applications, 100% of all");
    expect(labels).toContain("Heard back to Offer: 1 application, 33% of all");
    expect(stops.every((s) => s.getAttribute("role") === "img")).toBe(true);
    expect(q("svg")!.getAttribute("role")).toBe("group");
  });

  it("shows a tooltip on hover, dims the other links, and hides on leave", async () => {
    await render(await seed());
    const applied = [...host.querySelectorAll(".node")].find((n) => n.getAttribute("aria-label")!.startsWith("Applied:"))!;
    await act(async () => { applied.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 50, clientY: 60 })); });
    const tip = q("#tip")!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe("Applied3 applications · 100% of allNext: Heard back 2, No response yet 1");
    expect(q("svg")!.classList.contains("dim")).toBe(true);
    expect(host.querySelectorAll(".link.hl").length).toBeGreaterThan(0);
    await act(async () => { applied.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })); });
    expect(tip.hidden).toBe(true);
    expect(q("svg")!.classList.contains("dim")).toBe(false);
  });

  it("shows a flow tooltip from keyboard focus and hides on blur", async () => {
    await render(await seed());
    const hit = [...host.querySelectorAll<SVGPathElement>(".hit[tabindex]")].find((h) => h.getAttribute("aria-label")!.startsWith("Heard back to Offer"))!;
    await act(async () => { hit.focus(); });
    expect(q("#tip")!.hidden).toBe(false);
    expect(q("#tip")!.textContent).toBe("Heard back → Offer1 application · 33% of all");
    expect(host.querySelectorAll(".link.hl").length).toBeGreaterThan(0);
    await act(async () => { hit.blur(); });
    expect(q("#tip")!.hidden).toBe(true);
  });

  it("on a phone, shows the swipe hint, opens the table, and pins the tooltip on tap", async () => {
    vi.stubGlobal("matchMedia", (m: string) => ({ matches: m.includes("720px"), media: m, addEventListener() {}, removeEventListener() {} }));
    await render(await seed());
    expect(q(".mobile-only")!.textContent).toContain("swipe sideways");
    expect(q<HTMLDetailsElement>("details")!.open).toBe(true);
    const node = q(".node")!;
    // hover does nothing on a phone
    await act(async () => { node.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 5 })); });
    expect(q("#tip")!.hidden).toBe(true);
    await act(async () => { node.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 5 })); });
    expect(q("#tip")!.hidden).toBe(false);
    await act(async () => { node.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 5 })); });
    expect(q("#tip")!.hidden).toBe(true);
    await act(async () => { node.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(q("#tip")!.hidden).toBe(false);
    await act(async () => { document.body.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(q("#tip")!.hidden).toBe(true);
  });

  it("keeps the table closed on a desktop", async () => {
    await render(await seed());
    expect(q<HTMLDetailsElement>("details")!.open).toBe(false);
  });
});

describe("flow page: table view", () => {
  it("lists stage, count and percent in a disclosure, numbers right-aligned", async () => {
    await render(await seed());
    expect(q("details > summary.disclosure")!.textContent).toBe("Table view");
    const [stages, links] = host.querySelectorAll("table");
    const rows = [...stages.querySelectorAll("tbody tr")].map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toContainEqual(["Applied", "3", "100%"]);
    expect(rows).toContainEqual(["Offer", "1", "33%"]);
    expect(rows).toContainEqual(["Rejected", "1", "33%"]);
    expect([...stages.querySelectorAll("thead th")].map((h) => h.textContent)).toEqual(["Stage", "Applications", "Share"]);
    expect([...stages.querySelectorAll("tbody tr")[0].children].slice(1).every((c) => c.className === "num")).toBe(true);
    const linkRows = [...links.querySelectorAll("tbody tr")].map((r) => [...r.children].map((c) => c.textContent));
    expect(linkRows).toContainEqual(["Applied", "Heard back", "2", "67%"]);
    expect(host.innerHTML).not.toContain("tabular");
  });
});

describe("flow page: filters", () => {
  it("lists accounts and periods, and applies both through the hash query", async () => {
    const db = await seed();
    await upsertAccount(db, "gmail", "me@gmail.com");
    const navigate = await render(db);
    const account = q<HTMLSelectElement>("select[name=account]")!;
    const days = q<HTMLSelectElement>("select[name=days]")!;
    expect([...account.options].map((o) => o.textContent)).toEqual(["All accounts", "me@gmail.com"]);
    expect([...days.options].map((o) => o.textContent)).toEqual(["All time", "Last 30 days", "Last 90 days", "Last 180 days"]);
    const set = (el: HTMLSelectElement, v: string) => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    await act(async () => { set(account, "1"); set(days, "90"); });
    await act(async () => { q<HTMLButtonElement>("form button.primary")!.click(); });
    expect(navigate).toHaveBeenCalledWith("/flow?account=1&days=90");
    expect(q("form button.primary")!.textContent).toBe("Apply");
  });

  it("filters by period from the query", async () => {
    const db = freshDb();
    await app(db, "Acme", "Applied", 5);
    await app(db, "Initech", "Applied", 200);
    await render(db, "days=30");
    expect(q(".lede")!.textContent).toMatch(/^Of 1 application, /);
    expect(q<HTMLSelectElement>("select[name=days]")!.value).toBe("30");
  });

  it("filters by account from the query, and says so when nothing matches", async () => {
    const db = freshDb();
    const a = await upsertAccount(db, "gmail", "a@gmail.com");
    const b = await upsertAccount(db, "outlook", "b@outlook.com");
    await app(db, "Acme", "Applied", 5, a);
    await app(db, "Initech", "Offer", 5, b);
    await app(db, "Hooli", "Rejected", 5, b);
    await render(db, `account=${b}`);
    expect(q(".lede")!.textContent).toMatch(/^Of 2 applications, /);
    expect(q<HTMLSelectElement>("select[name=account]")!.value).toBe(String(b));
    await act(async () => root!.unmount());
    root = null;
    host.replaceChildren();
    await render(db, "account=999");
    expect(host.textContent).toContain("No applications to chart for this filter.");
  });

  it("defaults the period to the one chosen in Settings, and ignores an unknown one", async () => {
    const db = freshDb();
    await app(db, "Acme", "Applied", 5);
    await app(db, "Initech", "Applied", 200);
    await saveSettings(db, "appearance", { flowDays: 30 });
    await render(db);
    expect(q<HTMLSelectElement>("select[name=days]")!.value).toBe("30");
    expect(q(".lede")!.textContent).toMatch(/^Of 1 application, /);
    await act(async () => root!.unmount());
    root = null;
    host.replaceChildren();
    await render(db, "days=0");
    expect(q(".lede")!.textContent).toMatch(/^Of 2 applications, /);
    await act(async () => root!.unmount());
    root = null;
    host.replaceChildren();
    await render(db, "days=7");
    expect(q<HTMLSelectElement>("select[name=days]")!.value).toBe("30");
  });
});

describe("flow page: share", () => {
  it("offers Save as image and Copy image, with a status line", async () => {
    await render(await seed());
    expect(q("#share-save")!.textContent).toBe("Save as image");
    expect(q("#share-copy")!.textContent).toBe("Copy image");
    expect(q("#share-native")).toBeNull();
    expect(q("#share-status")!.getAttribute("role")).toBe("status");
    expect(q(".share")!.textContent).toContain("no company names or email addresses");
  });

  it("says so, without throwing, where canvas is unavailable", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await render(await seed());
    await act(async () => { q<HTMLButtonElement>("#share-save")!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(q("#share-status")!.textContent).toBe("Couldn't make the image here. Try Save as image.");
    expect(q<HTMLButtonElement>("#share-save")!.disabled).toBe(false);
  });
});

describe("flow page: safety", () => {
  it("never uses company names or raw HTML anywhere in the page", async () => {
    const db = freshDb();
    const evil = `<img src=x onerror="window.__pwned=1">`;
    await app(db, evil, "Offer");
    await app(db, "</script><svg onload=1>", "Rejected");
    await render(db);
    expect(host.innerHTML).not.toContain("onerror");
    expect(host.innerHTML).not.toContain("<img");
    expect(host.textContent).not.toContain("<img");
    expect(host.querySelector("img")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(host.textContent).toContain("Of 2 applications");
  });

  it("builds the chart with React, not innerHTML", async () => {
    const sources = import.meta.glob<string>("../../../src/pages/flow/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(4);
    for (const [f, text] of Object.entries(sources)) {
      expect(text, f).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML/);
    }
  });
});

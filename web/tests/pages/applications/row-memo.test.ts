import { afterEach, describe, expect, it, vi } from "vitest";
import { $, $$, button, cleanup, click, freshDb, mountPage, settle, text, type, waitFor } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";

// Count how many times a row's role cell renders: it renders once per row render, so it shows how much of the table redraws.
const renders = vi.hoisted(() => ({ n: 0 }));
vi.mock("../../../src/components/quickedit/QuickRole", async (original) => {
  const real = await original<typeof import("../../../src/components/quickedit/QuickRole")>();
  return { ...real, QuickRole: (props: Parameters<typeof real.QuickRole>[0]) => { renders.n++; return real.QuickRole(props); } };
});

afterEach(cleanup);

async function mountMany(count: number) {
  const db = freshDb();
  await db.applications.bulkAdd(Array.from({ length: count }, (_, i) => ({
    company: `Co ${i}`, companyKey: `co${i}`, role: "Analyst", roleKey: "analyst", stage: "Applied" as const,
    stageAt: null, appliedAt: null, lastActivity: new Date(Date.now() - i * 60_000).toISOString(), locked: false, manual: false,
  })));
  const page = await mountPage(ApplicationsPage, db);
  await waitFor(() => $$(page.container, "tr.app-row").length === count);
  await settle(100);
  return page;
}

describe("the list's rows are memoised", () => {
  it("ticking one box redraws that row, not the table", async () => {
    const { container } = await mountMany(40);
    renders.n = 0;
    await click($(container, "input[aria-label='Select Co 3']"));
    await waitFor(() => ($(container, "input[aria-label='Select Co 3']") as HTMLInputElement).checked);
    expect(renders.n).toBeGreaterThan(0);
    expect(renders.n).toBeLessThanOrEqual(2);
  });

  it("typing in the add form redraws no rows", async () => {
    const { container } = await mountMany(40);
    await click(button(container, "Add application"));
    await waitFor(() => $(container, "#add-company") !== null);
    await settle(50);
    renders.n = 0;
    await type($(container, "#add-company"), "Acme");
    await type($(container, "#add-role"), "Analyst");
    expect(renders.n).toBe(0);
  });

  it("still opens a row from its name and from empty space, and ticking does not open it", async () => {
    const { container } = await mountMany(5);
    await click($(container, "input[aria-label='Select Co 1']"));
    expect($(container, "tr.panel-row:not([hidden])")).toBeNull();
    await click($(container, "a.expander[data-id]"));
    await waitFor(() => $(container, "tr.panel-row:not([hidden])") !== null);
    expect(text($(container, "tr.app-row.is-open"))).toContain("Co 0");
  });
});

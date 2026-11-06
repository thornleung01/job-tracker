import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WeeklyGoal } from "../../../src/components/goal/WeeklyGoal";
import { setGoal } from "../../../src/sync/goal";
import { createDbPool } from "../../support/db";
import { quiesce as settle } from "../../support/helpers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const pool = createDbPool("goal");

let root: Root | null = null;
let box: HTMLElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  box?.remove();
  root = box = null;
  pool.closeAll();
});

async function render(db: ReturnType<typeof pool.open>): Promise<HTMLElement> {
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  await act(async () => root!.render(h(WeeklyGoal, { db })));
  await act(async () => { await settle(30); });
  return box;
}

describe("WeeklyGoal on its own", () => {
  it("is a labelled section with only a quiet button until a goal is set", async () => {
    const c = await render(pool.open());
    expect(c.querySelector("section")!.getAttribute("aria-label")).toBe("Weekly goal");
    expect(c.querySelector("[role=progressbar]")).toBeNull();
    expect([...c.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Set a weekly goal"]);
  });

  it("shows a progressbar with numbers, a label and a text alternative once a goal is set", async () => {
    const db = pool.open();
    await setGoal(db, 7);
    const c = await render(db);
    const bar = c.querySelector("[role=progressbar]")!;
    expect([bar.getAttribute("aria-valuemin"), bar.getAttribute("aria-valuemax"), bar.getAttribute("aria-valuenow")]).toEqual(["0", "7", "0"]);
    expect(bar.getAttribute("aria-valuetext")).toBe("0 of 7 applications this week");
    expect(c.querySelector(".weekly-goal-line")!.textContent).toContain("This week: 0 of 7 applications");
    expect(document.getElementById(bar.getAttribute("aria-labelledby")!)).not.toBeNull();
  });
});

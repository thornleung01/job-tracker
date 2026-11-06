import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CompareOffers } from "../../../src/components/offers/CompareOffers";
import { createApplication } from "../../../src/db/repo";
import { createDbPool } from "../../support/db";
import { quiesce as settle } from "../../support/helpers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const pool = createDbPool("offers");

let root: Root | null = null;
let box: HTMLElement | null = null;
beforeEach(() => sessionStorage.clear());
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
  await act(async () => root!.render(h(CompareOffers, { db })));
  await act(async () => { await settle(30); });
  return box;
}
const offer = (db: ReturnType<typeof pool.open>, company: string) =>
  createApplication(db, { company, companyKey: company.toLowerCase(), role: "R", roleKey: "r", stage: "Offer", when: "2026-10-20T12:00:00Z" });

describe("CompareOffers on its own", () => {
  it("renders nothing for one offer", async () => {
    const db = pool.open();
    await offer(db, "Solo");
    expect((await render(db)).innerHTML).toBe("");
  });

  it("starts collapsed, with the toggle wired to its region, and opens on click", async () => {
    const db = pool.open();
    await offer(db, "One");
    await offer(db, "Two");
    const c = await render(db);
    const toggle = c.querySelector("button")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(c.querySelector(`#${toggle.getAttribute("aria-controls")}`)).not.toBeNull();
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(c.querySelectorAll("tbody tr").length).toBe(2);
    expect(sessionStorage.getItem(`jobtracker:offers-open:${db.name}`)).toBe("1");
  });

  it("still works when session storage is blocked", async () => {
    const db = pool.open();
    await offer(db, "One");
    await offer(db, "Two");
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error("blocked"); };
    try {
      const c = await render(db);
      expect(c.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
    } finally {
      Storage.prototype.getItem = real;
    }
  });
});

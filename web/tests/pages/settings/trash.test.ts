// Settings > Recently deleted: Restore, Delete now (asks first, Escape puts focus back), Empty recently deleted.
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Lets one test say what another tab did in the meantime: "already restored" or "already erased". Unset, the real functions run.
const otherTab = vi.hoisted(() => ({ restored: false, erased: false }));
vi.mock("../../../src/sync/trash", async (original) => {
  const real = await original<typeof import("../../../src/sync/trash")>();
  return {
    ...real,
    restoreApplication: async (...args: Parameters<typeof real.restoreApplication>) => (otherTab.restored ? false : real.restoreApplication(...args)),
    deleteForever: async (...args: Parameters<typeof real.deleteForever>) => (otherTab.erased ? false : real.deleteForever(...args)),
  };
});
import { $, $$, addApp, addMail, button, cleanup, click, freshDb, key, mountPage, text, waitFor } from "../applications/harness";
import type { PageProps } from "../../../src/app/pageProps";
import { TrashSection } from "../../../src/pages/settings/TrashSection";
import { deleteApplication } from "../../../src/sync/actions";
import { upsertAccount } from "../../../src/db/repo";
import { DAY_MS } from "../../../src/db/time";
import { isHidden, loadCss, trackFocus } from "../../support/browserview";

afterEach(async () => {
  otherTab.restored = otherTab.erased = false;
  vi.restoreAllMocks();
  await cleanup();
});

const Page = (p: PageProps) => createElement(TrashSection, { db: p.db });

async function setup() {
  const db = freshDb();
  const account = await upsertAccount(db, "gmail", "me@gmail.com");
  const acme = await addApp(db, "Acme", { role: "Analyst", stage: "Interview" });
  const beta = await addApp(db, "Beta", { role: "Engineer", stage: "Applied" });
  const mail = await addMail(db, account, acme);
  await db.activity.add({ applicationId: acme, kind: "note", label: null, body: "Called", occurredAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" });
  await deleteApplication(db, acme, "clear", new Date(Date.now() - 3 * DAY_MS));
  await deleteApplication(db, beta, "clear", new Date(Date.now() - 20 * DAY_MS));
  return { db, acme, beta, mail };
}
const rows = (c: HTMLElement) => $$(c, ".trash-row");
const rowOf = (c: HTMLElement, company: string) => rows(c).find((r) => text($(r, ".trash-company")) === company)!;

describe("Recently deleted", () => {
  it("lists each deleted application with its role, stage, how long ago and how long is left", async () => {
    const { db } = await setup();
    const { container } = await mountPage(Page, db);
    expect($(container, "section#trash h2")?.textContent).toBe("Recently deleted");
    const parts = (r: Element) => [text($(r, ".trash-company")), text($(r, ".trash-role")), text($(r, ".badge")), text($(r, ".trash-when")), $$(r, "button").map(text)];
    expect(rows(container).map(parts)).toEqual([
      ["Acme", "Analyst", "Interview", "Deleted 3 days ago · 27 days left", ["Restore", "Delete now"]],
      ["Beta", "Engineer", "Applied", "Deleted 20 days ago · 10 days left", ["Restore", "Delete now"]],
    ]);
    expect(button(container, "Empty recently deleted")).not.toBeNull();
  });

  it("says so when nothing is deleted", async () => {
    const db = freshDb();
    await addApp(db, "Live");
    const { container } = await mountPage(Page, db);
    expect(rows(container)).toHaveLength(0);
    expect(text($(container, "section#trash"))).toContain("Nothing deleted.");
    expect(button(container, "Empty recently deleted")).toBeNull();
  });

  it("restores one with its emails and notes, tells you, and moves focus to the result", async () => {
    const { db, acme, mail } = await setup();
    const { container } = await mountPage(Page, db);
    await click($(rowOf(container, "Acme"), "button[aria-label='Restore Acme']"));
    await waitFor(() => rows(container).length === 1, "the row to go");
    expect(text($(container, ".notice"))).toBe("Restored Acme.");
    expect(document.activeElement).toBe($(container, ".notice"));
    expect(await db.applications.get(acme)).not.toHaveProperty("deletedAt");
    expect((await db.emails.get(mail))?.applicationId).toBe(acme);
    expect(await db.activity.count()).toBe(1);
  });

  it("asks before Delete now, starting on Cancel, and Escape closes it with focus back on the button", async () => {
    const { db, acme, mail } = await setup();
    const { container } = await mountPage(Page, db);
    const opener = $(rowOf(container, "Acme"), "button[aria-label='Delete Acme now']") as HTMLElement;
    await click(opener);
    const ask = $(container, ".inline-confirm")!;
    expect(text($(ask, ".inline-confirm-q"))).toBe("Delete Acme now?");
    expect(text($(ask, ".help"))).toContain("This can't be undone.");
    expect(document.activeElement).toBe(button(ask, "Cancel"));
    expect(await db.applications.get(acme)).toBeDefined();
    await key(ask, "Escape");
    expect($(container, ".inline-confirm")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect((await db.emails.get(mail))?.subject).not.toBeNull();
  });

  it("erases for good once confirmed: the application, its notes, and every email's content", async () => {
    const { db, acme, beta, mail } = await setup();
    const { container } = await mountPage(Page, db);
    await click($(rowOf(container, "Acme"), "button[aria-label='Delete Acme now']"));
    await click(button($(container, ".inline-confirm")!, "Delete now"));
    await waitFor(() => rows(container).length === 1, "the row to go");
    expect(text($(container, ".notice"))).toBe("Deleted Acme for good.");
    expect(document.activeElement).toBe($(container, ".notice"));
    expect(await db.applications.get(acme)).toBeUndefined();
    expect(await db.activity.count()).toBe(0);
    const kept = await db.emails.get(mail);
    expect([kept?.applicationId, kept?.subject, kept?.body]).toEqual([null, null, null]);
    expect(await db.applications.get(beta)).toBeDefined();
  });

  it("asks before emptying, and Escape leaves everything in place", async () => {
    const { db, acme, beta } = await setup();
    const { container } = await mountPage(Page, db);
    const opener = button(container, "Empty recently deleted")!;
    await click(opener);
    const ask = $(container, ".inline-confirm")!;
    expect(text($(ask, ".inline-confirm-q"))).toBe("Delete 2 applications for good?");
    expect(document.activeElement).toBe(button(ask, "Cancel"));
    await key(ask, "Escape");
    expect($(container, ".inline-confirm")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(rows(container)).toHaveLength(2);
    expect(await db.applications.get(acme)).toBeDefined();
    expect(await db.applications.get(beta)).toBeDefined();
  });

  it("empties everything once confirmed", async () => {
    const { db, mail } = await setup();
    const live = await addApp(db, "Live");
    const { container } = await mountPage(Page, db);
    await click(button(container, "Empty recently deleted"));
    await click(button($(container, ".inline-confirm")!, "Empty recently deleted"));
    await waitFor(() => rows(container).length === 0, "the list to empty");
    expect(text($(container, ".notice"))).toBe("Deleted 2 applications for good.");
    expect((await db.applications.toArray()).map((a) => a.id)).toEqual([live]);
    expect((await db.emails.get(mail))?.subject).toBeNull();
    expect(text($(container, "section#trash"))).toContain("Nothing deleted.");
  });

  it("gives focus to a result a browser can really focus: nothing hidden by the stylesheet when focus() is called", async () => {
    const unload = await loadCss("styles/base.css", "pages/settings/trash.css");
    try {
      const focused = trackFocus();
      const { db } = await setup();
      const { container } = await mountPage(Page, db);
      // there is no empty result box that the stylesheet would hide
      for (const el of $$(container, "[role=status], .notice")) expect(isHidden(el), el.className).toBe(false);
      await click($(rowOf(container, "Acme"), "button[aria-label='Restore Acme']"));
      await waitFor(() => rows(container).length === 1, "the row to go");
      const result = $(container, ".notice")!;
      expect(text(result)).toBe("Restored Acme.");
      expect(document.activeElement).toBe(result);
      const last = focused.filter((c) => c.el === result).at(-1);
      expect(last, "focus() was called on the result").toBeDefined();
      expect(last!.hidden, "the result was hidden when focus() was called").toBe(false);
      expect(isHidden(result)).toBe(false);
    } finally {
      unload();
    }
  });

  it("says so, not that it worked, when the application was already restored or erased in another tab", async () => {
    const { db, acme, beta } = await setup();
    const { container } = await mountPage(Page, db);
    otherTab.restored = true;
    await click($(rowOf(container, "Acme"), "button[aria-label='Restore Acme']"));
    expect(text($(container, ".notice"))).toBe("Acme was already restored.");
    otherTab.erased = true;
    await click($(rowOf(container, "Beta"), "button[aria-label='Delete Beta now']"));
    await click(button($(container, ".inline-confirm")!, "Delete now"));
    expect(text($(container, ".notice"))).toBe("Beta is no longer in Recently deleted.");
    expect(await db.applications.get(beta)).toBeDefined();
    expect(await db.applications.get(acme)).toBeDefined();
  });

  it("tells you when it can't restore, and keeps the row", async () => {
    const { db, acme } = await setup();
    const { container } = await mountPage(Page, db);
    await db.applications.delete(acme);   // erased by another tab while this one was open
    await click($(rowOf(container, "Acme"), "button[aria-label='Restore Acme']"));
    expect(text($(container, ".notice.err"))).toBe("That no longer exists. Go back to the list and try again.");
  });
});

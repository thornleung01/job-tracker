// After a delete, a line says where it went with a Restore button for a few seconds; the page of a deleted application says so.
import "fake-indexeddb/auto";
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, $$, addApp, addMail, button, cleanup, click, freshDb, mountPage, text, waitFor } from "../applications/harness";
import type { PageProps } from "../../../src/app/pageProps";
import { dismissNotice } from "../../../src/components/trash/deletedNotice";
import { TrashHost } from "../../../src/components/trash/TrashHost";
import ApplicationsPage from "../../../src/pages/applications";
import DetailPage from "../../../src/pages/detail";
import { upsertAccount } from "../../../src/db/repo";
import type { JobTrackerDB } from "../../../src/db/schema";
import { deleteApplication } from "../../../src/sync/actions";

// Restore stays for 8 s in the app. One test shortens it to see it go; the others keep the real length.
const undo = vi.hoisted(() => ({ ms: 8000 }));
vi.mock("../../../src/components/undo", () => ({ get UNDO_MS() { return undo.ms; } }));

const extra: Root[] = [];
afterEach(async () => {
  undo.ms = 8000;
  for (const r of extra.splice(0)) await act(async () => r.unmount());
  dismissNotice();
  vi.useRealTimers();
  await cleanup();
});
beforeEach(() => dismissNotice());

/** The page, as the router mounts it, with the signed-in shell's TrashHost beside it. */
async function mountWithHost(Page: ComponentType<PageProps>, db: JobTrackerDB, to: string, params: Record<string, string> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  extra.push(root);
  await act(async () => root.render(createElement(TrashHost, { db })));
  const page = await mountPage(Page, db, to, params);
  return { ...page, host };
}
const noticeText = (host: HTMLElement) => text($(host, ".trash-notice .notice"));

async function setup() {
  const db = freshDb();
  const account = await upsertAccount(db, "gmail", "me@gmail.com");
  const acme = await addApp(db, "Acme", { role: "Analyst", stage: "Applied" });
  const beta = await addApp(db, "Beta", { role: "Engineer", stage: "Applied" });
  const mail = await addMail(db, account, acme);
  return { db, acme, beta, mail };
}

describe("Restore after deleting from a list row's panel", () => {
  it("shows what happened with Restore, which brings the application back with its emails", async () => {
    const { db, acme, mail } = await setup();
    const { container, host } = await mountWithHost(ApplicationsPage, db, `/?open=${acme}`);
    await click(button($(container, `#panel-${acme}`)!, "Delete application"));
    await click(button($(container, `#panel-${acme} .inline-confirm`)!, "Delete application"));
    await waitFor(() => !$(container, `#panel-${acme}`));
    expect(noticeText(host)).toBe("Deleted Acme. It stays in Recently deleted for 30 days.");
    expect($$(container, "tr.app-row")).toHaveLength(1);
    await click(button(host, "Restore"));
    await waitFor(() => $$(container, "tr.app-row").length === 2, "the row to come back");
    expect(noticeText(host)).toBe("Restored Acme.");
    expect(button(host, "Restore")).toBeNull();
    expect((await db.emails.get(mail))?.applicationId).toBe(acme);
    expect(await db.applications.get(acme)).not.toHaveProperty("deletedAt");
  });

  it("takes Restore away after 8 seconds (the application is still in Recently deleted)", async () => {
    undo.ms = 150;
    const { db, acme } = await setup();
    const { container, host } = await mountWithHost(ApplicationsPage, db, `/?open=${acme}`);
    // On a slow machine the line can come and go between two polls, so watch for it instead of polling.
    let shown = false;
    const watcher = new MutationObserver(() => {
      if (noticeText(host) !== "") shown = true;
    });
    watcher.observe(host, { childList: true, subtree: true, characterData: true });
    await click(button($(container, `#panel-${acme}`)!, "Delete application"));
    await click(button($(container, `#panel-${acme} .inline-confirm`)!, "Delete application"));
    await waitFor(() => shown || noticeText(host) !== "");
    await waitFor(() => $(host, ".trash-notice") === null, "the line to go");
    watcher.disconnect();
    expect(shown).toBe(true);
    expect((await db.applications.get(acme))?.deletedAt).toBeDefined();
  });

  it("says so when it can't restore because the application was erased meanwhile", async () => {
    const { db, acme } = await setup();
    const { container, host } = await mountWithHost(ApplicationsPage, db, `/?open=${acme}`);
    await click(button($(container, `#panel-${acme}`)!, "Delete application"));
    await click(button($(container, `#panel-${acme} .inline-confirm`)!, "Delete application"));
    await waitFor(() => noticeText(host) !== "");
    await db.applications.delete(acme);
    await click(button(host, "Restore"));
    expect(noticeText(host)).toBe("That no longer exists. Go back to the list and try again.");
  });
});

describe("Restore after deleting from the detail page", () => {
  it("goes to the list and shows the line with Restore", async () => {
    const { db, acme } = await setup();
    const { container, host, visited } = await mountWithHost(DetailPage, db, `/app/${acme}`, { id: String(acme) });
    await click($(container, "button[aria-label='More actions']"));
    await click($$(container, "[role=menuitem]").find((b) => text(b) === "Delete application") ?? null);
    await click(button($(container, ".inline-confirm")!, "Delete application"));
    await waitFor(() => visited.at(-1) === "/", "the page to go to the list");
    await waitFor(() => noticeText(host) !== "");
    expect(visited.at(-1)).toBe("/");
    expect(noticeText(host)).toBe("Deleted Acme. It stays in Recently deleted for 30 days.");
    expect(button(host, "Restore")).not.toBeNull();
  });

  it("says nothing when it removes the application for good", async () => {
    const { db, acme } = await setup();
    const { container, host } = await mountWithHost(DetailPage, db, `/app/${acme}`, { id: String(acme) });
    await click($(container, "button[aria-label='More actions']"));
    await click($$(container, "[role=menuitem]").find((b) => text(b) === "Delete application") ?? null);
    await click(button($(container, ".inline-confirm")!, "Delete for good, keep emails in Needs review"));
    expect($(host, ".trash-notice")).toBeNull();
  });
});

describe("the page of a deleted application", () => {
  it("says it was deleted, shows what is left, and Restore brings the full page back", async () => {
    const { db, acme, mail } = await setup();
    await deleteApplication(db, acme, "clear");
    const { container } = await mountPage(DetailPage, db, `/app/${acme}`, { id: String(acme) });
    expect(text($(container, "h1"))).toBe("This application was deleted");
    expect(text($(container, "p.muted"))).toBe("Acme · Analyst. It stays in Recently deleted for 30 more days.");
    expect($(container, "a.btn[href='#/settings/data']")).not.toBeNull();
    expect($(container, "h2#h-notes")).toBeNull();   // none of the application's own page
    await click(button(container, "Restore"));
    await waitFor(() => text($(container, "h1")) === "Acme", "the page to come back");
    expect(text($(container, ".notice"))).toBe("Restored Acme.");
    expect(document.activeElement).toBe($(container, ".notice"));
    expect($$(container, "article.card")).toHaveLength(1);
    expect((await db.emails.get(mail))?.applicationId).toBe(acme);
  });

  it("is still 'Application not found' for an id that was never there or was erased", async () => {
    const { db, acme } = await setup();
    await deleteApplication(db, acme, "review");
    for (const id of [acme, 999]) {
      const { container } = await mountPage(DetailPage, db, `/app/${id}`, { id: String(id) });
      expect(text($(container, "h1"))).toBe("Application not found");
    }
  });
});

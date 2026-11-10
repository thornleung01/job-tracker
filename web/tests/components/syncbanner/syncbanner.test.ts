import "fake-indexeddb/auto";
import { act, createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_USER } from "../../../src/app/localUser";
import { POPUP_HINT } from "../../../src/auth/google";
import { SyncBanner, type SyncBannerDeps } from "../../../src/components/SyncBanner";
import { deactivateAccount, listAccounts, upsertAccount } from "../../../src/db/repo";
import type { JobTrackerDB } from "../../../src/db/schema";
import { forgetConnections } from "../../../src/pages/settings/actions";
import { isSyncing, tryAcquire } from "../../../src/sync/syncLock";
import { NotConnected, type MailProvider, type Message, type ProviderName } from "../../../src/types";
import { mk } from "../../sync/helpers";
import { ada, byText, click, cleanupRendered, closeDbs, fakeAuth, freshDb, q, render, settle, waitFor } from "../../app/helpers";

beforeEach(forgetConnections);
afterEach(() => {
  cleanupRendered();
  closeDbs();
});

const MESSAGES: Message[] = [mk("m1", "Thanks for applying to Acme"), mk("m2", "Your weekly digest", "hello", "News <news@example.org>")];

interface Opts {
  local?: boolean;
  connectMail?: (p: ProviderName) => Promise<void>;
  /** called when the provider starts fetching; resolve the returned promise to let it finish */
  gate?: Promise<void>;
  accounts?: [ProviderName, string][];
  /** the mailbox the login just connected (what takePendingSync returns, once) */
  pending?: ProviderName | null;
  autoStart?: boolean;
  quiet?: boolean;
  addressFails?: boolean;
  /** accounts to switch off before the banner mounts */
  inactive?: [ProviderName, string][];
}

async function setup(opts: Opts = {}) {
  const db: JobTrackerDB = freshDb();
  for (const [p, a] of opts.accounts ?? [["gmail", "me@gmail.com"]]) await upsertAccount(db, p, a);
  for (const [p, a] of opts.inactive ?? []) await deactivateAccount(db, await upsertAccount(db, p, a));
  const fake = fakeAuth({ status: "signed-in", user: ada });
  fake.pending.value = opts.pending ?? null;
  // The login already stored the token: the session says the mailbox is connected, with no window needed.
  if (opts.pending) await fake.set({ mail: { ...fake.auth.getSession().mail, [opts.pending]: true } });
  const connectMail = vi.fn(
    opts.connectMail ??
      (async (p: ProviderName) => {
        await fake.set({ mail: { ...fake.auth.getSession().mail, [p]: true } });
      }),
  );
  const createProvider = vi.fn((name: ProviderName): MailProvider => ({
    name,
    address: null,
    async *fetch() {
      await opts.gate;
      yield* MESSAGES;
    },
  }));
  const deps: SyncBannerDeps = {
    auth: { getSession: fake.auth.getSession, subscribe: fake.auth.subscribe, connectMail, tokenSource: vi.fn(async () => "token"), takePendingSync: fake.auth.takePendingSync },
    createProvider: createProvider as unknown as SyncBannerDeps["createProvider"],
    getAddress: vi.fn(async (p: ProviderName) => (opts.addressFails ? Promise.reject(new Error("offline")) : p === "gmail" ? "me@gmail.com" : "me@outlook.com")),
  };
  const view = await render(h(SyncBanner, { db, user: opts.local ? LOCAL_USER : ada, deps, autoStart: opts.autoStart, quiet: opts.quiet }));
  await settle(40);
  const rerender = (autoStart: boolean, quiet = opts.quiet) => view.rerender(h(SyncBanner, { db, user: opts.local ? LOCAL_USER : ada, deps, autoStart, quiet }));
  return { db, deps, connectMail, createProvider, fake, rerender, view };
}

const banner = () => q(".sync-banner");
const primary = () => byText("Reconnect and sync", "button") as HTMLButtonElement | null;

describe("SyncBanner", () => {
  it("shows nothing when there are no accounts", async () => {
    await setup({ accounts: [] });
    expect(banner()).toBeNull();
  });

  it("shows nothing in local mode, even with an account", async () => {
    await setup({ local: true });
    expect(banner()).toBeNull();
  });

  it("shows nothing when the only account is switched off", async () => {
    const { db } = await setup();
    const [a] = await listAccounts(db);
    expect(banner()).not.toBeNull();      // it shows while the account is on, so the check below is about switching it off
    await act(async () => {
      await deactivateAccount(db, a.id);
    });
    await waitFor(() => banner() === null);
  });

  it("shows one primary button when an account is not connected in this tab", async () => {
    await setup();
    const el = banner()!;
    expect(el.getAttribute("role")).toBe("status");
    expect(el.classList.contains("notice")).toBe(true);
    expect(el.textContent).toContain("Reconnect to sync your mailbox.");
    expect(el.querySelector("a")!.getAttribute("href")).toBe("#/settings/mail");
    const buttons = Array.from(el.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Reconnect and sync"]);
    expect(buttons[0].classList.contains("primary")).toBe(true);
    expect(el.textContent).not.toMatch(/[–—]/);
  });

  it("connects and syncs in one click, then shows what came in", async () => {
    const { db, connectMail, createProvider, deps } = await setup();
    await click(primary()!);
    await waitFor(() => /Synced 2 new emails/.test(banner()?.textContent ?? ""));

    expect(connectMail).toHaveBeenCalledTimes(1);
    expect(connectMail).toHaveBeenCalledWith("gmail");
    expect(createProvider).toHaveBeenCalledWith("gmail", deps.auth.tokenSource, expect.objectContaining({ oldestFirst: true }));
    expect(await db.emails.count()).toBe(2);
    expect((await listAccounts(db))[0].lastSync).not.toBeNull();
    expect(banner()!.getAttribute("role")).toBe("status");
    expect(banner()!.getAttribute("aria-busy")).toBeNull();
    // Connected now, so there is nothing left to press.
    expect(primary()).toBeNull();
    expect(banner()!.textContent).not.toMatch(/[–—]/);
  });

  it("goes away once dismissed", async () => {
    await setup();
    await click(primary()!);
    await waitFor(() => /Synced/.test(banner()?.textContent ?? ""));
    await click(byText("Dismiss", "button")!);
    expect(banner()).toBeNull();
  });

  it("explains a blocked sign-in window and lets the person try again", async () => {
    const { createProvider, connectMail } = await setup({
      connectMail: async () => {
        throw new NotConnected(POPUP_HINT);
      },
    });
    await click(primary()!);
    await waitFor(() => banner()?.getAttribute("role") === "alert");
    expect(banner()!.textContent).toContain("Your browser may have blocked the Google login window. Allow pop-ups for this site and try again.");
    expect(createProvider).not.toHaveBeenCalled();
    expect(primary()).not.toBeNull();
    expect(primary()!.disabled).toBe(false);
    await click(primary()!);
    expect(connectMail).toHaveBeenCalledTimes(2);
  });

  it("disables the button and marks the banner busy while it runs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await setup({ gate });
    await click(primary()!);
    await waitFor(() => banner()?.getAttribute("aria-busy") === "true");

    expect(banner()!.getAttribute("role")).toBe("status");
    expect(primary()!.disabled).toBe(true);
    expect(q("[role=progressbar]", banner()!)).not.toBeNull();
    expect(byText("Stop", "button")).not.toBeNull();
    // A second press does nothing while it runs.
    await click(primary()!);

    release();
    await waitFor(() => /Synced 2 new emails/.test(banner()?.textContent ?? ""));
    expect(banner()!.getAttribute("aria-busy")).toBeNull();
  });

  it("asks each provider once when several accounts need it", async () => {
    const { connectMail } = await setup({ accounts: [["gmail", "a@gmail.com"], ["gmail", "me@gmail.com"], ["outlook", "me@outlook.com"]] });
    await click(primary()!);
    await waitFor(() => /Synced/.test(banner()?.textContent ?? ""));
    expect(connectMail.mock.calls.map((c) => c[0]).sort()).toEqual(["gmail", "outlook"]);
  });
});

describe("SyncBanner first sync after login", () => {
  it("registers the mailbox and syncs with no window, showing progress and then the result", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { db, connectMail, createProvider, deps, fake } = await setup({ accounts: [], pending: "gmail", autoStart: true, gate });
    await waitFor(() => banner()?.getAttribute("aria-busy") === "true");
    expect(q("[role=progressbar]", banner()!)).not.toBeNull();
    expect(banner()!.textContent).toMatch(/Gmail me@gmail\.com: (finding emails|reading)/);

    release();
    await waitFor(() => /Synced 2 new emails/.test(banner()?.textContent ?? ""));
    expect(connectMail).not.toHaveBeenCalled();
    expect(deps.getAddress).toHaveBeenCalledWith("gmail", deps.auth.tokenSource);
    expect(createProvider).toHaveBeenCalledWith("gmail", deps.auth.tokenSource, expect.objectContaining({ oldestFirst: true }));
    expect((await listAccounts(db)).map((a) => [a.provider, a.address, a.active])).toEqual([["gmail", "me@gmail.com", true]]);
    expect(await db.emails.count()).toBe(2);
    expect(primary()).toBeNull();
    expect(fake.auth.takePendingSync).toHaveBeenCalledTimes(1);
  });

  it("says the mailbox is switched off, and syncs nothing, when the person disconnected it on purpose", async () => {
    const { db, connectMail, createProvider } = await setup({ accounts: [], inactive: [["gmail", "me@gmail.com"]], pending: "gmail", autoStart: true });
    await waitFor(() => banner()?.textContent?.includes("Gmail is switched off in Settings."));
    expect(banner()!.getAttribute("role")).toBe("status");
    expect(banner()!.querySelector("a")!.getAttribute("href")).toBe("#/settings/mail");
    expect(banner()!.textContent).not.toMatch(/[–—;]/);
    expect(connectMail).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
    const rows = await listAccounts(db);
    expect(rows.map((a) => a.active)).toEqual([false]);
    expect(await db.emails.count()).toBe(0);
  });

  it("waits while autoStart is false, then starts once when it turns true", async () => {
    const { db, fake, createProvider, rerender } = await setup({ accounts: [], pending: "gmail", autoStart: false });
    await settle(40);
    expect(fake.auth.takePendingSync).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
    expect(await listAccounts(db)).toEqual([]);

    await rerender(true);
    await waitFor(() => /Synced 2 new emails/.test(banner()?.textContent ?? ""));
    expect(fake.auth.takePendingSync).toHaveBeenCalledTimes(1);
  });

  it("takes the pending mailbox only once, even when autoStart flips and re-renders", async () => {
    const { fake, createProvider, rerender } = await setup({ accounts: [], pending: "gmail", autoStart: true });
    await waitFor(() => /Synced 2 new emails/.test(banner()?.textContent ?? ""));
    await rerender(false);
    await rerender(true);
    await rerender(true);
    await settle(40);
    expect(fake.auth.takePendingSync).toHaveBeenCalledTimes(1);
    expect(createProvider).toHaveBeenCalledTimes(1);
  });

  it("does not start when the login connected no mailbox", async () => {
    const { fake, createProvider } = await setup({ accounts: [], pending: null, autoStart: true });
    await settle(40);
    expect(fake.auth.takePendingSync).toHaveBeenCalledTimes(1);
    expect(createProvider).not.toHaveBeenCalled();
    expect(banner()).toBeNull();
  });

  it("shows a failed address lookup as an error", async () => {
    const { createProvider, connectMail } = await setup({ accounts: [], pending: "gmail", autoStart: true, addressFails: true });
    await waitFor(() => banner()?.getAttribute("role") === "alert");
    expect(banner()!.textContent).toContain("Couldn't connect Gmail. offline");
    expect(createProvider).not.toHaveBeenCalled();
    expect(connectMail).not.toHaveBeenCalled();
  });
});

describe("SyncBanner switched-off mailbox", () => {
  it("names Outlook when that is the mailbox that is off", async () => {
    await setup({ accounts: [], inactive: [["outlook", "me@outlook.com"]], pending: "outlook", autoStart: true });
    await waitFor(() => banner()?.textContent?.includes("Outlook is switched off in Settings."));
  });
});

describe("SyncBanner focus", () => {
  it("leaves focus alone when the automatic first sync finishes", async () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    try {
      await setup({ accounts: [], pending: "gmail", autoStart: true });
      await waitFor(() => /Synced 2 new emails/.test(banner()?.textContent ?? ""));
      expect(document.activeElement).toBe(outside);
      expect(document.activeElement).not.toBe(banner());
    } finally {
      outside.remove();
    }
  });

  it("moves focus to the result when the person pressed Reconnect and sync", async () => {
    await setup();
    await click(primary()!);
    await waitFor(() => /Synced 2 new emails/.test(banner()?.textContent ?? ""));
    expect(document.activeElement).toBe(banner());
  });

  it("moves focus to the error when the person's own click fails", async () => {
    await setup({
      connectMail: async () => {
        throw new NotConnected(POPUP_HINT);
      },
    });
    await click(primary()!);
    await waitFor(() => banner()?.getAttribute("role") === "alert");
    expect(document.activeElement).toBe(banner());
  });

  it("does not steal focus on a later automatic result after an earlier click", async () => {
    const { rerender, fake } = await setup({ pending: null, autoStart: false });
    await click(primary()!);
    await waitFor(() => /Synced 2 new emails/.test(banner()?.textContent ?? ""));
    await click(byText("Dismiss", "button")!);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    try {
      fake.pending.value = "outlook";
      await fake.set({ mail: { ...fake.auth.getSession().mail, outlook: true } });
      await rerender(true);
      await waitFor(() => banner() !== null);
      await waitFor(() => /Synced/.test(banner()?.textContent ?? ""));
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });
});

describe("SyncBanner quiet (on Settings)", () => {
  it("shows nothing, and no reconnect prompt, when there is nothing running or to report", async () => {
    await setup({ quiet: true });
    expect(banner()).toBeNull();
    expect(primary()).toBeNull();
    expect(document.body.textContent).not.toContain("Reconnect to sync your mailbox.");
  });

  it("still takes the pending mailbox and syncs it, showing the result", async () => {
    const { fake, createProvider, db } = await setup({ accounts: [], pending: "gmail", autoStart: true, quiet: true });
    await waitFor(() => /Synced 2 new emails/.test(banner()?.textContent ?? ""));
    expect(fake.auth.takePendingSync).toHaveBeenCalledTimes(1);
    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(await db.emails.count()).toBe(2);
    expect(primary()).toBeNull();
    expect(byText("Dismiss", "button")).not.toBeNull();
  });

  it("keeps a running sync going when it turns quiet, and shows it finish", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { rerender, db } = await setup({ gate });
    await click(primary()!);
    await waitFor(() => banner()?.getAttribute("aria-busy") === "true");
    const node = banner();

    await rerender(false, true);
    expect(banner()).toBe(node);
    expect(banner()!.getAttribute("aria-busy")).toBe("true");
    expect(byText("Stop", "button")).not.toBeNull();

    release();
    await waitFor(() => /Synced 2 new emails/.test(banner()?.textContent ?? ""));
    expect(await db.emails.count()).toBe(2);
    expect(primary()).toBeNull();
  });

  it("goes back to the prompt when it stops being quiet", async () => {
    const { rerender } = await setup({ quiet: true });
    expect(banner()).toBeNull();
    await rerender(false, false);
    expect(banner()!.textContent).toContain("Reconnect to sync your mailbox.");
  });
});

describe("one sync at a time", () => {
  it("syncLock hands out the lock once until it is released, and release is safe to repeat", () => {
    const first = tryAcquire()!;
    expect(first).not.toBeNull();
    expect(isSyncing()).toBe(true);
    expect(tryAcquire()).toBeNull();
    first();
    expect(isSyncing()).toBe(false);
    const second = tryAcquire()!;
    first(); // a stale release must not free the second holder's lock
    expect(isSyncing()).toBe(true);
    second();
    expect(isSyncing()).toBe(false);
  });

  it("does nothing but say so when Reconnect and sync is pressed while another sync runs", async () => {
    const { connectMail, createProvider } = await setup();
    const held = tryAcquire()!;
    try {
      await click(primary()!);
      expect(banner()!.textContent).toContain("A sync is already running.");
      expect(connectMail).not.toHaveBeenCalled();
      expect(createProvider).not.toHaveBeenCalled();
    } finally {
      held();
    }
    await click(byText("Dismiss", "button")!);
    await click(primary()!);
    await waitFor(() => /Synced 2 new emails/.test(banner()?.textContent ?? ""));
  });

  it("holds the lock while it syncs and gives it back when done", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await setup({ gate });
    await click(primary()!);
    await waitFor(() => banner()?.getAttribute("aria-busy") === "true");
    expect(isSyncing()).toBe(true);
    release();
    await waitFor(() => /Synced/.test(banner()?.textContent ?? ""));
    expect(isSyncing()).toBe(false);
  });

  it("gives the lock back when it is removed mid-sync", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { view } = await setup({ gate });
    await click(primary()!);
    await waitFor(() => isSyncing());
    view.unmount();
    release();
    await waitFor(() => !isSyncing());
  });

  it("waits to take the pending mailbox while another sync runs, then syncs it once", async () => {
    const held = tryAcquire()!;
    const { fake, createProvider } = await setup({ accounts: [], pending: "gmail", autoStart: true });
    await settle(60);
    expect(fake.auth.takePendingSync).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
    held();
    await waitFor(() => /Synced 2 new emails/.test(banner()?.textContent ?? ""));
    expect(fake.auth.takePendingSync).toHaveBeenCalledTimes(1);
    expect(createProvider).toHaveBeenCalledTimes(1);
  });
});

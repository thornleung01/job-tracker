import "fake-indexeddb/auto";
import { act, createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POPUP_HINT } from "../../../src/auth/google";
import { SyncBanner, type SyncBannerDeps } from "../../../src/components/SyncBanner";
import { deactivateAccount, listAccounts, upsertAccount } from "../../../src/db/repo";
import type { JobTrackerDB } from "../../../src/db/schema";
import { forgetConnections } from "../../../src/pages/settings/actions";
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
  const view = await render(h(SyncBanner, { db, user: ada, deps, local: opts.local ?? false, autoStart: opts.autoStart }));
  await settle(40);
  const rerender = (autoStart: boolean) => view.rerender(h(SyncBanner, { db, user: ada, deps, local: opts.local ?? false, autoStart }));
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

  it("does nothing, and shows nothing, when the person disconnected that mailbox on purpose", async () => {
    const { db, connectMail, createProvider } = await setup({ accounts: [], inactive: [["gmail", "me@gmail.com"]], pending: "gmail", autoStart: true });
    await settle(40);
    expect(banner()).toBeNull();
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

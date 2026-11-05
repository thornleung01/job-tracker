import "fake-indexeddb/auto";
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { App } from "../../src/app/App";
import type { ShellAuth } from "../../src/app/authApi";
import { defaultLoaders } from "../../src/app/pages";
import { mount } from "../../src/app/mount";
import { applyAppearance } from "../../src/app/appearance";
import type { PageLoaders } from "../../src/app/pages";
import type { PageProps } from "../../src/app/pageProps";
import { SignIn } from "../../src/pages/signin/SignIn";
import { upsertAccount } from "../../src/db/repo";
import { saveSettings } from "../../src/sync/settings";
import type { JobTrackerDB } from "../../src/db/schema";
import { ada, byText, click, cleanupRendered, closeDbs, fakeAuth, grace, openTestDb, q, render, settle, waitFor } from "./helpers";

const page = (name: string) => async () => ({ default: (p: PageProps) => h("section", null, h("h1", { className: "page" }, name), h("p", { "data-id": p.params.id ?? "" }, p.query.toString())) });

function loaders(extra: PageLoaders = {}): PageLoaders {
  return {
    applications: page("Applications page"),
    detail: page("Application page"),
    people: page("People page"),
    flow: page("Flow page"),
    review: page("Review page"),
    settings: page("Settings page"),
    ...extra,
  };
}

const go = async (hash: string) => {
  await act(async () => {
    window.location.hash = hash;
    await new Promise((r) => setTimeout(r, 30));
  });
};

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  document.documentElement.removeAttribute("style");
  for (const a of ["data-theme", "data-density", "data-corners", "data-accent"]) document.documentElement.removeAttribute(a);
});
afterEach(() => {
  cleanupRendered();
  closeDbs();
});

describe("signed out", () => {
  it("shows the sign-in screen with both providers and the privacy link", async () => {
    const { auth } = fakeAuth();
    await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: true, microsoft: true } }));
    await settle();
    expect(q("h1")!.textContent).toBe("Log in");
    expect(byText("Continue with Google")).not.toBeNull();
    expect(q("button svg.google-mark")).not.toBeNull();
    expect(byText("Continue with Microsoft")).not.toBeNull();
    expect(q<HTMLAnchorElement>("a[href='./privacy.html']")).not.toBeNull();
    expect(q(".notice")).toBeNull();
    await click(byText("Continue with Microsoft")!);
    expect(auth.signIn).toHaveBeenCalledWith("microsoft", { mail: true });
  });

  it("logs in with Google and asks for the mailbox in the same click", async () => {
    const { auth } = fakeAuth();
    await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: true, microsoft: true } }));
    await click(byText("Continue with Google")!);
    expect(auth.signIn).toHaveBeenCalledWith("google", { mail: true });
  });

  it("calls signIn synchronously inside the click, with nothing awaited first", async () => {
    const { auth } = fakeAuth();
    await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: true, microsoft: true } }));
    auth.signIn.mockImplementationOnce(async () => undefined);
    byText("Continue with Google")!.click();
    expect(auth.signIn).toHaveBeenCalledTimes(1);
  });

  it("prepares configured providers on mount", async () => {
    const { auth } = fakeAuth();
    const both = await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: true, microsoft: true } }));
    await settle();
    expect(auth.prepare.mock.calls.map((c) => c[0]).sort()).toEqual(["google", "microsoft"]);
    both.unmount();
    await settle();
    auth.prepare.mockClear();
    await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: false, microsoft: true } }));
    await settle();
    expect(auth.prepare.mock.calls.map((c) => c[0])).toEqual(["microsoft"]);
  });

  it("ignores a provider that fails to prepare", async () => {
    const { auth } = fakeAuth();
    auth.prepare.mockRejectedValue(new Error("blocked"));
    await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: true, microsoft: true } }));
    await settle();
    expect(q(".notice")).toBeNull();
    expect(byText("Continue with Google")).not.toBeNull();
  });

  it("gives the provider used last the primary style", async () => {
    const { auth } = fakeAuth({ lastProvider: "microsoft" });
    await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: true, microsoft: true } }));
    expect(byText("Continue with Microsoft")!.classList.contains("primary")).toBe(true);
    expect(byText("Continue with Google")!.classList.contains("primary")).toBe(false);
  });

  it("explains the one window and Google's unverified notice", async () => {
    const { auth } = fakeAuth();
    await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: true, microsoft: true } }));
    expect(q(".signin-help")!.textContent).toBe(
      "One window logs you in and lets Job Tracker read your email. Google may say it hasn't verified the app: choose Advanced, then Go to Job Tracker.",
    );
  });

  it("ties the help line to both login buttons", async () => {
    const { auth } = fakeAuth();
    await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: true, microsoft: true } }));
    const help = q(".signin-help")!;
    expect(help.id).toBe("signin-help");
    expect(byText("Continue with Google")!.getAttribute("aria-describedby")).toBe("signin-help");
    expect(byText("Continue with Microsoft")!.getAttribute("aria-describedby")).toBe("signin-help");
  });

  it("leaves out the Google notice sentence when only Microsoft is set up", async () => {
    const { auth } = fakeAuth();
    await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: false, microsoft: true } }));
    expect(q(".signin-help")!.textContent).toBe("One window logs you in and lets Job Tracker read your email.");
    expect(q(".signin-help")!.textContent).not.toContain("Google");
    expect(byText("Continue with Microsoft")!.getAttribute("aria-describedby")).toBe(q(".signin-help")!.id);
  });

  it("has no help line or description when no login is set up", async () => {
    const { auth } = fakeAuth();
    await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: false, microsoft: false } }));
    expect(q(".signin-help")).toBeNull();
    expect(document.querySelector("[aria-describedby]")).toBeNull();
  });

  it("footer links to the privacy page and to #/setup", async () => {
    const { auth } = fakeAuth();
    await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: true, microsoft: true } }));
    expect(q<HTMLAnchorElement>(".signin-footer a[href='#/setup']")!.textContent).toBe("Site setup");
    expect(q<HTMLAnchorElement>(".signin-footer a[href='./privacy.html']")!.textContent).toBe("Privacy");
  });

  it("offers to log in without the mailbox after an error, and calls signIn with mail false", async () => {
    const { auth } = fakeAuth();
    auth.signIn.mockRejectedValueOnce(new Error("Your organization has to approve mail access. You can log in without it."));
    await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: true, microsoft: true } }));
    expect(byText("Log in without connecting your mailbox")).toBeNull();
    await click(byText("Continue with Microsoft")!);
    const skip = await waitFor(() => byText("Log in without connecting your mailbox"));
    await click(skip);
    expect(auth.signIn).toHaveBeenLastCalledWith("microsoft", { mail: false });
    await waitFor(() => byText("Log in without connecting your mailbox") === null);
  });

  it("shows the session error as an error notice", async () => {
    const { auth } = fakeAuth({ error: "Login was cancelled" });
    await render(h(App, { local: false, auth, loaders: loaders(), openDb: openTestDb }));
    const err = q(".notice.err")!;
    expect(err.textContent).toBe("Login was cancelled");
    expect(err.getAttribute("role")).toBe("alert");
  });

  it("says what the app is and keeps env var names out of the screen", async () => {
    const { auth } = fakeAuth();
    await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: true, microsoft: true } }));
    expect(q("p.lede")!.textContent).toBe("Follow your job applications from the emails in your own mailbox. Your data stays in this browser.");
    expect(document.body.textContent).not.toMatch(/VITE_/);
    expect(q(".notice")).toBeNull();
  });

  it("shows only the providers this build has, and plain copy when there are none", async () => {
    const { auth } = fakeAuth();
    const none = await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: false, microsoft: false } }));
    expect(q(".notice", none.container)!.textContent).toBe("Login isn't available on this site yet.");
    expect(auth.prepare).not.toHaveBeenCalled();
    expect(none.container.querySelectorAll("button")).toHaveLength(0);
    expect(none.container.textContent).not.toMatch(/VITE_/);
    none.unmount();

    const google = await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: true, microsoft: false } }));
    await settle();
    expect(byText("Continue with Google", "button", google.container)).not.toBeNull();
    expect(byText("Continue with Microsoft", "button", google.container)).toBeNull();
    expect(q(".notice", google.container)).toBeNull();
    expect(google.container.textContent).toContain("Microsoft login isn't available on this site yet.");
    google.unmount();

    const microsoft = await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: false, microsoft: true } }));
    expect(byText("Continue with Microsoft", "button", microsoft.container)).not.toBeNull();
    expect(byText("Continue with Google", "button", microsoft.container)).toBeNull();
  });

  it("disables the buttons while signing in", async () => {
    const { auth } = fakeAuth({ status: "signing-in" });
    await render(h(SignIn, { auth, session: auth.getSession(), configured: { google: true, microsoft: true } }));
    expect((byText("Continue with Microsoft") as HTMLButtonElement).disabled).toBe(true);
    expect((byText("Continue with Google") as HTMLButtonElement).disabled).toBe(true);
    expect(q("[role=status]")!.textContent).toBe("Logging in");
  });

  it("goes from signed out to signed in and back, closing the user's database", async () => {
    const { auth, set } = fakeAuth();
    const dbs: JobTrackerDB[] = [];
    const openDb = (n: string) => {
      const d = openTestDb(n);
      dbs.push(d);
      return d;
    };
    await render(h(App, { local: false, auth, loaders: loaders(), openDb }));
    expect(q("h1")!.textContent).toBe("Log in");
    await set({ status: "signed-in", user: ada });
    await waitFor(() => q("header.top"));
    await waitFor(() => q("h1")?.textContent === "Applications page");
    expect(dbs).toHaveLength(1);
    expect(dbs[0].name).toContain("jobtracker:https://accounts.google.com:111");
    await set({ status: "signed-out", user: null });
    await settle();
    expect(q("header.top")).toBeNull();
    expect(q("h1")!.textContent).toBe("Log in");
    await waitFor(() => !dbs[0].isOpen());   // Dexie closes asynchronously
  });
});

describe("signed in shell", () => {
  async function signedIn(extra: PageLoaders = {}) {
    const { auth, set } = fakeAuth({ status: "signed-in", user: ada });
    const dbs: JobTrackerDB[] = [];
    const openDb = (n: string) => {
      const d = openTestDb(n);
      dbs.push(d);
      return d;
    };
    const view = await render(h(App, { local: false, auth, loaders: loaders(extra), openDb }));
    await waitFor(() => q("header.top"));
    return { auth, set, dbs, view, db: () => dbs[dbs.length - 1] };
  }

  it("renders the header like base.html: brand, nav, settings gear, skip link, main", async () => {
    await signedIn();
    expect(q(".brand")!.textContent).toBe("Job Tracker");
    const links = Array.from(document.querySelectorAll("header.top nav a")).map((a) => a.textContent);
    expect(links).toEqual(["Applications", "People", "Flow", "Needs review", ""]);
    expect(document.body.textContent).not.toContain("Jobs");
    const gear = q("a.icon-link")!;
    expect(gear.getAttribute("aria-label")).toBe("Settings");
    const svg = gear.querySelector("svg")!;
    expect([svg.getAttribute("width"), svg.getAttribute("height")]).toEqual(["24", "24"]);
    expect(q("a.skip")!.textContent).toBe("Skip to content");
    expect(q("main#main")).not.toBeNull();
    expect(q("a[aria-current=page]")!.textContent).toBe("Applications");
    expect(document.title).toBe("Applications · Job Tracker");
  });

  it("marks the current page, loads pages lazily and passes params and query", async () => {
    const calls: string[] = [];
    const track = (name: string, label: string) => () => {
      calls.push(name);
      return page(label)();
    };
    await signedIn({ people: track("people", "People page"), detail: track("detail", "Application page") });
    expect(calls).toEqual([]);
    await go("#/people");
    await waitFor(() => q("h1")?.textContent === "People page");
    expect(calls).toEqual(["people"]);
    expect(q("a[aria-current=page]")!.textContent).toBe("People");
    expect(document.title).toBe("People · Job Tracker");
    await go("#/app/12?tab=mail");
    await waitFor(() => q("h1")?.textContent === "Application page");
    expect(q("p[data-id]")!.getAttribute("data-id")).toBe("12");
    expect(q("p[data-id]")!.textContent).toBe("tab=mail");
    expect(q("a[aria-current=page]")!.textContent).toBe("Applications");
    await go("#/settings");
    await waitFor(() => q("h1")?.textContent === "Settings page");
    expect(q("a.icon-link")!.getAttribute("aria-current")).toBe("page");
    expect(q("nav a[aria-current=page]:not(.icon-link)")).toBeNull();
  });

  it("moves focus to the page heading after navigation, but not on first load", async () => {
    await signedIn();
    expect(document.activeElement).toBe(document.body);
    await go("#/flow");
    await waitFor(() => q("h1")?.textContent === "Flow page");
    await waitFor(() => document.activeElement === q("h1"));
    expect(document.activeElement!.textContent).toBe("Flow page");
  });

  it("skips to the main area without touching the hash", async () => {
    await signedIn();
    await go("#/people");
    await waitFor(() => q("h1")?.textContent === "People page");
    await click(q("a.skip")!);
    expect(window.location.hash).toBe("#/people");
    expect(document.activeElement).toBe(q("main"));
  });

  it("sends unknown routes to Applications and leaves the hash alone", async () => {
    await signedIn();
    await go("#/nowhere");
    await waitFor(() => q("h1")?.textContent === "Applications page");
    expect(window.location.hash).toBe("#/nowhere");
  });

  it("never rewrites an OAuth response hash", async () => {
    window.location.hash = "#code=abc&state=xyz";
    await signedIn();
    await waitFor(() => q("h1")?.textContent === "Applications page");
    await settle(60);
    expect(window.location.hash).toBe("#code=abc&state=xyz");
  });

  it("shows a quiet notice when a page is not in this build", async () => {
    const { auth } = fakeAuth({ status: "signed-in", user: ada });
    const l = loaders();
    delete l.people;
    await render(h(App, { local: false, auth, loaders: l, openDb: openTestDb }));
    await waitFor(() => q("header.top"));
    await go("#/people");
    const note = await waitFor(() => q(".notice"));
    expect(note.textContent).toBe("This page isn't available.");
  });

  it("catches a page that throws, and recovers when you move on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await signedIn({
      flow: async () => ({
        default: () => {
          throw new Error("boom");
        },
      }),
    });
    await go("#/flow");
    const note = await waitFor(() => q(".notice.err"));
    expect(note.textContent).toBe("Something went wrong on this page. Try again, or go back to Applications.");
    expect(q("header.top")).not.toBeNull();
    expect(byText("Try again")).not.toBeNull();
    await go("#/people");
    await waitFor(() => q("h1")?.textContent === "People page");
    expect(q(".notice.err")).toBeNull();
  });

  it("shows a retry when a page fails to load", async () => {
    let n = 0;
    await signedIn({
      people: async () => {
        if (n++ === 0) throw new Error("chunk");
        return page("People page")();
      },
    });
    await go("#/people");
    const retry = await waitFor(() => byText("Try again"));
    await click(retry);
    await waitFor(() => q("h1")?.textContent === "People page");
  });

  it("shows the needs-review count and keeps it live", async () => {
    const { db } = await signedIn();
    expect(q(".count")).toBeNull();
    const acct = await upsertAccount(db(), "gmail", "me@gmail.com");
    const base = {
      accountId: acct, threadId: null, receivedAt: "2026-10-01T00:00:00Z", sender: "A <a@x.com>", subject: "s", body: "b", related: true, event: null,
      confidence: null, applicationId: null, needsReview: true, webLink: null, bulk: false, hold: false, reason: null,
    };
    await db().emails.bulkAdd([{ ...base, providerMsgId: "1" }, { ...base, providerMsgId: "2" }]);
    const badge = await waitFor(() => q(".count"));
    expect(badge.textContent).toBe("2");
    expect(badge.getAttribute("aria-label")).toBe("2 emails need review");
  });

  it("opens each user's own database and switches when the user changes", async () => {
    const { auth, set, dbs } = await signedIn();
    expect(dbs).toHaveLength(1);
    await set({ user: grace });
    await waitFor(() => dbs.length === 2);
    expect(dbs[1].name).toContain(":222");
    await waitFor(() => !dbs[0].isOpen());   // Dexie closes asynchronously
    await waitFor(() => q("header.top"));
    void auth;
  });
});

describe("appearance", () => {
  it("writes the attributes and accent variables, omitting data-theme for system", async () => {
    const root = document.documentElement;
    applyAppearance(root, { theme: "dark", density: "compact", corners: "sharp", accent: "forest" });
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.getAttribute("data-density")).toBe("compact");
    expect(root.getAttribute("data-corners")).toBe("sharp");
    expect(root.getAttribute("data-accent")).toBe("forest");
    expect(root.style.getPropertyValue("--accent-l")).toBe("#2f5d46");
    expect(root.style.getPropertyValue("--accent-d")).toBe("#8cc7a6");
    applyAppearance(root, { theme: "system", density: "comfortable", corners: "soft", accent: "graphite" });
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(root.style.getPropertyValue("--accent-l")).toBe("#000000");
  });

  it("follows the saved settings, live, and resets when signed out", async () => {
    const { auth, set } = fakeAuth({ status: "signed-in", user: ada });
    let db!: JobTrackerDB;
    const openDb = (n: string) => (db = openTestDb(n));
    await render(h(App, { local: false, auth, loaders: loaders(), openDb }));
    await waitFor(() => q("header.top"));
    const root = document.documentElement;
    await waitFor(() => root.getAttribute("data-density") === "comfortable");
    expect(root.hasAttribute("data-theme")).toBe(false);
    await act(async () => {
      await saveSettings(db, "appearance", { theme: "dark", accent: "clay", density: "compact", corners: "sharp" });
    });
    await waitFor(() => root.getAttribute("data-theme") === "dark");
    expect(root.getAttribute("data-accent")).toBe("clay");
    expect(root.getAttribute("data-density")).toBe("compact");
    expect(root.getAttribute("data-corners")).toBe("sharp");
    expect(root.style.getPropertyValue("--accent-l")).toBe("#8f4a32");
    expect(root.style.getPropertyValue("--accent-d")).toBe("#e0a184");
    await set({ status: "signed-out", user: null });
    await waitFor(() => !root.hasAttribute("data-theme") && root.getAttribute("data-accent") === "graphite");
  });
});

describe("mount", () => {
  it("renders nothing in the Microsoft sign-in popup and leaves the hash alone", async () => {
    window.location.hash = "#code=abc&state=xyz";
    const el = document.createElement("div");
    expect(mount(el, {}, true)).toBeNull();
    expect(el.innerHTML).toBe("");
    expect(window.location.hash).toBe("#code=abc&state=xyz");
  });

  it("renders the app otherwise", async () => {
    const { auth } = fakeAuth();
    const el = document.createElement("div");
    document.body.appendChild(el);
    let root: ReturnType<typeof mount> = null;
    await act(async () => {
      root = mount(el, { local: false, auth, loaders: loaders(), openDb: openTestDb }, false);
    });
    expect(el.querySelector("h1")!.textContent).toBe("Log in");
    act(() => root!.unmount());
    el.remove();
  });
});

describe("sync banner in the signed-in shell", () => {
  async function shell(pending: "gmail" | "outlook" | null = null) {
    const { auth, set, pending: p } = fakeAuth({ status: "signed-in", user: ada });
    p.value = pending;
    const dbs: JobTrackerDB[] = [];
    const openDb = (n: string) => {
      const d = openTestDb(n);
      dbs.push(d);
      return d;
    };
    await render(h(App, { local: false, auth, loaders: loaders(), openDb }));
    await waitFor(() => q("header.top"));
    return { auth, set, db: () => dbs[dbs.length - 1] };
  }

  it("shows the banner under the header on every page, quietly on Settings", async () => {
    const { db } = await shell();
    await upsertAccount(db(), "gmail", "me@gmail.com");
    const banner = await waitFor(() => q(".sync-banner"));
    expect(banner.textContent).toContain("Reconnect to sync your mailbox.");
    expect(q("header.top")!.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner.compareDocumentPosition(q("main")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await go("#/people");
    await waitFor(() => q("h1")?.textContent === "People page");
    expect(document.querySelectorAll(".sync-banner")).toHaveLength(1);

    await go("#/settings");
    await waitFor(() => q("h1")?.textContent === "Settings page");
    // Quiet: nothing to report, and no second Reconnect prompt next to Settings' own buttons.
    expect(q(".sync-banner")).toBeNull();
    expect(document.body.textContent).not.toContain("Reconnect to sync your mailbox.");

    await go("#/");
    await waitFor(() => q("h1")?.textContent === "Applications page");
    expect(document.querySelectorAll(".sync-banner")).toHaveLength(1);
  });

  it("takes the mailbox the login connected once, even when the first page is Settings", async () => {
    window.location.hash = "#/settings";
    const { auth } = await shell("gmail");
    await waitFor(() => q("h1")?.textContent === "Settings page");
    await waitFor(() => auth.takePendingSync.mock.calls.length === 1);
    // The first sync ran (here it can't reach a real mailbox, so it reports that), and Settings shows it.
    const banner = await waitFor(() => q(".sync-banner"));
    await waitFor(() => /Couldn't connect Gmail/.test(banner.textContent ?? ""));

    await go("#/people");
    await go("#/flow");
    await go("#/");
    await settle(60);
    expect(auth.takePendingSync).toHaveBeenCalledTimes(1);
  });

  it("takes the mailbox once when the person opens Settings right after login", async () => {
    const { auth } = await shell("gmail");
    await waitFor(() => auth.takePendingSync.mock.calls.length === 1);
    await go("#/settings");
    await waitFor(() => q("h1")?.textContent === "Settings page");
    await go("#/people");
    await settle(60);
    expect(auth.takePendingSync).toHaveBeenCalledTimes(1);
  });

  it("keeps the same banner, and so the same sync, when the person goes to Settings and back", async () => {
    const { auth } = await shell("gmail");
    const banner = await waitFor(() => q(".sync-banner"));
    await go("#/settings");
    await waitFor(() => q("h1")?.textContent === "Settings page");
    expect(q(".sync-banner")).toBe(banner);
    await go("#/people");
    await waitFor(() => q("h1")?.textContent === "People page");
    expect(q(".sync-banner")).toBe(banner);
    expect(auth.takePendingSync).toHaveBeenCalledTimes(1);
  });

  it("takes nothing when the login connected no mailbox", async () => {
    const { auth } = await shell(null);
    await waitFor(() => auth.takePendingSync.mock.calls.length === 1);
    expect(q(".sync-banner")).toBeNull();
  });
});

describe("site setup page", () => {
  const guide = () => q("h1.page")?.textContent === "Set up mail sync";

  it("replaces the login page when signed out at #/setup, with no auth calls", async () => {
    window.location.hash = "#/setup";
    const { auth } = fakeAuth();
    await render(h(App, { local: false, auth, openDb: openTestDb }));
    await waitFor(guide);
    expect(byText("Log in")).toBeNull();
    expect(q("h1")!.textContent).not.toBe("Log in");
    expect(byText("Continue with Google")).toBeNull();
    expect(auth.prepare).not.toHaveBeenCalled();
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(auth.takePendingSync).not.toHaveBeenCalled();
  });

  it("sets the title, moves focus to the heading, and links back to the login page", async () => {
    window.location.hash = "#/setup";
    const { auth } = fakeAuth();
    await render(h(App, { local: false, auth, openDb: openTestDb }));
    await waitFor(guide);
    expect(document.title).toBe("Set up · Job Tracker");
    await waitFor(() => document.activeElement === q("h1"));
    const main = q("main")!;
    expect(main.id).toBe("main");
    const back = byText("Back to log in", "a") as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("#/");
    expect(main.contains(back)).toBe(true);
    expect(back.compareDocumentPosition(q("h1")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await go("#/");
    await waitFor(() => q("h1")?.textContent === "Log in");
    expect(document.title).toBe("Log in · Job Tracker");
  });

  it("goes back to the login page when the address changes", async () => {
    window.location.hash = "#/setup";
    const { auth } = fakeAuth();
    await render(h(App, { local: false, auth, openDb: openTestDb }));
    await waitFor(guide);
    await go("#/");
    await waitFor(() => q("h1")?.textContent === "Log in");
    expect(guide()).toBe(false);
  });

  it("shows the login page at any other address", async () => {
    window.location.hash = "#/people";
    const { auth } = fakeAuth();
    await render(h(App, { local: false, auth, openDb: openTestDb }));
    expect(q("h1")!.textContent).toBe("Log in");
  });

  it("opens in the demo too, through the normal page list, with auth untouched", async () => {
    window.location.hash = "#/setup";
    const untouchable = new Proxy({} as ShellAuth, {
      get: (_t, key) => {
        throw new Error(`auth.${String(key)} was used in a local build`);
      },
    });
    await render(h(App, { local: true, auth: untouchable, loaders: defaultLoaders, openDb: openTestDb }));
    await waitFor(guide);
    expect(q("header.top")).not.toBeNull();
    expect(q(".sync-banner")).toBeNull();
    expect(q(".local-data-offer")).toBeNull();
  });
});

describe("mail declined notice", () => {
  const text = "Logged in. Gmail access wasn't allowed, so nothing will sync. Connect it in Settings.";
  async function shell(mailDeclined: "gmail" | "outlook" | null) {
    const fake = fakeAuth({ status: "signed-in", user: ada, mailDeclined });
    await render(h(App, { local: false, auth: fake.auth, loaders: loaders(), openDb: openTestDb }));
    await waitFor(() => q("header.top"));
    return fake;
  }
  const notice = () => Array.from(document.querySelectorAll(".notice")).find((n) => (n.textContent ?? "").startsWith("Logged in."));

  it("tells the person nothing will sync, with a Dismiss button", async () => {
    await shell("gmail");
    const n = await waitFor(notice);
    expect(n.textContent).toContain(text);
    expect(n.getAttribute("role")).toBe("status");
    expect(n.textContent).not.toMatch(/[–—;]/);
    expect(byText("Dismiss", "button")).not.toBeNull();
  });

  it("names Outlook when that is the mailbox that was declined", async () => {
    await shell("outlook");
    const n = await waitFor(notice);
    expect(n.textContent).toContain("Logged in. Outlook access wasn't allowed, so nothing will sync. Connect it in Settings.");
  });

  it("shows nothing when mail was allowed", async () => {
    await shell(null);
    expect(notice()).toBeUndefined();
  });

  it("goes away when dismissed and stays away on other pages", async () => {
    await shell("gmail");
    await waitFor(notice);
    await click(byText("Dismiss", "button")!);
    expect(notice()).toBeUndefined();
    await go("#/people");
    await go("#/settings");
    expect(notice()).toBeUndefined();
  });

  it("goes away when a mailbox is connected later", async () => {
    const fake = await shell("gmail");
    await waitFor(notice);
    await fake.set({ mailDeclined: null, mail: { gmail: true, outlook: false } });
    await waitFor(() => notice() === undefined);
  });

  it("comes back on the next login", async () => {
    const fake = await shell("gmail");
    await waitFor(notice);
    await click(byText("Dismiss", "button")!);
    await fake.set({ status: "signed-out", user: null, mailDeclined: null });
    await waitFor(() => q("h1")?.textContent === "Log in");
    await fake.set({ status: "signed-in", user: ada, mailDeclined: "gmail" });
    await waitFor(notice);
  });
});

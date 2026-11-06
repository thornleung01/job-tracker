import "fake-indexeddb/auto";
import { createElement as h } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Header, PAGE_TITLES } from "../../src/app/Shell";
import { matchRoute } from "../../src/app/router";
import { ROUTES } from "../../src/app/routes";
import { upsertAccount } from "../../src/db/repo";
import { cleanupRendered, closeDbs, freshDb, nameOf, render, waitFor } from "./helpers";

afterEach(() => {
  cleanupRendered();
  closeDbs();
});

describe("the Resume route", () => {
  it("sits between People and Statistics in the nav, and is titled Resume", () => {
    expect(ROUTES.filter((r) => r.nav).map((r) => r.nav)).toEqual(["Applications", "People", "Resume", "Statistics", "Needs review"]);
    expect(PAGE_TITLES.resume).toBe("Resume");
  });

  it("matches the page and the print view, which carries the document id", () => {
    expect(matchRoute("#/resume").page).toBe("resume");
    expect(matchRoute("#/resume?tab=cover").query.get("tab")).toBe("cover");
    const print = matchRoute("#/resume/print/12");
    expect([print.page, print.params.id, print.known]).toEqual(["resume", "12", true]);
    expect(matchRoute("#/resume/print").known).toBe(false);
  });
});

describe("the header on a phone", () => {
  const mount = async (page: "resume" | "review" = "resume") => {
    const db = freshDb();
    const view = await render(h(Header, { db, page }));
    return { db, view };
  };

  it("has five links in order, and marks Resume as the current page on the print view too", async () => {
    const { view } = await mount();
    const links = [...view.container.querySelectorAll("nav a")];
    expect(links.map(nameOf)).toEqual(["Applications", "People", "Resume", "Statistics", "Needs review", ""]);
    expect(links[2].getAttribute("aria-current")).toBe("page");
  });

  it("shows Needs review as Review on a phone but keeps its accessible name", async () => {
    const { view } = await mount("review");
    const link = view.container.querySelector<HTMLElement>("nav a[href='#/review']")!;
    const full = link.querySelector(".nav-full")!;
    const short = link.querySelector(".nav-short")!;
    expect(full.textContent).toBe("Needs review");
    expect(short.textContent).toBe("Review");
    expect(short.getAttribute("aria-hidden")).toBe("true");
    expect(nameOf(link)).toBe("Needs review");
  });

  it("keeps the unread emails in the name (the number itself is hidden)", async () => {
    const { db, view } = await mount("review");
    const acct = await upsertAccount(db, "gmail", "me@gmail.com");
    await db.emails.add({
      accountId: acct, providerMsgId: "1", threadId: null, receivedAt: "2026-10-01T00:00:00Z", sender: "A <a@x.com>", subject: "s", body: "b", related: true,
      event: null, confidence: null, applicationId: null, needsReview: true, webLink: null, bulk: false, hold: false, reason: null,
    });
    await waitFor(() => view.container.querySelector(".count") !== null);
    expect(nameOf(view.container.querySelector("nav a[href='#/review']")!)).toBe("Needs review, 1 email");
  });
});

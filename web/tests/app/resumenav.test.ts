import "fake-indexeddb/auto";
import { createElement as h } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Header, PAGE_TITLES } from "../../src/app/Shell";
import { matchRoute } from "../../src/app/router";
import { ROUTES } from "../../src/app/routes";
import { cleanupRendered, closeDbs, nameOf, render } from "./helpers";

afterEach(() => {
  cleanupRendered();
  closeDbs();
});

describe("the Resume route", () => {
  it("sits between People and Statistics in the nav, and is titled Resume", () => {
    expect(ROUTES.filter((r) => r.nav).map((r) => r.nav)).toEqual(["Applications", "People", "Resume", "Statistics"]);
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
    const view = await render(h(Header, { page }));
    return { view };
  };

  it("has four links in order then the gear, and marks Resume as the current page on the print view too", async () => {
    const { view } = await mount();
    const links = [...view.container.querySelectorAll("nav a")];
    expect(links.map(nameOf)).toEqual(["Applications", "People", "Resume", "Statistics", ""]);
    expect(links[2].getAttribute("aria-current")).toBe("page");
  });

  it("has no Needs review link, and marks Applications current on the review queue", async () => {
    const { view } = await mount("review");
    expect(view.container.querySelector("nav a[href='#/review']")).toBeNull();
    expect(view.container.querySelector("nav a[aria-current='page']")!.getAttribute("href")).toBe("#/");
  });
});

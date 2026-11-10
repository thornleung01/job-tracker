import { afterEach, describe, expect, it } from "vitest";
import { isAuthResponseHash, matchRoute, movedTo, navigate, toHash } from "../../src/app/router";

describe("the Flow page's old address", () => {
  it("still matches the Statistics page, so an old bookmark lands there", () => {
    expect(matchRoute("#/flow").page).toBe("statistics");
    expect(matchRoute("#/flow/").page).toBe("statistics");
    expect(matchRoute("#/flow?account=1&days=90").query.get("days")).toBe("90");
  });

  it("gives the new address with the query kept, and null for everything else", () => {
    expect(movedTo("#/flow")).toBe("/statistics");
    expect(movedTo("#/flow/")).toBe("/statistics");
    expect(movedTo("#/flow?account=1&days=90")).toBe("/statistics?account=1&days=90");
    expect(movedTo("#/statistics?days=30")).toBeNull();
    expect(movedTo("#/")).toBeNull();
    expect(movedTo("#/flowers")).toBeNull();
    expect(movedTo("#code=abc&state=xyz")).toBeNull();
  });
});

describe("matchRoute", () => {
  it("maps every route in ROUTES", () => {
    expect(matchRoute("#/").page).toBe("applications");
    expect(matchRoute("#/people").page).toBe("people");
    expect(matchRoute("#/statistics").page).toBe("statistics");
    expect(matchRoute("#/review").page).toBe("review");
    expect(matchRoute("#/settings").page).toBe("settings");
  });

  it("routes #/settings/:section to the Settings page and keeps the section as a param", () => {
    expect(matchRoute("#/settings/data")).toMatchObject({ page: "settings", params: { section: "data" }, known: true });
    expect(matchRoute("#/settings/ai").params.section).toBe("ai");
    expect(matchRoute("#/settings").params).toEqual({});
  });

  it("treats an empty hash as the home page without calling it unknown", () => {
    for (const h of ["", "#", "#/"]) expect(matchRoute(h)).toMatchObject({ page: "applications", path: "/", known: true });
  });

  it("captures params and decodes them", () => {
    const m = matchRoute("#/app/12");
    expect(m).toMatchObject({ page: "detail", params: { id: "12" }, path: "/app/12", known: true });
    expect(matchRoute("#/app/a%20b").params.id).toBe("a b");
    expect(matchRoute("#/app/%E0%A4%A").params.id).toBe("%E0%A4%A"); // malformed escapes pass through
  });

  it("parses the query string of the hash", () => {
    const m = matchRoute("#/?stage=Applied&q=acme%20inc");
    expect(m.page).toBe("applications");
    expect(m.query.get("stage")).toBe("Applied");
    expect(m.query.get("q")).toBe("acme inc");
    expect(matchRoute("#/app/3?tab=mail").query.get("tab")).toBe("mail");
    expect(matchRoute("#/people").query.toString()).toBe("");
  });

  it("tolerates a trailing slash and a missing leading slash", () => {
    expect(matchRoute("#/statistics/").page).toBe("statistics");
    expect(matchRoute("#people").page).toBe("people");
  });

  it("sends unknown routes to Applications and says so", () => {
    for (const h of ["#/nope", "#/app", "#/app/", "#/app/1/extra", "#main"]) {
      expect(matchRoute(h)).toMatchObject({ page: "applications", known: false });
    }
  });

  it("ignores OAuth response fragments", () => {
    for (const h of ["#code=abc&state=xyz", "#error=access_denied&error_description=x", "#state=1"]) {
      expect(isAuthResponseHash(h)).toBe(true);
      expect(matchRoute(h)).toMatchObject({ authResponse: true, page: "applications", path: "/" });
    }
  });

  it("does not mistake a real route for an OAuth response", () => {
    expect(isAuthResponseHash("#/?state=open&code=1")).toBe(false);
    expect(matchRoute("#/?code=1")).toMatchObject({ authResponse: false, page: "applications" });
    expect(isAuthResponseHash("")).toBe(false);
  });
});

describe("navigate", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("builds hashes", () => {
    expect(toHash("/app/12")).toBe("#/app/12");
    expect(toHash("people")).toBe("#/people");
    expect(toHash("/?stage=Applied")).toBe("#/?stage=Applied");
  });

  it("sets the hash, and replace keeps the history length and still fires hashchange", async () => {
    navigate("/statistics");
    expect(window.location.hash).toBe("#/statistics");
    const before = window.history.length;
    let fired = 0;
    const on = () => fired++;
    window.addEventListener("hashchange", on);
    navigate("/people?q=1", { replace: true });
    window.removeEventListener("hashchange", on);
    expect(window.location.hash).toBe("#/people?q=1");
    expect(window.history.length).toBe(before);
    expect(fired).toBe(1);
  });
});

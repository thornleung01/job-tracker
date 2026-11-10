// An address like #/app/abc or #/tailor/abc names no application. It shows the page's "not found" line instead of crashing into the error screen.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { routeId } from "../../src/app/routeId";
import DetailPage from "../../src/pages/detail";
import TailorPage from "../../src/pages/tailor";
import { applicationDetail } from "../../src/sync/queries";
import { deletedApplication } from "../../src/sync/trash";
import { $, cleanup, freshDb, mountPage, text, waitFor } from "./applications/harness";

afterEach(cleanup);

describe("routeId", () => {
  it("reads whole numbers and nothing else", () => {
    expect(routeId("12")).toBe(12);
    expect(routeId("0")).toBe(0);
    for (const bad of ["abc", "", "1e2", "0x10", "-1", "1.5", " 3", "12abc", "99999999999999999999", undefined]) expect(routeId(bad)).toBeNaN();
  });
});

describe("a mangled application id", () => {
  it("has no detail and no deleted entry, instead of an IndexedDB error", async () => {
    const db = freshDb();
    expect(await applicationDetail(db, NaN)).toBeNull();
    expect(await deletedApplication(db, NaN)).toBeNull();
  });

  it("#/app/abc shows Application not found", async () => {
    const { container } = await mountPage(DetailPage, freshDb(), "/app/abc", { id: "abc" });
    await waitFor(() => $(container, ".detail-missing") !== null, "the missing page");
    expect(text($(container, "h1"))).toBe("Application not found");
  });

  it("#/tailor/abc says the application isn't there", async () => {
    const { container } = await mountPage(TailorPage, freshDb(), "/tailor/abc", { id: "abc" });
    await waitFor(() => $(container, ".tailor-empty") !== null, "the missing line");
    expect(text($(container, ".tailor-empty"))).toContain("isn't here");
  });
});

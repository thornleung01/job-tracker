import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { ActionError } from "../../src/db/errors";
import { SAVED_VIEWS_MAX, SAVED_VIEW_NAME_MAX } from "../../src/db/limits";
import { cleanFilters, cleanViewName, deleteView, describeFilters, loadSavedViews, renameView, sanitizeSavedViews, saveView, type ViewFilters } from "../../src/sync/savedViews";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const f = (o: Partial<ViewFilters> = {}): ViewFilters => ({ stage: "Interview", q: "", account: 0, followUp: false, ghosted: false, resume: "", sort: "", dir: "", ...o });

describe("names", () => {
  it("tidies spaces and refuses empty, long and hostile names", () => {
    expect(cleanViewName("  Interviews   this month ")).toBe("Interviews this month");
    expect(() => cleanViewName("   ")).toThrow(ActionError);
    expect(cleanViewName("x".repeat(SAVED_VIEW_NAME_MAX))).toHaveLength(SAVED_VIEW_NAME_MAX);
    expect(() => cleanViewName("x".repeat(SAVED_VIEW_NAME_MAX + 1))).toThrow(/40/);
    expect(() => cleanViewName("a‮b")).toThrow(ActionError);
    expect(() => cleanViewName("a\u0000b")).toThrow(ActionError);
  });
  it("counts characters, not UTF-16 units", () => {
    expect(cleanViewName("😀".repeat(SAVED_VIEW_NAME_MAX))).toBeTruthy();
  });
});

describe("filters", () => {
  it("keeps known values and empties the rest", () => {
    expect(cleanFilters({ stage: "Nope", q: "  a   b ", account: -3, followUp: "yes", sort: "evil", dir: "asc" }))
      .toEqual({ stage: "", q: "a b", account: 0, followUp: false, ghosted: false, resume: "", sort: "", dir: "" });
    expect(cleanFilters({ stage: "Offer", sort: "company", dir: "desc", ghosted: true, account: 2 }))
      .toEqual({ stage: "Offer", q: "", account: 2, followUp: false, ghosted: true, resume: "", sort: "company", dir: "desc" });
    expect(cleanFilters("junk")).toEqual(f({ stage: "" }));
  });
  it("describes what a view keeps", () => {
    expect(describeFilters(f({ q: "acme", followUp: true, ghosted: true, sort: "lastActivity", account: 2 }), "me@x.com"))
      .toBe("Stage: Interview, Search: acme, Account: me@x.com, Needs follow-up, No reply, Sorted by last activity");
  });
});

describe("saving, applying, renaming, deleting", () => {
  it("saves a view and reads it back", async () => {
    const db = freshDb();
    const v = await saveView(db, "Interviews this month", f({ q: "acme" }));
    expect(v).toMatchObject({ id: 1, name: "Interviews this month", stage: "Interview", q: "acme" });
    expect(await loadSavedViews(db)).toEqual([v]);
    expect((await saveView(db, "Second", f({ stage: "Offer" }))).id).toBe(2);
  });
  it("refuses a view with nothing in it", async () => {
    const db = freshDb();
    await expect(saveView(db, "Empty", f({ stage: "" }))).rejects.toThrow(/filter first/);
    expect(await loadSavedViews(db)).toEqual([]);
  });
  it("refuses a name that is taken, ignoring case and accents", async () => {
    const db = freshDb();
    await saveView(db, "Café", f());
    await expect(saveView(db, "CAFE", f({ stage: "Offer" }))).rejects.toThrow(/already have a view/);
    expect((await loadSavedViews(db)).length).toBe(1);
  });
  it("keeps at most 12 views", async () => {
    const db = freshDb();
    for (let i = 0; i < SAVED_VIEWS_MAX; i++) await saveView(db, `View ${i}`, f({ q: `q${i}` }));
    await expect(saveView(db, "One too many", f({ q: "x" }))).rejects.toThrow(/12 saved views/);
    expect((await loadSavedViews(db)).length).toBe(SAVED_VIEWS_MAX);
    await deleteView(db, 3);
    await saveView(db, "Fits now", f({ q: "x" }));
    expect((await loadSavedViews(db)).length).toBe(SAVED_VIEWS_MAX);
  });
  it("never gives a new view the id of one just deleted when others remain", async () => {
    const db = freshDb();
    await saveView(db, "A", f());
    await saveView(db, "B", f({ stage: "Offer" }));
    await deleteView(db, 1);
    expect((await saveView(db, "C", f({ stage: "Applied" }))).id).toBe(3);
  });
  it("two saves at once both land and stay within the limit", async () => {
    const db = freshDb();
    await Promise.all([saveView(db, "One", f()), saveView(db, "Two", f({ stage: "Offer" }))]);
    expect((await loadSavedViews(db)).map((v) => v.name).sort()).toEqual(["One", "Two"]);
  });
  it("renames, refusing a taken or bad name and a view that is gone", async () => {
    const db = freshDb();
    const a = await saveView(db, "A", f());
    const b = await saveView(db, "B", f({ stage: "Offer" }));
    await renameView(db, a.id, "Renamed");
    expect((await loadSavedViews(db)).map((v) => v.name)).toEqual(["Renamed", "B"]);
    await renameView(db, a.id, "renamed");   // the same view keeps its own name's spelling changes
    await expect(renameView(db, a.id, "b")).rejects.toThrow(/already have/);
    await expect(renameView(db, a.id, "")).rejects.toThrow(ActionError);
    await expect(renameView(db, 99, "Ghost")).rejects.toThrow(/gone/);
    expect(b.id).toBe(2);
  });
  it("deletes one view and leaves the rest, and deleting a missing one is fine", async () => {
    const db = freshDb();
    await saveView(db, "A", f());
    await saveView(db, "B", f({ stage: "Offer" }));
    await deleteView(db, 1);
    await deleteView(db, 77);
    expect((await loadSavedViews(db)).map((v) => v.name)).toEqual(["B"]);
  });
});

describe("what is stored is checked on the way out", () => {
  it("drops bad entries, repeated ids and extras past the limit", () => {
    const good = (id: number) => ({ id, name: `V${id}`, stage: "Offer" });
    const raw = { views: [good(1), good(1), { id: "2", name: "x" }, { id: 3, name: "" }, { id: 4, name: "a‮b" }, "junk", null, ...Array.from({ length: 20 }, (_, i) => good(10 + i))] };
    const out = sanitizeSavedViews(raw);
    expect(out).toHaveLength(SAVED_VIEWS_MAX);
    expect(out[0].id).toBe(1);
    expect(out.some((v) => v.id === 3 || v.id === 4)).toBe(false);
  });
  it("reads anything that is not a list as none", () => {
    for (const bad of [null, undefined, 5, "x", {}, { views: "no" }]) expect(sanitizeSavedViews(bad)).toEqual([]);
  });
  it("cleans a hostile stored view's filters", () => {
    const [v] = sanitizeSavedViews({ views: [{ id: 1, name: "ok", stage: "<script>", q: "x", sort: "__proto__", account: 1e9 }] });
    expect([v.stage, v.sort, v.account]).toEqual(["", "", 1e9]);
  });
});

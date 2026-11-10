// The Tailor routes, the nav highlight, and ticking one AI line on the copy that is being edited.
import { describe, expect, it } from "vitest";
import { currentNav, PAGE_TITLES } from "../../../src/app/Shell";
import { matchRoute } from "../../../src/app/router";
import { ROUTES } from "../../../src/app/routes";
import { applyTick } from "../../../src/components/documents/tailorTicks";
import type { DocSection } from "../../../src/db/schema";
import type { TailorDraft } from "../../../src/sync/tailor";

describe("the Tailor routes", () => {
  it("match the picker and the workspace, keeping the baseline query", () => {
    expect(matchRoute("#/tailor")).toMatchObject({ page: "tailor", known: true, params: {} });
    expect(matchRoute("#/tailor/12?baseline=3")).toMatchObject({ page: "tailor", params: { id: "12" }, known: true });
    expect(matchRoute("#/tailor/12?baseline=3").query.get("baseline")).toBe("3");
  });

  it("add no nav item, are titled Tailor and highlight Resume", () => {
    expect(ROUTES.filter((r) => r.nav).map((r) => r.nav)).toEqual(["Applications", "People", "Resume", "Statistics"]);
    expect(PAGE_TITLES.tailor).toBe("Tailor");
    expect(currentNav("tailor")).toBe("resume");
  });
});

const sec = (id: string, ...items: [string, string][]): DocSection => ({ id, heading: "Work", items: items.map(([i, text]) => ({ id: i, text, kind: "bullet" as const })) });
const baseline = [sec("w", ["a", "A base"], ["b", "B base"], ["c", "C base"])];
const draft: Pick<TailorDraft, "resume" | "lines"> = {
  resume: [sec("w", ["a", "A ai"], ["n1", "N ai"])],
  // a is one to one; n1 replaces b and c
  lines: [
    { id: "a", sourceId: "a", changed: true, flags: [] },
    { id: "n1", sourceId: "b", sourceIds: ["b", "c"], changed: true, flags: [] },
  ],
};
const texts = (s: DocSection[]) => s.flatMap((x) => x.items).map((i) => i.text);

describe("applyTick", () => {
  it("unticking a one-to-one line puts the baseline's words back in the same place, and ticking restores the draft's", () => {
    const working = draft.resume;
    const off = applyTick(working, draft, baseline, "a", false);
    expect(texts(off)).toEqual(["A base", "N ai"]);
    expect(texts(applyTick(off, draft, baseline, "a", true))).toEqual(["A ai", "N ai"]);
  });

  it("unticking a line that replaced several brings all of them back, and ticking removes them again", () => {
    const off = applyTick(draft.resume, draft, baseline, "n1", false);
    expect(texts(off)).toEqual(["A ai", "B base", "C base"]);
    expect(texts(applyTick(off, draft, baseline, "n1", true))).toEqual(["A ai", "N ai"]);
  });

  it("leaves the person's own edits to other lines alone", () => {
    const edited = [sec("w", ["a", "A ai"], ["n1", "My own words"])];
    expect(texts(applyTick(edited, draft, baseline, "a", false))).toEqual(["A base", "My own words"]);
  });

  it("does not put back a line the person took out", () => {
    const gone = [sec("w", ["a", "A ai"])];
    expect(texts(applyTick(gone, draft, baseline, "n1", true))).toEqual(["A ai"]);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { $, $$, addApp, button, cleanup, click, freshDb, mountPage, submitForm, text, type, waitFor } from "../applications/harness";
import DetailPage from "../../../src/pages/detail";
import ApplicationsPage from "../../../src/pages/applications";
import { OfferDeadline } from "../../../src/components/offer/OfferDeadline";
import { setOfferDetails } from "../../../src/sync/actions";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

afterEach(cleanup);
const open = (db: ReturnType<typeof freshDb>, id: number) => mountPage(DetailPage, db, `/app/${id}`, { id: String(id) });

describe("the offer section on the application page", () => {
  it("shows at the Offer stage, with labelled fields and no explainer text", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { stage: "Offer" });
    const { container } = await open(db, id);
    await waitFor(() => $(container, ".offer") !== null);
    expect(text($(container, ".offer-title"))).toBe("Offer");
    expect(text($(container, `label[for="offer-${id}-salary"]`))).toBe("Salary");
    expect(text($(container, `label[for="offer-${id}-deadline"]`))).toBe("Decision deadline");
    expect(($(container, ".offer input[name=salary]") as HTMLInputElement).maxLength).toBe(60);
    expect(button($(container, ".offer")!, "Save offer details")).not.toBeNull();
    expect(button($(container, ".offer")!, "Clear")).toBeNull();      // nothing saved yet
    expect($(container, ".offer p.help")).toBeNull();
  });

  it("stays out of the way at other stages", async () => {
    const db = freshDb();
    const id = await addApp(db, "Plain", { stage: "Interview" });
    const { container } = await open(db, id);
    await waitFor(() => $(container, ".detail-facts") !== null);
    expect($(container, ".offer")).toBeNull();
  });

  it("stays when the application already has offer details, whatever the stage", async () => {
    const db = freshDb();
    const id = await addApp(db, "Moved", { stage: "Rejected" });
    await setOfferDetails(db, id, { salary: "$90k", deadline: "" });
    const { container } = await open(db, id);
    await waitFor(() => $(container, ".offer") !== null);
    expect(($(container, ".offer input[name=salary]") as HTMLInputElement).value).toBe("$90k");
  });

  it("saves the details, then lets you clear them", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { stage: "Offer" });
    const { container } = await open(db, id);
    await waitFor(() => $(container, ".offer") !== null);
    await type($(container, ".offer input[name=salary]"), "$120,000 + equity");
    await type($(container, ".offer input[name=deadline]"), "2026-10-15");
    await submitForm($(container, ".offer-form"));
    await waitFor(() => text($(container, ".offer-status")) === "Offer details saved.");
    expect(await db.applications.get(id)).toMatchObject({ offerSalary: "$120,000 + equity", offerDeadline: "2026-10-15" });

    await waitFor(() => button($(container, ".offer")!, "Clear") !== null);
    await click(button($(container, ".offer")!, "Clear"));
    await waitFor(() => text($(container, ".offer-status")) === "Offer details cleared.");
    const app = await db.applications.get(id);
    expect(app?.offerSalary).toBeUndefined();
    expect(app?.offerDeadline).toBeUndefined();
    expect(($(container, ".offer input[name=salary]") as HTMLInputElement).value).toBe("");
    expect(button($(container, ".offer")!, "Clear")).toBeNull();
  });

  it("shows what was refused and saves nothing", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { stage: "Offer" });
    const { container } = await open(db, id);
    await waitFor(() => $(container, ".offer") !== null);
    await type($(container, ".offer input[name=salary]"), "x".repeat(61));
    await type($(container, ".offer input[name=deadline]"), "2026-10-15");
    await submitForm($(container, ".offer-form"));
    await waitFor(() => $(container, ".offer-error") !== null);
    expect(text($(container, ".offer-error"))).toContain("60 characters");
    const app = await db.applications.get(id);
    expect(app?.offerSalary).toBeUndefined();
    expect(app?.offerDeadline).toBeUndefined();
  });
});

describe("the decision line in the list", () => {
  it("shows under the stage only at Offer with a deadline", async () => {
    const db = freshDb();
    const withDeadline = await addApp(db, "Has deadline", { stage: "Offer" });
    const noDeadline = await addApp(db, "No deadline", { stage: "Offer" });
    const notOffer = await addApp(db, "Moved on", { stage: "Rejected" });
    await setOfferDetails(db, withDeadline, { salary: "", deadline: `${new Date().getFullYear() + 1}-10-15` });
    await setOfferDetails(db, noDeadline, { salary: "$1", deadline: "" });
    await setOfferDetails(db, notOffer, { salary: "", deadline: "2030-10-15" });
    const { container } = await mountPage(ApplicationsPage, db, "/");
    await waitFor(() => $(container, `#stage-${withDeadline}`) !== null);
    const lines = $$(container, ".offer-deadline");
    expect(lines).toHaveLength(1);
    expect(text(lines[0])).toBe(`Decision by Oct 15, ${new Date().getFullYear() + 1}`);
    expect($(container, `#stage-${withDeadline}`)!.contains(lines[0])).toBe(true);
  });

  it("leaves the year off for a deadline this year", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const r = createRoot(root);
    await act(async () => r.render(createElement(OfferDeadline, { stage: "Offer", deadline: `${new Date().getFullYear()}-10-15` })));
    expect(text(root)).toBe("Decision by Oct 15");
    await act(async () => r.render(createElement(OfferDeadline, { stage: "Applied", deadline: "2026-10-15" })));
    expect(root.textContent).toBe("");
    await act(async () => r.render(createElement(OfferDeadline, { stage: "Offer", deadline: "not a day" })));
    expect(root.textContent).toBe("");
    await act(async () => r.unmount());
    root.remove();
  });
});

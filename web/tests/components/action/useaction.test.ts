import "fake-indexeddb/auto";
import { act, createElement as h, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useAction } from "../../../src/components/useAction";
import { cleanupRendered, click, q, render, settle } from "../../app/helpers";

afterEach(cleanupRendered);

/**
 * A browser moves focus to the page when the focused control becomes disabled. jsdom doesn't (and blur() does nothing on a
 * disabled control), so the action does it by hand while the buttons are disabled, as Chrome did in the real-focus run of this bug.
 */
function browserDropsFocus() {
  const el = document.activeElement as HTMLButtonElement;
  el.disabled = false;
  el.blur();
  el.disabled = true;
}

function Form({ body, remove = false }: { body: () => Promise<string | void>; remove?: boolean }) {
  const act_ = useAction();
  const [gone, setGone] = useState(false);
  return h("div", null,
    gone ? null : h("button", { id: "save", type: "button", onClick: () => void act_.run("save", async () => { await new Promise((r) => setTimeout(r, 30)); browserDropsFocus(); const r = await body(); if (remove) setGone(true); return r; }), ...act_.button("save") }, "Save"),
    h("button", { id: "other", type: "button", ...act_.button("other") }, "Other"),
    h("input", { id: "field" }),
    h("p", { id: "status", role: "status" }, act_.status ?? ""),
    h("p", { id: "error", role: "alert" }, act_.error ?? ""));
}

describe("useAction focus", () => {
  it("puts focus back on the button that was pressed once the action is done", async () => {
    await render(h(Form, { body: async () => "Saved." }));
    const save = q<HTMLButtonElement>("#save")!;
    save.focus();
    expect(document.activeElement).toBe(save);
    await click(save);
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    await settle();
    expect(q("#status")!.textContent).toBe("Saved.");
    expect(save.disabled).toBe(false);
    expect(document.activeElement).toBe(save);
  });

  it("does the same after a failure, so a retry is one key away", async () => {
    await render(h(Form, { body: async () => { throw new Error("nope"); } }));
    const save = q<HTMLButtonElement>("#save")!;
    save.focus();
    await click(save);
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    await settle();
    expect(q("#error")!.textContent).not.toBe("");
    expect(document.activeElement).toBe(save);
  });

  it("leaves focus alone when something else took it meanwhile", async () => {
    await render(h(Form, { body: async () => { (q("#field") as HTMLElement).focus(); } }));
    const save = q<HTMLButtonElement>("#save")!;
    save.focus();
    await click(save);
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    await settle();
    expect(document.activeElement).toBe(q("#field"));
  });

  it("doesn't throw or steal focus when the pressed control is gone afterwards", async () => {
    await render(h(Form, { body: async () => undefined, remove: true }));
    const save = q<HTMLButtonElement>("#save")!;
    save.focus();
    await click(save);
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    await settle();
    expect(save.isConnected).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});

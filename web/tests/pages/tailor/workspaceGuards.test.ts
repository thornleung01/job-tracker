// The Tailor workspace's guards on unsaved work: the browser's own close/reload warning, a cover letter draft, Save clearing it, Escape on the
// question, the Baseline select being a change in itself, the Back link with a modifier key, and focus after "Keep my edits" and after Enter in the unlock form.
import "fake-indexeddb/auto";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blockLeave } from "../../../src/app/leaveGuard";
import { getTailored, startTailoredFromBaseline } from "../../../src/sync/documents";
import { $, button, cleanup, click, key, text, type, waitFor } from "../applications/harness";
import { field, setup } from "./harness";

afterEach(cleanup);
beforeEach(() => localStorage.removeItem("jobtracker:resume-editing"));

const BULLET = "Bullet 3 of Work experience";
const strip = (c: HTMLElement) => $(c, "section.tailor-ai") as HTMLElement | null;

/** What the browser asks when the tab is closed or reloaded: true when the page asked to be asked. */
function closeWarns(): boolean {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

async function startCopy(c: HTMLElement) {
  await click(button(c, "Start from baseline"));
  await waitFor(() => $(c, ".page-editor") !== null, "the editor");
}

describe("the close and reload warning", () => {
  it("is off until there is an edit, on after one, and off again once it is saved", async () => {
    const { container } = await setup({ saved: "none" });
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    expect(closeWarns()).toBe(false);
    await startCopy(container);
    expect(closeWarns()).toBe(false);   // a copy that was just started has nothing unsaved
    await type(field(container, BULLET), "An unsaved edit.");
    expect(closeWarns()).toBe(true);
    await click(button(container, "Save"));
    await waitFor(() => text($(container, ".tailor-status")) === "Saved.", "the save");
    expect(closeWarns()).toBe(false);
  });
});

describe("moving away", () => {
  it("is stopped by a letter draft nobody has saved, and not after it is saved", async () => {
    const { container } = await setup();
    await waitFor(() => button(container, "Cover letter") !== null, "the page");
    await click(button(container, "Cover letter"));
    expect(blockLeave("#/people")).toBe(false);
    await click(button(container, "Write with AI"));
    await click(button(strip(container)!, "Write"));
    await waitFor(() => $(container, "#tailor-letter-draft") !== null, "the letter draft");
    expect(closeWarns()).toBe(true);
    await act(async () => void expect(blockLeave("#/people")).toBe(true));
    expect(text($(container, ".inline-confirm"))).toContain("Leave without saving?");
    await click(button($(container, ".inline-confirm")!, "Cancel"));
    await click(button(container, "Save letter"));
    await waitFor(() => text($(container, ".tailor-status")) === "Saved the letter.", "the save");
    expect(blockLeave("#/people")).toBe(false);
  });

  it("goes straight through after a Save, because nothing is left unsaved", async () => {
    const { container } = await setup({ saved: "none" });
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    await startCopy(container);
    await type(field(container, BULLET), "An unsaved edit.");
    await click(button(container, "Save"));
    await waitFor(() => text($(container, ".tailor-status")) === "Saved.", "the save");
    expect(blockLeave("#/people")).toBe(false);
    expect($(container, ".inline-confirm")).toBeNull();
  });

  it("asks only once the page has something to lose, and Escape on the question closes it and keeps the work", async () => {
    const { container, visited } = await setup({ saved: "none" });
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    await startCopy(container);
    const box = field(container, BULLET)!;
    await type(box, "An unsaved edit.");
    await act(async () => void blockLeave("#/people"));
    const confirm = $(container, ".inline-confirm")!;
    expect(confirm).not.toBeNull();
    await key(button(confirm, "Cancel"), "Escape");
    expect($(container, ".inline-confirm")).toBeNull();
    expect(visited).toEqual([]);
    expect(field(container, BULLET)!.value).toBe("An unsaved edit.");
  });

  it("does not stop the Back link when it is opened in a new tab (a modifier key or the middle button)", async () => {
    const { container } = await setup({ saved: "none" });
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    await startCopy(container);
    await type(field(container, BULLET), "An unsaved edit.");
    const back = $(container, "a.back") as HTMLAnchorElement;
    // Record what the app decided, then stop jsdom from following the link itself: a real hash change
    // would reach the leave guard and show the confirm, which on a slow runner lands before the check.
    let prevented: boolean | null = null;
    const record = (e: Event) => { prevented = e.defaultPrevented; e.preventDefault(); };
    document.addEventListener("click", record);
    try {
      for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
        prevented = null;
        const e = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
        await act(async () => void back.dispatchEvent(e));
        expect(prevented).toBe(false);
        expect($(container, ".inline-confirm")).toBeNull();
      }
    } finally {
      document.removeEventListener("click", record);
    }
    const plain = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => void back.dispatchEvent(plain));
    expect(plain.defaultPrevented).toBe(true);
    expect($(container, ".inline-confirm")).not.toBeNull();
  });
});

describe("the Baseline select", () => {
  it("choosing another baseline for a saved copy enables Save, saves the choice, and leaves nothing unsaved", async () => {
    const { container, db, id, versions } = await setup({
      saved: "none", versions: ["A version", "B version"],
      prepare: async ({ db: d, id: a, versions: v }) => void (await startTailoredFromBaseline(d, a, v[0])),
    });
    const select = () => $(container, "#tailor-baseline") as HTMLSelectElement;
    await waitFor(() => select() !== null, "the page");
    const save = () => button(container, "Save") as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    await type(select(), String(versions[1]));
    expect(save().disabled).toBe(false);
    await act(async () => void expect(blockLeave("#/people")).toBe(true));
    await click(button($(container, ".inline-confirm")!, "Cancel"));
    await click(save());
    await waitFor(() => text($(container, ".tailor-status")) === "Saved.", "the save");
    expect((await getTailored(db, id))!.basedOn).toBe(versions[1]);
    expect(save().disabled).toBe(true);
    expect(blockLeave("#/people")).toBe(false);
  });
});

describe("focus", () => {
  it("Keep my edits puts focus back on Write", async () => {
    const { container } = await setup();
    await waitFor(() => button(container, "Start from baseline") !== null, "the page");
    await startCopy(container);
    await type(field(container, BULLET), "My own wording of this bullet.");
    await click(button(container, "Rewrite with AI"));
    await click(button(strip(container)!, "Write"));
    expect(text(strip(container))).toContain("Replace your edits with a new draft?");
    await click(button(strip(container)!, "Keep my edits"));
    const write = button(strip(container)!, "Write") as HTMLButtonElement;
    expect(write.disabled).toBe(false);
    expect(document.activeElement).toBe(write);
  });

  it("Enter in the passphrase field submits the unlock form", async () => {
    const { container, fake } = await setup({ saved: "locked" });
    await waitFor(() => button(container, "Write with AI") !== null, "the page");
    await click(button(container, "Write with AI"));
    const pass = $(strip(container)!, "input[type=password]") as HTMLInputElement;
    await type(pass, "right");
    // A browser turns Enter in a text field into a submit of its form; the form's own handler is what counts.
    await act(async () => $(strip(container)!, "form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await waitFor(() => fake.unlock.mock.calls.length === 1, "the unlock");
    expect(fake.unlock).toHaveBeenCalledWith(expect.any(String), "right");
    await waitFor(() => button(strip(container)!, "Write") !== null, "Write");
  });
});

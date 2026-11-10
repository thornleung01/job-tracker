import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { PageProps } from "../../../src/app/pageProps";
import { AI_MESSAGES, AiError, type AiDeps, type AiErrorCode } from "../../../src/ai";
import { MAX_AI_INPUT_CHARS } from "../../../src/db/limits";
import type { DocSection, JobTrackerDB } from "../../../src/db/schema";
import ResumePage from "../../../src/pages/resume";
import type { ConvertResult, convertResume } from "../../../src/sync/convert";
import { getMaster, saveMaster } from "../../../src/sync/documents";
import { KEY, PASSPHRASE, testVault } from "../../ai/helpers";
import { file } from "../../documents/fixtures";
import { $, $$, button as findButton, cleanup, click, freshDb, mountPage, settle, text, type, waitFor } from "../applications/harness";

afterEach(cleanup);

const RESUME_TEXT = "Jane Smith\nEXPERIENCE\n- Built a weekly reporting model\n- Cut close time by two days\nSKILLS\n- Writes SQL and Python daily";
const SECTIONS = [{ heading: "Old", items: [{ text: "Old line" }] }];

/** What a finished conversion looks like: ids are fixed so the flags can point at lines. */
const converted: ConvertResult = {
  sections: [
    { id: "s1", heading: "Experience", items: [{ id: "i-org", text: "Acme", kind: "org" }, { id: "i-b1", text: "Cut costs by 30%", kind: "bullet", label: "Savings" }, { id: "i-b2", text: "Built a model", kind: "bullet" }] },
    { id: "s2", heading: "Skills", items: [{ id: "i-sk", text: "SQL", kind: "skill" }] },
  ] as DocSection[],
  flags: [
    { itemId: "i-b1", kind: "detail", note: "30% isn't in your file" },
    { itemId: "i-b2", kind: "label", note: "Check this label" },
  ],
  unused: ["Hobbies", "Chess"],
};

type Convert = typeof convertResume;
type Saved = "none" | "locked" | "unlocked";
let ai: AiDeps;
let fetchSpy: MockInstance<typeof fetch>;
const button = (root: ParentNode, label: string) => findButton(root, label) as HTMLButtonElement | null;

/** The real vault (one iteration, in memory) with a key saved the way a person would have: unlocked, locked again, or not at all. */
async function seedVault(db: string, saved: Saved): Promise<AiDeps> {
  const vault = testVault();
  if (saved !== "none") {
    await vault.save(db, KEY, PASSPHRASE, "claude-sonnet-5-5");
    if (saved === "locked") vault.lock(db);
  }
  return { vault, complete: async () => { throw new Error("the page must not call the API itself"); } };
}

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

async function mount(db: JobTrackerDB, convert: Convert, saved: Saved = "unlocked") {
  ai = await seedVault(db.name, saved);
  const Page = (props: PageProps) => createElement(ResumePage, { ...props, deps: { ai, convert } });
  const page = await mountPage(Page, db, "/resume");
  await waitFor(() => $(page.container, ".resume-view") !== null, "the page to load");
  return page;
}

/** Pastes text and lands on the convert panel. */
async function paste(container: HTMLElement, value = RESUME_TEXT) {
  await click(button(container, "Paste text"));
  await type($(container, "#resume-paste"), value);
  await click(button(container, "Use this text"));
}
const panel = (c: HTMLElement) => $(c, ".convert-panel")!;
const sent = (c: HTMLElement) => ($(panel(c), "textarea.convert-text") as HTMLTextAreaElement).value;
const fields = (root: ParentNode, label: RegExp) => $$(root, "input, textarea").filter((e) => label.test(e.getAttribute("aria-label") ?? "")) as HTMLInputElement[];
const flagRows = (c: HTMLElement) => $$(c, ".convert-flags li");

/** A convert that stays open until the test resolves, rejects or aborts it. */
function held() {
  let resolve!: (r: ConvertResult) => void;
  let reject!: (e: unknown) => void;
  const fn = vi.fn((_text: string, _deps: AiDeps, o: { db: string; signal?: AbortSignal }) => new Promise<ConvertResult>((res, rej) => {
    resolve = res;
    reject = rej;
    o.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError")));
  }));
  return { fn: fn as unknown as Convert & typeof fn, resolve: (r: ConvertResult) => resolve(r), reject: (e: unknown) => reject(e) };
}

describe("the convert panel", () => {
  it("shows exactly the text that will be sent, with its length, and sends nothing yet", async () => {
    const convert = vi.fn(async () => converted);
    const { container } = await mount(freshDb(), convert as unknown as Convert);
    await paste(container);
    expect(text($(panel(container), "h2"))).toBe("Convert to your template");
    expect(text(panel(container))).toContain("This is the text that will be sent to Anthropic with your key:");
    expect(sent(container)).toBe(RESUME_TEXT);
    expect(($(panel(container), "textarea.convert-text") as HTMLTextAreaElement).readOnly).toBe(true);
    expect(text(panel(container))).toContain(`${RESUME_TEXT.length} characters`);
    expect(convert).not.toHaveBeenCalled();
  });

  it("shows the text of an uploaded file", async () => {
    const { container } = await mount(freshDb(), vi.fn() as unknown as Convert);
    const input = $(container, "input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file("r.txt", RESUME_TEXT)], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitFor(() => $(container, ".convert-panel") !== null, "the panel");
    expect(sent(container)).toBe(RESUME_TEXT);
  });

  it("with no key: points to Settings, has no Convert button, and the simple converter is the main button", async () => {
    const { container } = await mount(freshDb(), vi.fn() as unknown as Convert, "none");
    await paste(container);
    expect(button(container, "Convert with AI")).toBeNull();
    expect(text(panel(container))).toContain("Add your Anthropic key in Settings to convert with AI.");
    expect($$(panel(container), "a").find((a) => text(a) === "Settings")!.getAttribute("href")).toBe("#/settings/ai");
    expect(button(container, "Use the simple converter")!.classList.contains("primary")).toBe(true);
  });

  it("with a locked key: asks for the passphrase, shows the sentence for a wrong one, then unlocks and offers Convert", async () => {
    const db = freshDb();
    const { container } = await mount(db, vi.fn() as unknown as Convert, "locked");
    const unlock = vi.spyOn(ai.vault, "unlock");
    await paste(container);
    expect(button(container, "Convert with AI")).toBeNull();
    const pass = () => $(panel(container), "input[type=password]") as HTMLInputElement;
    expect(pass().labels?.[0]?.textContent).toBe("Passphrase");
    await type(pass(), "nope");
    await click(button(container, "Unlock"));
    await waitFor(() => $(panel(container), ".notice.err") !== null, "the error");
    expect(unlock).toHaveBeenCalledWith(db.name, "nope");
    expect(text($(panel(container), ".notice.err"))).toBe(AI_MESSAGES.wrongPassphrase);
    expect(pass().value).toBe("");
    expect(document.activeElement).toBe(pass());
    expect(button(container, "Convert with AI")).toBeNull();
    expect(button(container, "Use the simple converter")).not.toBeNull();
    await type(pass(), PASSPHRASE);
    await click(button(container, "Unlock"));
    await waitFor(() => pass() === null, "the unlock form to go");
    expect($(panel(container), ".notice.err")).toBeNull();
    expect(button(container, "Convert with AI")!.classList.contains("primary")).toBe(true);
  });

  it("with an unlocked key: offers Convert straight away", async () => {
    const { container } = await mount(freshDb(), vi.fn() as unknown as Convert);
    await paste(container);
    expect(button(container, "Convert with AI")).not.toBeNull();
    expect($(panel(container), "input[type=password]")).toBeNull();
    expect(button(container, "Use the simple converter")!.classList.contains("primary")).toBe(false);
  });

  it("calls convert with the text, the database name and an abort signal, and shows Converting while it works", async () => {
    const h = held();
    const db = freshDb();
    const { container } = await mount(db, h.fn);
    await paste(container);
    await click(button(container, "Convert with AI"));
    expect(h.fn).toHaveBeenCalledTimes(1);
    const [sentText, deps, options] = h.fn.mock.calls[0];
    expect(sentText).toBe(RESUME_TEXT);
    expect(deps.vault.status(db.name).state).toBe("unlocked");
    expect(options.db).toBe(db.name);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal!.aborted).toBe(false);
    expect(text($(panel(container), "[role=status]"))).toBe("Converting");
    const go = button(container, "Convert with AI")!;
    expect(go.disabled).toBe(true);
    expect(go.getAttribute("aria-busy")).toBe("true");
    expect(button(container, "Stop")!.disabled).toBe(false);
    expect(button(container, "Use the simple converter")!.disabled).toBe(true);
    h.resolve(converted);
    await waitFor(() => button(container, "Save as master resume") !== null, "the review");
  });

  it("Stop aborts, says nothing is wrong, and the panel can be used again", async () => {
    const h = held();
    const { container } = await mount(freshDb(), h.fn);
    await paste(container);
    await click(button(container, "Convert with AI"));
    const signal = h.fn.mock.calls[0][2].signal!;
    await click(button(container, "Stop"));
    expect(signal.aborted).toBe(true);
    await waitFor(() => button(container, "Stop") === null, "the panel to come back");
    expect($(container, ".notice.err")).toBeNull();
    expect(text($(panel(container), "[role=status]"))).toBe("");
    expect(button(container, "Convert with AI")!.disabled).toBe(false);
    await click(button(container, "Convert with AI"));
    expect(h.fn).toHaveBeenCalledTimes(2);
    expect(h.fn.mock.calls[1][2].signal!.aborted).toBe(false);
  });

  it("shows an AI error's own sentence and keeps the panel to try again", async () => {
    const convert = vi.fn().mockRejectedValueOnce(new AiError("rateLimited")).mockResolvedValueOnce(converted);
    const { container } = await mount(freshDb(), convert as unknown as Convert);
    await paste(container);
    await click(button(container, "Convert with AI"));
    await waitFor(() => $(panel(container), ".notice.err") !== null, "the error");
    expect(text($(panel(container), ".notice.err"))).toBe(AI_MESSAGES.rateLimited);
    expect(button(container, "Use the simple converter")).not.toBeNull();
    await click(button(container, "Convert with AI"));
    await waitFor(() => button(container, "Save as master resume") !== null, "the review");
  });

  it("shows the generic line for any other error, never its text", async () => {
    const convert = vi.fn().mockRejectedValue(new Error("secret internals sk-ant-123"));
    const { container } = await mount(freshDb(), convert as unknown as Convert);
    await paste(container);
    await click(button(container, "Convert with AI"));
    await waitFor(() => $(panel(container), ".notice.err") !== null, "the error");
    expect(text($(panel(container), ".notice.err"))).toBe("Couldn't finish that. Try again.");
  });

  it("disables Convert for text that is too long to send, while the simple converter still works", async () => {
    const convert = vi.fn();
    const { container } = await mount(freshDb(), convert as unknown as Convert);
    // Pasted text is read up to the file size limit, which is larger than the AI limit.
    await paste(container, `Jane Smith\nEXPERIENCE\n${"x".repeat(MAX_AI_INPUT_CHARS + 10)}`);
    expect(text($(panel(container), ".notice.err"))).toBe("That's too long to send. Shorten it and try again.");
    expect(button(container, "Convert with AI")!.disabled).toBe(true);
    await click(button(container, "Convert with AI"));
    expect(convert).not.toHaveBeenCalled();
    await click(button(container, "Use the simple converter"));
    expect(button(container, "Save as master resume")).not.toBeNull();
  });

  it("Cancel closes the panel and saves nothing", async () => {
    const db = freshDb();
    const { container } = await mount(db, vi.fn() as unknown as Convert);
    await paste(container);
    await click(button(container, "Cancel"));
    expect($(container, ".convert-panel")).toBeNull();
    expect(button(container, "Upload a file")).not.toBeNull();
    expect(await db.documents.count()).toBe(0);
  });
});

describe("checking an AI conversion", () => {
  async function converting() {
    const db = freshDb();
    const convert = vi.fn(async () => converted);
    const page = await mount(db, convert as unknown as Convert);
    await paste(page.container);
    await click(button(page.container, "Convert with AI"));
    await waitFor(() => button(page.container, "Save as master resume") !== null, "the review");
    return { db, convert, ...page };
  }

  it("opens the review with the converted lines, a summary and the lines to check, and saves nothing yet", async () => {
    const { db, container } = await converting();
    expect(text($(container, ".convert-review .convert-summary"))).toBe("Converted with AI. Check each line before you save.");
    expect($(container, ".convert-panel")).toBeNull();
    expect(fields(container, /^Heading of section/).map((e) => e.value)).toEqual(["Experience", "Skills"]);
    expect(fields(container, /^Bullet \d of Experience/).map((e) => e.value)).toEqual(["Cut costs by 30%", "Built a model"]);
    expect(text($(container, ".convert-flags-title"))).toBe("Check these lines");
    const rows = flagRows(container);
    expect(rows.map((r) => text($(r, ".convert-flag-note")))).toEqual(["30% isn't in your file", "Check this label"]);
    expect(rows.map((r) => text($(r, ".convert-flag-line")))).toEqual(["Cut costs by 30%", "Built a model"]);
    // the list sits above the editor
    expect($(container, ".convert-flags")!.compareDocumentPosition($(container, ".doc-editor")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await db.documents.count()).toBe(0);
  });

  it("Go to line focuses that line's text field", async () => {
    const { container } = await converting();
    await click(button(flagRows(container)[1], "Go to line"));
    expect(document.activeElement).toBe($(container, '[data-field="i-b2"]'));
    expect((document.activeElement as HTMLTextAreaElement).value).toBe("Built a model");
    await click(button(flagRows(container)[0], "Go to line"));
    expect(document.activeElement).toBe($(container, '[data-field="i-b1"]'));
  });

  it("Dismiss removes one flag, moves focus on, and removes the list when none are left", async () => {
    const { container } = await converting();
    await click(button(flagRows(container)[0], "Dismiss"));
    expect(flagRows(container).map((r) => text($(r, ".convert-flag-note")))).toEqual(["Check this label"]);
    expect(document.activeElement).toBe(button(flagRows(container)[0], "Dismiss"));
    await click(button(flagRows(container)[0], "Dismiss"));
    expect($(container, ".convert-flags")).toBeNull();
    expect(document.activeElement).toBe($(container, ".convert-review h2"));
  });

  it("lists the words not used from the file in a collapsed section", async () => {
    const { container } = await converting();
    const details = $(container, "details.convert-unused") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(text($(details, "summary"))).toBe("Not used from your file");
    expect(text($(details, "p"))).toBe("Hobbies, Chess");
  });

  it("leaves out the section when everything was used", async () => {
    const db = freshDb();
    const convert = vi.fn(async () => ({ ...converted, unused: [], flags: [] }));
    const { container } = await mount(db, convert as unknown as Convert);
    await paste(container);
    await click(button(container, "Convert with AI"));
    await waitFor(() => button(container, "Save as master resume") !== null, "the review");
    expect($(container, "details.convert-unused")).toBeNull();
    expect($(container, ".convert-flags")).toBeNull();
  });

  it("saves the master with source ai, only when Save as master resume is pressed", async () => {
    const { db, container } = await converting();
    await type(fields(container, /^Bullet 3 of Experience/)[0], "Built a reporting model");
    expect(await db.documents.count()).toBe(0);
    await click(button(container, "Save as master resume"));
    await waitFor(() => $(container, "h2.section")?.textContent === "Master resume", "the master card");
    const master = (await getMaster(db))!;
    expect(master.source).toBe("ai");
    expect(master.sections.map((s) => s.heading)).toEqual(["Experience", "Skills"]);
    expect(master.sections[0].items[2].text).toBe("Built a reporting model");
  });

  it("Convert again goes back to the panel with the same text", async () => {
    const { container, convert } = await converting();
    await click(button(container, "Convert again"));
    expect($(container, ".convert-review")).toBeNull();
    expect(sent(container)).toBe(RESUME_TEXT);
    await click(button(container, "Convert with AI"));
    await waitFor(() => button(container, "Save as master resume") !== null, "the review");
    expect(convert).toHaveBeenCalledTimes(2);
  });

  it("Use the simple converter swaps in the rule-based sections, and saves with the old source", async () => {
    const { db, container } = await converting();
    await click(button(container, "Use the simple converter"));
    expect(fields(container, /^Heading of section/).map((e) => e.value)).toEqual(["Summary", "EXPERIENCE", "SKILLS"]);
    expect($(container, ".convert-flags")).toBeNull();
    expect(button(container, "Convert again")).toBeNull();
    expect(await db.documents.count()).toBe(0);
    await click(button(container, "Save as master resume"));
    await waitFor(() => $(container, "h2.section")?.textContent === "Master resume", "the master card");
    expect((await getMaster(db))!.source).toBe("paste");
  });

  it("the simple converter from the panel saves with the old source and never calls convert", async () => {
    const db = freshDb();
    const convert = vi.fn();
    const { container } = await mount(db, convert as unknown as Convert);
    await paste(container);
    await click(button(container, "Use the simple converter"));
    expect($(container, ".convert-summary")).toBeNull();
    await click(button(container, "Save as master resume"));
    await waitFor(() => $(container, "h2.section")?.textContent === "Master resume", "the master card");
    expect((await getMaster(db))!.source).toBe("paste");
    expect(convert).not.toHaveBeenCalled();
  });
});

describe("replacing an existing master", () => {
  it("converts the same way, and the master changes only on Save", async () => {
    const db = freshDb();
    await saveMaster(db, SECTIONS, "paste");
    const convert = vi.fn(async () => converted);
    const { container } = await mount(db, convert as unknown as Convert);
    await click(button(container, "Paste text"));
    await type($(container, "#resume-paste"), RESUME_TEXT);
    await click(button(container, "Use this text"));
    expect(sent(container)).toBe(RESUME_TEXT);
    await click(button(container, "Convert with AI"));
    await waitFor(() => button(container, "Save as master resume") !== null, "the review");
    expect(text($(container, ".convert-review h2"))).toBe("Replace your master resume");
    expect($$(container, ".convert-flags li")).toHaveLength(2);
    expect((await getMaster(db))!.sections.map((s) => s.heading)).toEqual(["Old"]);
    await click(button(container, "Save as master resume"));
    await waitFor(() => $(container, "h2.section")?.textContent === "Master resume", "the card");
    const master = (await getMaster(db))!;
    expect(master.source).toBe("ai");
    expect(master.sections.map((s) => s.heading)).toEqual(["Experience", "Skills"]);
    expect(await db.documents.count()).toBe(1);
  });

  it("can be cancelled from the panel with the master untouched", async () => {
    const db = freshDb();
    await saveMaster(db, SECTIONS, "paste");
    const { container } = await mount(db, vi.fn() as unknown as Convert);
    await click(button(container, "Paste text"));
    await type($(container, "#resume-paste"), RESUME_TEXT);
    await click(button(container, "Use this text"));
    await click(button(container, "Cancel"));
    expect($(container, ".convert-panel")).toBeNull();
    expect((await getMaster(db))!.sections.map((s) => s.heading)).toEqual(["Old"]);
    await settle();
  });
});

/** The convert panel on screen, with the key in the state the test asks for. */
async function panelWith(convert: Convert, saved: Saved = "unlocked") {
  const db = freshDb();
  const page = await mount(db, convert, saved);
  await paste(page.container);
  return { db, ...page };
}
const errorText = (c: HTMLElement) => text($(panel(c), ".notice.err"));

describe("focus while converting", () => {
  it("moves to Stop when converting starts, and back to Convert when it ends", async () => {
    const h = held();
    const { container } = await panelWith(h.fn);
    const go = button(container, "Convert with AI")!;
    go.focus();
    await click(go);
    expect(document.activeElement).toBe(button(container, "Stop"));
    await click(button(container, "Stop"));
    await waitFor(() => document.activeElement === button(container, "Convert with AI"), "focus to come back");
  });

  it("goes back to Convert after a failure too", async () => {
    const convert = vi.fn().mockRejectedValue(new AiError("busy"));
    const { container } = await panelWith(convert as unknown as Convert);
    const go = button(container, "Convert with AI")!;
    go.focus();
    await click(go);
    await waitFor(() => errorText(container) !== "", "the error");
    await waitFor(() => document.activeElement === button(container, "Convert with AI"), "focus to come back");
  });
});

describe("stopping, leaving and pressing twice", () => {
  it("Stop, then the convert resolves anyway: the result is dropped and nothing is shown", async () => {
    let finish!: (r: ConvertResult) => void;
    const convert = vi.fn(() => new Promise<ConvertResult>((r) => { finish = r; }));   // ignores the abort signal
    const { container } = await panelWith(convert as unknown as Convert);
    await click(button(container, "Convert with AI"));
    await click(button(container, "Stop"));
    await act(async () => finish(converted));
    await settle();
    expect($(container, ".convert-review")).toBeNull();
    expect($(container, ".notice")).toBeNull();
    expect(button(container, "Convert with AI")!.disabled).toBe(false);
    expect(text($(panel(container), "[role=status]"))).toBe("");
  });

  it("Stop, then the convert rejects anyway: no error is shown", async () => {
    let fail!: (e: unknown) => void;
    const convert = vi.fn(() => new Promise<ConvertResult>((_, rej) => { fail = rej; }));
    const { container } = await panelWith(convert as unknown as Convert);
    await click(button(container, "Convert with AI"));
    await click(button(container, "Stop"));
    await act(async () => fail(new AiError("offline")));
    await settle();
    expect($(container, ".notice")).toBeNull();
  });

  it("leaving the page aborts the request, and a late result does nothing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = held();
    const { container } = await panelWith(h.fn);
    await click(button(container, "Convert with AI"));
    const { signal } = h.fn.mock.calls[0][2];
    await cleanup();
    expect(signal!.aborted).toBe(true);
    await act(async () => h.resolve(converted));
    await settle();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("leaving the page, then a late failure or a late unlock does nothing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = held();
    const first = await panelWith(h.fn);
    await click(button(first.container, "Convert with AI"));
    await cleanup();
    await act(async () => h.reject(new AiError("offline")));

    let open!: () => void;
    const { container } = await panelWith(vi.fn() as unknown as Convert, "locked");
    vi.spyOn(ai.vault, "unlock").mockImplementation(() => new Promise<void>((r) => { open = r; }));
    await type($(panel(container), "input[type=password]"), PASSPHRASE);
    await click(button(container, "Unlock"));
    await cleanup();
    await act(async () => open());
    await settle();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("runs once when Convert is pressed twice in a row", async () => {
    const h = held();
    const { container } = await panelWith(h.fn);
    const go = button(container, "Convert with AI")!;
    await act(async () => {
      go.click();
      go.click();
    });
    expect(h.fn).toHaveBeenCalledTimes(1);
    h.resolve(converted);
    await waitFor(() => button(container, "Save as master resume") !== null, "the review");
    expect(h.fn).toHaveBeenCalledTimes(1);
  });
});

describe("the key changing under the panel", () => {
  it.each([["locked", "locked"], ["noKey", "none"]] as const)("a %s error shows its sentence and the panel recovers", async (code, now) => {
    const convert = vi.fn().mockRejectedValue(new AiError(code));
    const { db, container } = await panelWith(convert as unknown as Convert);
    if (now === "locked") ai.vault.lock(db.name);
    else ai.vault.forget(db.name);
    await click(button(container, "Convert with AI"));
    await waitFor(() => errorText(container) === AI_MESSAGES[code], "the sentence");
    expect(button(container, "Convert with AI")).toBeNull();
    if (now === "locked") expect($(panel(container), "input[type=password]")).not.toBeNull();
    else expect(text(panel(container))).toContain("Add your Anthropic key in Settings");
    expect(button(container, "Use the simple converter")).not.toBeNull();
  });

  // workspaceKey arrives with the AI foundation fixes; until it does it is left out
  const codes = (["orgBlocked", "needsCredit", "spendLimit", "timeout", "refused", "busy", "offline", "noKey", "locked", "workspaceKey"] as AiErrorCode[]).filter((c) => c in AI_MESSAGES);
  it.each(codes)("shows the sentence for %s", async (code) => {
    const convert = vi.fn().mockRejectedValue(new AiError(code));
    const { container } = await panelWith(convert as unknown as Convert);
    await click(button(container, "Convert with AI"));
    await waitFor(() => errorText(container) === AI_MESSAGES[code], "the sentence");
  });
});

describe("the review", () => {
  async function review() {
    const page = await panelWith(vi.fn(async () => converted) as unknown as Convert);
    await click(button(page.container, "Convert with AI"));
    await waitFor(() => button(page.container, "Save as master resume") !== null, "the review");
    return page;
  }

  it("drops a flag when its line is edited", async () => {
    const { container } = await review();
    expect(flagRows(container)).toHaveLength(2);
    await type($(container, '[data-field="i-b1"]'), "Cut costs by 31%");
    expect(flagRows(container).map((r) => text($(r, ".convert-flag-note")))).toEqual(["Check this label"]);
  });

  it("drops a flag when its line is deleted", async () => {
    const { container } = await review();
    await click($(container, '[aria-label="Remove line 2"]'));
    expect(flagRows(container).map((r) => text($(r, ".convert-flag-note")))).toEqual(["Check this label"]);
  });

  it("shows the generic line and keeps the review when saving fails", async () => {
    const { db, container } = await review();
    vi.spyOn(db.documents, "add").mockRejectedValueOnce(new Error("disk full"));
    await click(button(container, "Save as master resume"));
    await waitFor(() => text($(container, ".convert-review .notice.err")) === "Couldn't finish that. Try again.", "the error");
    expect(button(container, "Save as master resume")).not.toBeNull();
    expect(fields(container, /^Heading of section/).map((e) => e.value)).toEqual(["Experience", "Skills"]);
    expect(await db.documents.count()).toBe(0);
  });
});

describe("a file instead of pasted text", () => {
  it("saves with source upload through the simple converter", async () => {
    const db = freshDb();
    const { container } = await mount(db, vi.fn() as unknown as Convert);
    const input = $(container, "input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file("r.txt", RESUME_TEXT)], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitFor(() => $(container, ".convert-panel") !== null, "the panel");
    await click(button(container, "Use the simple converter"));
    await click(button(container, "Save as master resume"));
    await waitFor(() => $(container, "h2.section")?.textContent === "Master resume", "the master card");
    expect((await getMaster(db))!.source).toBe("upload");
  });
});

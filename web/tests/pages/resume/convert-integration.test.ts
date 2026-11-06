// The Resume page with the AI side wired for real: the real vault (one iteration, in memory), the real client over a scripted fetch and the real
// convertResume. Only the network is replaced. It follows one person from a locked key to a saved master resume.
import "fake-indexeddb/auto";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageProps } from "../../../src/app/pageProps";
import { AI_URL, createClient } from "../../../src/ai/client";
import ResumePage from "../../../src/pages/resume";
import { convertResume } from "../../../src/sync/convert";
import { getMaster } from "../../../src/sync/documents";
import { KEY, PASSPHRASE, testVault } from "../../ai/helpers";
import { $, $$, button as findButton, cleanup, click, freshDb, mountPage, text, type, waitFor } from "../applications/harness";

afterEach(cleanup);

const RESUME_TEXT = "Jane Smith\nEXPERIENCE\n- Built a weekly reporting model\n- Cut close time by two days\nSKILLS\n- Writes SQL and Python daily";

/** What the model sends back: one bullet states a number that isn't in the resume text, so it must be flagged. */
const reply = {
  header: { name: "Jane Smith", contact: [] },
  sections: [
    { heading: "Work experience", items: [
      { kind: "bullet", text: "Built a weekly reporting model", label: "", right: "" },
      { kind: "bullet", text: "Cut close time by 40%", label: "", right: "" },
    ] },
    { heading: "Skills and qualifications", items: [{ kind: "skill", text: "SQL and Python", label: "", right: "" }] },
  ],
};

const anthropicReply = () =>
  new Response(JSON.stringify({ model: "claude-sonnet-5-5-20261001", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(reply) }] }), { status: 200 });

const button = (root: ParentNode, label: string) => findButton(root, label) as HTMLButtonElement | null;

describe("converting a resume with everything wired together", () => {
  it("unlocks, sends one request with the key and the shown text, reviews the flags and saves a master with source ai", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const scripted = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      return anthropicReply();
    });
    const globalFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("the app must use the client's own fetch"));
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" "))));

    const db = freshDb();
    const vault = testVault();
    await vault.save(db.name, KEY, PASSPHRASE, "claude-sonnet-5-5");
    vault.lock(db.name);
    const ai = { vault, complete: createClient({ fetch: scripted as unknown as typeof fetch, sleep: async () => undefined }) };
    const Page = (props: PageProps) => createElement(ResumePage, { ...props, deps: { ai, convert: convertResume } });
    const { container } = await mountPage(Page, db, "/resume");
    await waitFor(() => $(container, ".resume-view") !== null, "the page to load");

    // paste, and see the text that will be sent
    await click(button(container, "Paste text"));
    await type($(container, "#resume-paste"), RESUME_TEXT);
    await click(button(container, "Use this text"));
    const shown = ($(container, "textarea.convert-text") as HTMLTextAreaElement).value;
    expect(shown).toBe(RESUME_TEXT);
    expect(scripted).not.toHaveBeenCalled();

    // unlock with the passphrase, then convert
    await type($(container, ".convert-panel input[type=password]"), PASSPHRASE);
    await click(button(container, "Unlock"));
    await waitFor(() => button(container, "Convert with AI") !== null, "Convert to appear");
    expect(vault.key(db.name)).toBe(KEY);
    await click(button(container, "Convert with AI"));
    await waitFor(() => button(container, "Save as master resume") !== null, "the review");

    // exactly one request, to Anthropic, with the unlocked key and the text that was shown
    expect(scripted).toHaveBeenCalledTimes(1);
    expect(seen[0].url).toBe(AI_URL);
    expect(AI_URL).toBe("https://api.anthropic.com/v1/messages");
    expect((seen[0].init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
    const body = JSON.parse(String(seen[0].init.body)) as { messages: { role: string; content: string }[] };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(JSON.parse(body.messages[0].content)).toEqual({ task: "convert", resumeText: shown });
    expect(globalFetch).not.toHaveBeenCalled();

    // the review: converted lines and the line to check
    const lines = $$(container, "textarea[data-field]").map((e) => (e as HTMLTextAreaElement).value);
    expect(lines).toEqual(expect.arrayContaining(["Built a weekly reporting model", "Cut close time by 40%", "SQL and Python"]));
    const flagged = $$(container, ".convert-flags li");
    expect(flagged).toHaveLength(1);
    expect(text($(flagged[0], ".convert-flag-line"))).toBe("Cut close time by 40%");

    // the key is nowhere on the page or in the console
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(document.body.innerHTML).not.toContain("SECRETSECRET");
    expect(document.body.innerHTML).not.toContain(PASSPHRASE);
    expect(logged.join("\n")).not.toContain("SECRETSECRET");
    expect(logged.join("\n")).not.toContain(PASSPHRASE);
    for (const s of spies) for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toContain("SECRETSECRET");

    // nothing is stored until Save, then the master has source ai
    expect(await getMaster(db)).toBeUndefined();
    await click(button(container, "Save as master resume"));
    await waitFor(() => $(container, "h2.section")?.textContent === "Master resume", "the master card");
    const master = (await getMaster(db))!;
    expect(master.source).toBe("ai");
    expect(master.sections.flatMap((s) => s.items.map((i) => i.text))).toEqual(expect.arrayContaining(["Cut close time by 40%"]));
    expect(scripted).toHaveBeenCalledTimes(1);
    for (const s of spies) s.mockRestore();
    globalFetch.mockRestore();
  });
});

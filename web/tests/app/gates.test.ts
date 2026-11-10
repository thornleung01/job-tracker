// @vitest-environment jsdom
// One sentence, and where to fix it, for each missing thing. Each gate renders its sentence, as a link when it has a place to go.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { AI_MESSAGES } from "../../src/ai/errors";
import { GATES, type GateKey } from "../../src/app/gates";
import { Gate } from "../../src/components/Gate";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(gate: GateKey): Promise<HTMLElement> {
  const box = document.createElement("div");
  document.body.append(box);
  await act(async () => createRoot(box).render(h("p", null, h(Gate, { gate }))));
  return box;
}

describe("GATES", () => {
  it("has the standard sentence and place for each thing that can be missing", () => {
    expect(GATES).toEqual({
      mailbox: { text: "Connect your mailbox in Settings.", href: "#/settings/mail" },
      resume: { text: "Add your resume first.", href: "#/resume" },
      aiKey: { text: "Add your Anthropic key in Settings.", href: "#/settings/ai" },
      aiLocked: { text: "Unlock your key to use AI.", href: null },
      posting: { text: "Paste the job description first.", href: null },
    });
  });

  it.each(Object.keys(GATES) as GateKey[])("%s renders its sentence, linked only when it has a place", async (key) => {
    const box = await render(key);
    const { text, href } = GATES[key];
    expect(box.textContent).toBe(text);
    const link = box.querySelector("a");
    if (href) expect(link?.getAttribute("href")).toBe(href);
    else expect(link).toBeNull();
  });

  it("keeps the AI error sentences link-free", () => {
    for (const sentence of Object.values(AI_MESSAGES)) expect(sentence).not.toMatch(/https?:|#\/|<a/);
  });
});

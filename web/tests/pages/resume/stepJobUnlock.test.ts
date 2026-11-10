// Step 2, The job: with a locked key and nothing read from a pasted job, one muted line and the passphrase to unlock it, right there.
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageProps } from "../../../src/app/pageProps";
import type { JobDraft } from "../../../src/jobs/types";
import ResumePage, { type ResumeDeps } from "../../../src/pages/resume";
import { saveMaster } from "../../../src/sync/documents";
import { readJob } from "../../../src/sync/readJob";
import { draftFromBaseline, tailorForJob } from "../../../src/sync/tailor";
import { existingDocs, jobMatches, saveTailoredJob } from "../../../src/sync/tailorFlow";
import { MASTER } from "../../ai/tailorFixture";
import { fakeAi, type Saved } from "../tailor/harness";
import { $, $$, button, click, cleanup, freshDb, mountPage, settle, text, type, waitFor } from "../applications/harness";

beforeEach(() => localStorage.setItem("jobtracker:resume-editing", "list"));
afterEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await cleanup();
});

const NAMELESS = "We need someone who is good with spreadsheets and can report weekly on how things are going.";
const LINE = "Unlock your key to read these from the job.";

async function mountJobStep(saved: Saved) {
  const db = freshDb();
  await saveMaster(db, MASTER, "paste");
  const fake = fakeAi(saved);
  const deps = {
    ai: fake.ai, readJob: vi.fn(readJob), enrichJobDraft: vi.fn(async (d: JobDraft) => d), tailorForJob: vi.fn(tailorForJob),
    draftFromBaseline: vi.fn(draftFromBaseline), jobMatches: vi.fn(jobMatches), existingDocs: vi.fn(existingDocs), saveTailoredJob: vi.fn(saveTailoredJob),
  } satisfies ResumeDeps;
  const Page = (props: PageProps) => createElement(ResumePage, { ...props, deps });
  const page = await mountPage(Page, db, "/resume");
  await waitFor(() => $(page.container, ".resume-view") !== null, "the page to load");
  return { ...page, fake };
}
const label = (c: HTMLElement, name: string) => {
  const l = $$(c, "label").find((x) => text(x) === name);
  return l ? (document.getElementById(l.getAttribute("for")!) as HTMLInputElement | HTMLTextAreaElement) : null;
};
async function paste(c: HTMLElement, value: string) {
  const box = label(c, "Paste the job description")!;
  await act(async () => {
    box.dispatchEvent(new Event("paste", { bubbles: true }));
  });
  await type(box, value);
  await settle();
}
const unlockLine = (c: HTMLElement) => $$(c, ".steps-unlock p").find((p) => text(p) === LINE);

describe("step 2, The job: a locked key", () => {
  it("shows the unlock line when the key is locked and the company and role stay empty, and unlocking removes it", async () => {
    const { container, fake } = await mountJobStep("locked");
    expect(unlockLine(container)).toBeUndefined();
    await paste(container, NAMELESS);
    expect(unlockLine(container)).toBeDefined();
    await type(label(container, "Key passphrase")!, "right");
    await click(button($(container, ".steps-unlock")!, "Unlock"));
    await waitFor(() => unlockLine(container) === undefined, "the line to go");
    expect(fake.unlock).toHaveBeenCalledWith(expect.any(String), "right");
  });

  it("shows no line once there is a company", async () => {
    const { container } = await mountJobStep("locked");
    await paste(container, NAMELESS);
    await type(label(container, "Company")!, "Acme");
    expect(unlockLine(container)).toBeUndefined();
  });

  it("shows no line with an unlocked key or with none", async () => {
    for (const saved of ["unlocked", "none"] as const) {
      const { container } = await mountJobStep(saved);
      await paste(container, NAMELESS);
      expect(unlockLine(container)).toBeUndefined();
      await cleanup();
    }
  });
});

// The card with the status read faked, so it holds whatever the status source says about "done".
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { $, cleanup, freshDb, mountPage } from "../../pages/applications/harness";
import { SetupCard, NEXT_STEP_TEXT } from "../../../src/components/setup/SetupCard";
import type { SetupStatus, StepKey } from "../../../src/sync/setupStatus";

const fake = vi.hoisted(() => ({ current: { status: null, dismissed: false } as { status: unknown; dismissed: boolean } }));
vi.mock("../../../src/components/setup/useSetupStatus", () => ({ useSetupStatus: () => fake.current }));

afterEach(cleanup);

const step = (state: "done" | "skipped" | "missing") => ({ state, detail: "" });
function status(states: Record<StepKey, "done" | "skipped" | "missing">): SetupStatus {
  const order: StepKey[] = ["mailbox", "resume", "aiKey", "backup"];
  return {
    steps: { mailbox: step(states.mailbox), resume: step(states.resume), aiKey: step(states.aiKey), backup: step(states.backup) },
    done: order.filter((k) => states[k] !== "missing").length,
    total: 4,
    next: order.find((k) => states[k] === "missing") ?? null,
  };
}
const mount = () => mountPage((p) => h(SetupCard, { db: p.db, deps: { aiState: () => "none" as const } }), freshDb());

describe("SetupCard", () => {
  it("is hidden while the status loads", async () => {
    fake.current = { status: null, dismissed: false };
    expect($((await mount()).container, ".setup-card")).toBeNull();
  });

  it("is hidden when every step is done or skipped", async () => {
    fake.current = { status: status({ mailbox: "skipped", resume: "done", aiKey: "skipped", backup: "done" }), dismissed: false };
    expect($((await mount()).container, ".setup-card")).toBeNull();
  });

  it("is hidden when dismissed, even with steps missing", async () => {
    fake.current = { status: status({ mailbox: "missing", resume: "missing", aiKey: "missing", backup: "missing" }), dismissed: true };
    expect($((await mount()).container, ".setup-card")).toBeNull();
  });

  it("names each step as the next one", async () => {
    const cases: [Record<StepKey, "done" | "missing">, string][] = [
      [{ mailbox: "missing", resume: "missing", aiKey: "missing", backup: "missing" }, "Next: connect your mailbox"],
      [{ mailbox: "done", resume: "missing", aiKey: "missing", backup: "missing" }, "Next: add your resume"],
      [{ mailbox: "done", resume: "done", aiKey: "missing", backup: "missing" }, "Next: add your Anthropic key"],
      [{ mailbox: "done", resume: "done", aiKey: "done", backup: "missing" }, "Next: back up your data"],
    ];
    for (const [states, next] of cases) {
      fake.current = { status: status(states), dismissed: false };
      const { container } = await mount();
      expect($(container, ".setup-card-next")!.textContent).toBe(next);
      await cleanup();
    }
    expect(Object.values(NEXT_STEP_TEXT)).toHaveLength(4);
  });
});

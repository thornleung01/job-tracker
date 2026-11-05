// The progress tracking, lock and result wording shared by the Settings sync card and the sync banner.
import { createElement as h } from "react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useSyncRun, progressFromEvent, type SyncRunner } from "../../../src/components/syncprogress/progress";
import { ALREADY_RUNNING, describeBannerRun, isCleanReport, plural, reportProblems } from "../../../src/components/syncprogress/result";
import { SyncBar } from "../../../src/components/syncprogress/SyncBar";
import type { AccountRow } from "../../../src/db/schema";
import type { SyncReport } from "../../../src/pages/settings/actions";
import { isSyncing } from "../../../src/sync/syncLock";
import { cleanupRendered, q, render } from "../../app/helpers";

afterEach(cleanupRendered);

const account = (provider: "gmail" | "outlook", address: string) => ({ id: 1, provider, address, active: true }) as AccountRow;
const report = (over: Partial<SyncReport> = {}): SyncReport => ({ synced: [], needConnect: [], failed: [], stopped: false, ...over });
const counts = (c: Record<string, number>) => c as unknown as SyncReport["synced"][number]["counts"];

describe("progressFromEvent", () => {
  it("says finding while the mailbox is being searched", () => {
    expect(progressFromEvent("Gmail a@x.com", { phase: "finding", done: 0, total: null, note: "" })).toEqual({ label: "Gmail a@x.com: finding emails", percent: null, note: "" });
  });
  it("counts what has been read, with the total when it is known", () => {
    expect(progressFromEvent("Gmail a@x.com", { phase: "reading", done: 3, total: 40, note: "slow" })).toEqual({ label: "Gmail a@x.com: reading 3 of 40", percent: 8, note: "slow" });
    expect(progressFromEvent("Outlook b@y.com", { phase: "reading", done: 7, total: null, note: "" })).toEqual({ label: "Outlook b@y.com: reading 7", percent: null, note: "" });
  });
  it("never goes past 100 percent", () => expect(progressFromEvent("A", { phase: "reading", done: 9, total: 3, note: "" }).percent).toBe(100));
});

describe("what a finished sync says", () => {
  it("the problem lines are the same for every screen, in a fixed order", () => {
    const lines = reportProblems(report({ needConnect: [account("gmail", "a@x.com")], failed: [{ account: account("outlook", "b@y.com"), message: "Outlook said no." }], stopped: true }));
    expect(lines).toEqual(["Reconnect Gmail a@x.com, then try again.", "Outlook b@y.com: Outlook said no.", "Sync stopped."]);
  });
  it("a clean report has no problems", () => {
    expect(reportProblems(report({ synced: [{ account: account("gmail", "a@x.com"), counts: counts({}) }] }))).toEqual([]);
    expect(isCleanReport(report())).toBe(true);
    expect(isCleanReport(report({ stopped: true }))).toBe(false);
  });
  it("the banner counts what was read and what needs review, and leaves out duplicates, errors and retries", () => {
    const synced = [{ account: account("gmail", "a@x.com"), counts: counts({ "applied-to-application": 2, review: 1, duplicate: 5, error: 1, retry: 1 }) }];
    expect(describeBannerRun(report({ synced }), [])).toEqual({ ok: true, lines: ["Synced 3 new emails. 1 needs review."] });
    expect(describeBannerRun(report({ synced: [{ account: account("gmail", "a@x.com"), counts: counts({ review: 2 }) }] }), []).lines).toEqual(["Synced 2 new emails. 2 need review."]);
    expect(describeBannerRun(report({ synced: [{ account: account("gmail", "a@x.com"), counts: counts({ duplicate: 4 }) }] }), []).lines).toEqual(["Synced. No new emails."]);
  });
  it("earlier problems come first and make the result not ok", () => {
    const result = describeBannerRun(report(), ["Couldn't connect Gmail. No."]);
    expect(result).toEqual({ ok: false, lines: ["Couldn't connect Gmail. No."] });
  });
  it("says there is nothing to sync when nothing happened", () => {
    expect(describeBannerRun(null, []).lines).toEqual(["There are no accounts to sync."]);
    expect(describeBannerRun(report(), [])).toEqual({ ok: true, lines: ["There are no accounts to sync."] });
  });
  it("plural picks by count", () => {
    expect(plural(1, "email", "emails")).toBe("email");
    expect(plural(0, "email", "emails")).toBe("emails");
  });
  it("the lock message is plain", () => expect(ALREADY_RUNNING).toBe("A sync is already running."));
});

describe("useSyncRun", () => {
  function Probe({ into }: { into: { runner?: SyncRunner } }) {
    into.runner = useSyncRun();
    return h("span", { className: "probe" }, into.runner.progress?.label ?? "idle");
  }
  const text = () => q(".probe")!.textContent;

  it("goes idle, running with a line, then idle again, and gives the lock back", async () => {
    const box: { runner?: SyncRunner } = {};
    await render(h(Probe, { into: box }));
    expect(text()).toBe("idle");
    expect(box.runner!.isActive()).toBe(false);

    let run!: NonNullable<ReturnType<SyncRunner["begin"]>>;
    await act(async () => {
      run = box.runner!.begin("Starting")!;
    });
    expect(text()).toBe("Starting");
    expect(box.runner!.isActive()).toBe(true);
    expect(isSyncing()).toBe(true);

    await act(async () => run.onAccount("Gmail a@x.com"));
    expect(text()).toBe("Gmail a@x.com: finding emails");
    await act(async () => run.onProgress({ phase: "reading", done: 1, total: 2, note: "" }));
    expect(text()).toBe("Gmail a@x.com: reading 1 of 2");
    await act(async () => run.show("Connecting Outlook"));
    expect(text()).toBe("Connecting Outlook");

    await act(async () => run.end());
    expect(text()).toBe("idle");
    expect(isSyncing()).toBe(false);
    expect(box.runner!.isActive()).toBe(false);
  });

  it("one sync at a time, across components that each have their own runner", async () => {
    const first: { runner?: SyncRunner } = {};
    await render(h("div", null, h(Probe, { into: first })));
    const second: { runner?: SyncRunner } = {};
    await render(h("div", null, h(Probe, { into: second })));
    let run: ReturnType<SyncRunner["begin"]> = null;
    await act(async () => {
      run = first.runner!.begin("Starting");
    });
    expect(run).not.toBeNull();
    expect(second.runner!.begin("Starting")).toBeNull();
    expect(first.runner!.begin("Again")).toBeNull();
    await act(async () => run!.end());
    let next: ReturnType<SyncRunner["begin"]> = null;
    await act(async () => {
      next = second.runner!.begin("Now me");
    });
    expect(next).not.toBeNull();
    await act(async () => next!.end());
  });

  it("stop aborts the run's signal, and leaving the page does too", async () => {
    const box: { runner?: SyncRunner } = {};
    await render(h(Probe, { into: box }));
    let run!: NonNullable<ReturnType<SyncRunner["begin"]>>;
    await act(async () => {
      run = box.runner!.begin("Starting")!;
    });
    expect(run.signal.aborted).toBe(false);
    box.runner!.stop();
    expect(run.signal.aborted).toBe(true);
    await act(async () => run.end());

    let second!: NonNullable<ReturnType<SyncRunner["begin"]>>;
    await act(async () => {
      second = box.runner!.begin("Starting")!;
    });
    cleanupRendered();
    expect(second.signal.aborted).toBe(true);
    second.end(); // the lock must come back even though nobody is mounted to see it
    expect(isSyncing()).toBe(false);
  });
});

describe("SyncBar", () => {
  it("fills to the percentage and is a labelled progress bar", async () => {
    await render(h(SyncBar, { percent: 40 }));
    const bar = q(".bar")!;
    expect(bar.getAttribute("role")).toBe("progressbar");
    expect(bar.getAttribute("aria-label")).toBe("Sync progress");
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(q<HTMLElement>(".bar > i")!.style.width).toBe("40%");
    expect(bar.classList.contains("indet")).toBe(false);
  });
  it("slides when the percentage is not known", async () => {
    await render(h(SyncBar, { percent: null }));
    expect(q(".bar")!.classList.contains("indet")).toBe(true);
    expect(q(".bar")!.hasAttribute("aria-valuenow")).toBe(false);
  });
});

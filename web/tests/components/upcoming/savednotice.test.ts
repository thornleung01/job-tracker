// @vitest-environment jsdom
// "Calendar file saved." is read out on every save, not only the first, and empties itself afterwards.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saves = vi.hoisted(() => ({ files: [] as string[] }));
vi.mock("../../../src/app/download", () => ({ downloadText: (name: string) => void saves.files.push(name) }));

import { CalendarExport } from "../../../src/components/calendar/CalendarExport";
import { AddToCalendar } from "../../../src/components/upcoming/AddToCalendar";
import { SAVED_REPEAT_MS, SAVED_SHOWN_MS, SAVED_TEXT } from "../../../src/components/upcoming/useSavedNotice";
import type { CalendarEvent } from "../../../src/sync/calendar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let box: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  saves.files = [];
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.useRealTimers();
});

const status = () => box.querySelector("[role=status]")!;
const press = async () => { await act(async () => box.querySelector("button")!.click()); };
const wait = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };

const event = { appId: 1, company: "Acme", role: "Analyst", stage: "Interview", day: "2026-11-10" };
const calEvent: CalendarEvent = { ...event, key: "interview:1:2026-11-10:Interview", kind: "interview", label: "Interview", stage: "Interview", past: false };

describe.each([
  ["AddToCalendar", () => h(AddToCalendar, { event })],
  ["CalendarExport", () => h(CalendarExport, { events: [calEvent], period: "2026-11-10", label: "Download" })],
])("%s's status line", (_name, make) => {
  it("is on the page before it has words, says it after a save, and empties again later", async () => {
    await act(async () => root.render(make()));
    expect(status().textContent).toBe("");
    await press();
    expect(saves.files).toHaveLength(1);
    expect(status().textContent).toBe(SAVED_TEXT);   // at once: nothing to empty first
    await wait(SAVED_SHOWN_MS);
    expect(status().textContent).toBe("");
  });

  it("changes again on a second save while the words are still there, so it is read out again", async () => {
    await act(async () => root.render(make()));
    await press();
    expect(status().textContent).toBe(SAVED_TEXT);
    const seen: string[] = [];
    new MutationObserver(() => seen.push(status().textContent ?? "")).observe(status(), { childList: true, characterData: true, subtree: true });
    await press();
    expect(status().textContent).toBe("");   // emptied at once...
    await wait(SAVED_REPEAT_MS);
    expect(status().textContent).toBe(SAVED_TEXT);   // ...and said again
    await Promise.resolve();
    expect(seen).toEqual(["", SAVED_TEXT]);
    // the first save's timer to empty it must not cut the second one short
    await wait(SAVED_SHOWN_MS - SAVED_REPEAT_MS - 1);
    expect(status().textContent).toBe(SAVED_TEXT);
    await wait(2);
    expect(status().textContent).toBe("");
  });

  it("leaves no timer behind when it goes away", async () => {
    await act(async () => root.render(make()));
    await press();
    await act(async () => root.render(h("p", null, "gone")));
    expect(vi.getTimerCount()).toBe(0);
  });
});

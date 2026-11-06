// @vitest-environment jsdom
// ApplicationActions shows what an application offers (its draft link, its interview days), and never another application's.
import "fake-indexeddb/auto";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobTrackerDB } from "../../../src/db/schema";
import type { ApplicationActions as Actions } from "../../../src/sync/applicationActions";

// Each application's read waits until the test hands it a result, so the moment between "the id changed" and "its data arrived" can be looked at.
const reads = vi.hoisted(() => ({ waiting: new Map<number, (value: unknown) => void>() }));
vi.mock("../../../src/sync/applicationActions", async (original) => {
  const real = await original<typeof import("../../../src/sync/applicationActions")>();
  return { ...real, applicationActions: (_db: unknown, id: number) => new Promise((resolve) => reads.waiting.set(id, resolve)) };
});

import { ApplicationActions } from "../../../src/components/followup/ApplicationActions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let box: HTMLElement;
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  reads.waiting.clear();
});

const db = {} as JobTrackerDB;
const result = (to: string): Actions => ({
  draft: { label: "Draft follow-up in Gmail", url: `https://mail.google.com/mail/?view=cm&to=${to}` }, to, needsFollowUp: false, interviews: [],
});
const link = () => box.querySelector<HTMLAnchorElement>("a.btn");
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
/** The read for this application has started (liveQuery starts it a moment after the render): hand it its result. */
async function answer(id: number, value: Actions): Promise<void> {
  for (let i = 0; i < 100 && !reads.waiting.has(id); i++) await settle();
  await act(async () => reads.waiting.get(id)!(value));
  await settle();
}

describe("ApplicationActions", () => {
  it("shows nothing of the previous application while the next one loads", async () => {
    box = document.createElement("div");
    document.body.append(box);
    root = createRoot(box);
    await act(async () => root.render(h(ApplicationActions, { db, appId: 1 })));
    await answer(1, result("ann@acme.com"));
    expect(link()!.href).toContain("to=ann@acme.com");
    // the same page, another application: its data has not arrived yet
    await act(async () => root.render(h(ApplicationActions, { db, appId: 2 })));
    await settle();
    expect(link()).toBeNull();
    await answer(2, result("bo@beta.com"));
    expect(link()!.href).toContain("to=bo@beta.com");
  });
});

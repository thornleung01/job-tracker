import "fake-indexeddb/auto";
import { createElement as h } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewBanner } from "../../src/components/ReviewBanner";
import { upsertAccount } from "../../src/db/repo";
import type { JobTrackerDB } from "../../src/db/schema";
import { cleanupRendered, closeDbs, freshDb, q, render, waitFor } from "../app/helpers";

afterEach(() => {
  cleanupRendered();
  closeDbs();
});

async function waiting(db: JobTrackerDB, n: number) {
  const accountId = await upsertAccount(db, "gmail", "me@gmail.com");
  const base = {
    accountId, threadId: null, receivedAt: "2026-10-01T00:00:00Z", sender: "A <a@x.com>", subject: "s", body: "b", related: true, event: null,
    confidence: null, applicationId: null, needsReview: true, webLink: null, bulk: false, hold: false, reason: null,
  };
  await db.emails.bulkAdd(Array.from({ length: n }, (_, i) => ({ ...base, providerMsgId: String(i) })));
}

describe("ReviewBanner", () => {
  it("renders nothing when no email waits", async () => {
    const view = await render(h(ReviewBanner, { db: freshDb() }));
    expect(view.container.innerHTML).toBe("");
  });

  it("says '1 email needs a look' for one", async () => {
    const db = freshDb();
    await waiting(db, 1);
    await render(h(ReviewBanner, { db }));
    const banner = await waitFor(() => q(".review-banner"));
    expect(banner.getAttribute("role")).toBeNull();
    expect(banner.getAttribute("aria-label")).toBeNull();
    expect(banner.textContent).toBe("1 email needs a lookReview emails");
  });

  it("says 'N emails need a look' for several, and links to the queue", async () => {
    const db = freshDb();
    await waiting(db, 3);
    await render(h(ReviewBanner, { db }));
    expect((await waitFor(() => q(".review-banner p"))).textContent).toBe("3 emails need a look");
    const link = q<HTMLAnchorElement>(".review-banner a")!;
    expect(link.textContent).toBe("Review emails");
    expect(link.getAttribute("href")).toBe("#/review");
    expect(q(".review-banner svg")!.getAttribute("width")).toBe("16");
  });
});

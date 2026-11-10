import "fake-indexeddb/auto";
import { createElement as h } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useQuery, type QueryOptions } from "../../src/app/useQuery";
import type { JobTrackerDB } from "../../src/db/schema";
import { isSyncing, tryAcquire } from "../../src/sync/syncLock";
import { addApp } from "../pages/applications/harness";
import { cleanupRendered, closeDbs, freshDb, q, render, sleep, waitFor } from "./helpers";

afterEach(() => {
  cleanupRendered();
  closeDbs();
});

/** Shows how many applications there are, counting every run of the read. */
function Count({ db, reads, options }: { db: JobTrackerDB; reads: { n: number }; options?: QueryOptions }) {
  const n = useQuery(async () => {
    reads.n++;
    return db.applications.count();
  }, [db], options);
  return h("p", { id: "count" }, n === undefined ? "loading" : String(n));
}
const shown = () => q("#count")!.textContent;

/** Writes `n` applications one by one, `gap` ms apart, like a sync writing one message at a time. */
async function writeBurst(db: JobTrackerDB, n: number, gap = 4) {
  for (let i = 0; i < n; i++) {
    await addApp(db, `Burst ${i}`);
    await sleep(gap);
  }
}

describe("useQuery during a sync", () => {
  it("re-runs on every write when no sync is running", async () => {
    const db = freshDb();
    const reads = { n: 0 };
    await render(h(Count, { db, reads }));
    await waitFor(() => shown() === "0");
    await writeBurst(db, 20);
    await waitFor(() => shown() === "20");
    expect(reads.n).toBeGreaterThan(5);
  });

  it("holds re-runs back while a sync runs, then shows what the database holds as soon as it ends", async () => {
    const db = freshDb();
    const reads = { n: 0 };
    await render(h(Count, { db, reads }));
    await waitFor(() => shown() === "0");
    const release = tryAcquire()!;
    expect(isSyncing()).toBe(true);
    const before = reads.n;
    await writeBurst(db, 40);
    // Mid-sync the screen may lag by up to a second, but it reads at most about once.
    expect(reads.n - before).toBeLessThanOrEqual(2);
    release();
    const ended = Date.now();
    await waitFor(() => shown() === "40");
    expect(Date.now() - ended).toBeLessThan(500);   // the last run follows the end of the sync, it doesn't wait out the second
    expect(Number(shown())).toBe(await db.applications.count());
    expect(reads.n - before).toBeLessThanOrEqual(4);
  });

  it("keeps a query live through a sync when asked to", async () => {
    const db = freshDb();
    const reads = { n: 0 };
    await render(h(Count, { db, reads, options: { live: true } }));
    await waitFor(() => shown() === "0");
    const release = tryAcquire()!;
    try {
      const before = reads.n;
      await writeBurst(db, 20);
      expect(reads.n - before).toBeGreaterThan(5);
      await waitFor(() => shown() === "20");
    } finally {
      release();
    }
  });

  it("never makes the first read wait, even when a sync is already running", async () => {
    const db = freshDb();
    await addApp(db, "Already here");
    const release = tryAcquire()!;
    try {
      await render(h(Count, { db, reads: { n: 0 } }));
      await waitFor(() => shown() === "1");
    } finally {
      release();
    }
  });
});

describe("useQuery when its deps change", () => {
  function ByName({ db, name, options }: { db: JobTrackerDB; name: string; options?: QueryOptions }) {
    const rows = useQuery(() => db.applications.where("companyKey").equals(name.toLowerCase()).toArray(), [db, name], options);
    return h("p", { id: "who" }, rows === undefined ? "loading" : rows.map((r) => r.company).join(","));
  }
  const who = () => q("#who")!.textContent;

  it("goes back to loading, so a different record never shows the previous one", async () => {
    const db = freshDb();
    await addApp(db, "Acme");
    await addApp(db, "Beta");
    const view = await render(h(ByName, { db, name: "Acme" }));
    await waitFor(() => who() === "Acme");
    // The very render that has the new deps must not show the old value (a stale one would be seen for a frame).
    const seen: (string | null)[] = [];
    const watch = new MutationObserver(() => seen.push(who()));
    watch.observe(q("#who")!, { childList: true, characterData: true, subtree: true });
    await view.rerender(h(ByName, { db, name: "Beta" }));
    await waitFor(() => who() === "Beta");
    watch.disconnect();
    expect(seen).not.toContain("Acme");
    expect(seen[0]).toBe("loading");
  });

  it("keeps the previous result while the new one loads when keepPrevious is set", async () => {
    const db = freshDb();
    await addApp(db, "Acme");
    await addApp(db, "Beta");
    const view = await render(h(ByName, { db, name: "Acme", options: { keepPrevious: true } }));
    await waitFor(() => who() === "Acme");
    const seen: (string | null)[] = [];
    const watch = new MutationObserver(() => seen.push(who()));
    watch.observe(q("#who")!, { childList: true, characterData: true, subtree: true });
    await view.rerender(h(ByName, { db, name: "Beta", options: { keepPrevious: true } }));
    await waitFor(() => who() === "Beta");
    watch.disconnect();
    expect(seen).not.toContain("loading");
  });
});

describe("useQuery with unchanged data", () => {
  it("keeps the very same result object when a write leaves the read unchanged", async () => {
    const db = freshDb();
    await addApp(db, "Acme");
    const seen: unknown[] = [];
    function Acme() {
      const rows = useQuery(async () => (await db.applications.toArray()).filter((a) => a.company === "Acme").map((a) => ({ id: a.id, company: a.company })), [db]);
      if (rows) seen.push(rows);
      return h("p", { id: "acme" }, rows === undefined ? "loading" : String(rows.length));
    }
    await render(h(Acme));
    await waitFor(() => q("#acme")!.textContent === "1");
    await addApp(db, "Beta");
    await addApp(db, "Gamma");
    await sleep(200);
    expect(new Set(seen).size).toBe(1);
    await addApp(db, "Acme");
    await waitFor(() => q("#acme")!.textContent === "2");
  });
});

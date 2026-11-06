import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "../../src/db/errors";
import { BULK_ADD_MAX } from "../../src/db/limits";
import { openDatabase } from "../../src/db/schema";
import { addApplication } from "../../src/sync/actions";
import { EMPTY_DRAFT, type JobDraft } from "../../src/jobs/types";
import { BULK_ADD_CONCURRENCY, bulkAdd, parseLinkLines, summarize, tally, type BulkAddDeps, type LinkResult } from "../../src/sync/bulkAdd";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const guess = { company: true, role: true };
const draftFor = (url: string): JobDraft | null => {
  // "https://jobs.example/<company>/<role>" reads as that company and role; anything else can't be read
  const m = /^https:\/\/jobs\.example\/([a-z]+)(?:\/([a-z-]+))?/.exec(url);
  return m ? { ...EMPTY_DRAFT, company: m[1][0].toUpperCase() + m[1].slice(1), role: m[2]?.replace(/-/g, " ") ?? "", url, guessed: guess } : null;
};
const deps = (o: Partial<BulkAddDeps> = {}): BulkAddDeps => ({
  parseJobUrl: (u) => draftFor(u),
  enrichJobDraft: async (d) => d,
  ...o,
});

describe("parseLinkLines", () => {
  it("trims, drops blank lines and handles every kind of line break", () => {
    expect(parseLinkLines("  https://a.example/x  \r\n\r\nhttps://b.example/y\rhttps://c.example/z\n")).toEqual(["https://a.example/x", "https://b.example/y", "https://c.example/z"]);
  });
  it("counts the same link once, even typed differently", () => {
    expect(parseLinkLines("https://a.example/x\nhttps://a.example/x#frag\nhttps://a.example/x")).toEqual(["https://a.example/x"]);
  });
  it("refuses none, and more than 10", () => {
    expect(() => parseLinkLines(" \n \n")).toThrow(ActionError);
    const eleven = Array.from({ length: BULK_ADD_MAX + 1 }, (_, i) => `https://a.example/${i}`).join("\n");
    expect(() => parseLinkLines(eleven)).toThrow(/up to 10/);
    expect(parseLinkLines(Array.from({ length: BULK_ADD_MAX }, (_, i) => `https://a.example/${i}`).join("\n"))).toHaveLength(BULK_ADD_MAX);
  });
  it("keeps lines that aren't links, to be reported as unreadable", () => {
    expect(parseLinkLines("not a link")).toEqual(["not a link"]);
  });
});

describe("bulkAdd", () => {
  it("adds one application per link, marking guessed fields, as Applied and yours", async () => {
    const db = freshDb();
    const results = await bulkAdd(db, ["https://jobs.example/acme/data-analyst", "https://jobs.example/beta/designer"], deps());
    expect(results.map((r) => r.outcome.status)).toEqual(["added", "added"]);
    const first = results[0].outcome;
    expect(first).toMatchObject({ status: "added", company: "Acme", role: "data analyst", guessed: guess });
    const rows = await db.applications.orderBy("id").toArray();
    expect(rows.map((r) => [r.company, r.role, r.stage, r.manual, r.postingUrl])).toEqual([
      ["Acme", "data analyst", "Applied", true, "https://jobs.example/acme/data-analyst"],
      ["Beta", "designer", "Applied", true, "https://jobs.example/beta/designer"],
    ]);
  });

  it("reads each link offline first, then asks the board, and uses what the board says", async () => {
    const db = freshDb();
    const parse = vi.fn((u: string) => draftFor(u));
    const enrich = vi.fn(async (d: JobDraft) => ({ ...d, company: "Acme Corporation", role: "Senior Data Analyst", guessed: { company: false, role: false } }));
    const [r] = await bulkAdd(db, ["https://jobs.example/acme/x"], deps({ parseJobUrl: parse, enrichJobDraft: enrich }));
    expect(parse).toHaveBeenCalledWith("https://jobs.example/acme/x");
    expect(enrich).toHaveBeenCalledTimes(1);
    expect(r.outcome).toMatchObject({ status: "added", company: "Acme Corporation", role: "Senior Data Analyst", guessed: { company: false, role: false } });
  });

  it("keeps the offline reading when the board fails", async () => {
    const db = freshDb();
    const [r] = await bulkAdd(db, ["https://jobs.example/acme/x"], deps({ enrichJobDraft: async () => { throw new Error("offline"); } }));
    expect(r.outcome).toMatchObject({ status: "added", company: "Acme" });
  });

  it("skips a link whose application is saved already, by link or by company and role", async () => {
    const db = freshDb();
    await addApplication(db, { company: "Acme", role: "Data Analyst" });
    const results = await bulkAdd(db, ["https://jobs.example/acme/data-analyst", "https://jobs.example/beta/designer"], deps());
    expect(results[0].outcome).toMatchObject({ status: "skipped", existing: { company: "Acme" } });
    expect(results[1].outcome.status).toBe("added");
    expect(await db.applications.count()).toBe(2);
  });

  it("skips a link saved before, even when it is read as a different company", async () => {
    const db = freshDb();
    await addApplication(db, { company: "Something else", role: "Whatever", url: "https://jobs.example/acme/data-analyst" });
    const [r] = await bulkAdd(db, ["https://jobs.example/acme/data-analyst"], deps());
    expect(r.outcome.status).toBe("skipped");
  });

  it("never adds two links for the same company and role in one batch", async () => {
    const db = freshDb();
    const results = await bulkAdd(db, ["https://jobs.example/acme/analyst?a=1", "https://jobs.example/acme/analyst?a=2"], deps());
    expect(results.map((r) => r.outcome.status).sort()).toEqual(["added", "skipped"]);
    expect(await db.applications.count()).toBe(1);
  });

  it("reports a link that is not https, can't be read, or has no company, and goes on with the rest", async () => {
    const db = freshDb();
    const results = await bulkAdd(db, ["http://jobs.example/acme/x", "https://unknown.example/nothing", "just words", "https://jobs.example/beta/x"], deps());
    expect(results.map((r) => r.outcome.status)).toEqual(["unreadable", "unreadable", "unreadable", "added"]);
    expect(results[0].outcome).toMatchObject({ reason: "Not a link that starts with https://." });
    expect(await db.applications.count()).toBe(1);
    const noCompany = await bulkAdd(db, ["https://jobs.example/q"], deps({ parseJobUrl: (u) => ({ ...EMPTY_DRAFT, url: u }) }));
    expect(noCompany[0].outcome.status).toBe("unreadable");
  });

  it("refuses links with credentials and over-long links the way the single add does", async () => {
    const db = freshDb();
    const results = await bulkAdd(db, ["https://user:pw@jobs.example/acme/x", `https://jobs.example/acme/${"x".repeat(600)}`], deps());
    expect(results.map((r) => r.outcome.status)).toEqual(["unreadable", "unreadable"]);
  });

  it("refuses more than 10 links", async () => {
    await expect(bulkAdd(freshDb(), Array.from({ length: 11 }, (_, i) => `https://jobs.example/c${i}`), deps())).rejects.toBeInstanceOf(ActionError);
  });

  it("reads two links at a time, no more", async () => {
    expect(BULK_ADD_CONCURRENCY).toBe(2);
    const db = freshDb();
    let running = 0;
    let peak = 0;
    // Every read waits until the test lets it finish, so the overlap is counted, not timed.
    const waiting: (() => void)[] = [];
    const enrich = (d: JobDraft) => {
      running++;
      peak = Math.max(peak, running);
      return new Promise<JobDraft>((resolve) => waiting.push(() => { running--; resolve(d); }));
    };
    const links = "abcdefgh".split("").map((c) => `https://jobs.example/co${c}`);
    let finished = false;
    const run = bulkAdd(db, links, deps({ enrichJobDraft: enrich })).finally(() => { finished = true; });
    while (!finished) {
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(waiting.length).toBeLessThanOrEqual(2);
      waiting.splice(0).forEach((release) => release());
    }
    const results = await run;
    expect(peak).toBe(2);
    expect(results.every((r) => r.outcome.status === "added")).toBe(true);
    expect(results.map((r) => r.link)).toEqual(links);
  });

  it("checks for a duplicate and saves in one transaction, so two tabs adding the same link save it once", async () => {
    const name = `bulkadd-two-tabs-${Date.now()}`;
    const tabs = [openDatabase(name), openDatabase(name)];
    try {
      const link = "https://jobs.example/acme/analyst";
      const [a, b] = await Promise.all(tabs.map((tab) => bulkAdd(tab, [link], deps())));
      expect([a[0].outcome.status, b[0].outcome.status].sort()).toEqual(["added", "skipped"]);
      expect(await tabs[0].applications.count()).toBe(1);
    } finally {
      tabs.forEach((tab) => tab.close());
    }
  });

  it("reports each link as it finishes", async () => {
    const seen: [string, number, number][] = [];
    await bulkAdd(freshDb(), ["https://jobs.example/aa", "https://jobs.example/bb", "https://jobs.example/cc"], deps(), { onResult: (r, done, total) => seen.push([r.link, done, total]) });
    expect(seen.map(([, done, total]) => [done, total])).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it("passes the abort signal to the board and stops: nothing more is saved, the rest are stopped", async () => {
    const db = freshDb();
    const stop = new AbortController();
    const enrich = vi.fn((d: JobDraft, o?: { signal?: AbortSignal }) => new Promise<JobDraft>((resolve) => {
      // like the real one: an abort ends the wait and hands back the draft unchanged
      o?.signal?.addEventListener("abort", () => resolve(d));
      if (d.company === "Aa") queueMicrotask(() => stop.abort());
    }));
    const links = ["https://jobs.example/aa", "https://jobs.example/bb", "https://jobs.example/cc", "https://jobs.example/dd"];
    const results = await bulkAdd(db, links, deps({ enrichJobDraft: enrich }), { signal: stop.signal });
    expect(results.map((r) => r.outcome.status)).toEqual(["stopped", "stopped", "stopped", "stopped"]);
    expect(await db.applications.count()).toBe(0);
    expect(enrich.mock.calls[0][1]?.signal).toBe(stop.signal);
  });

  it("keeps what was saved before the stop", async () => {
    const db = freshDb();
    const stop = new AbortController();
    const results = await bulkAdd(db, ["https://jobs.example/aa", "https://jobs.example/bb", "https://jobs.example/cc"], deps(), {
      signal: stop.signal,
      onResult: (r) => { if (r.link.endsWith("aa")) stop.abort(); },
    });
    expect(results[0].outcome.status).toBe("added");
    expect(results.slice(1).every((r) => r.outcome.status === "stopped" || r.outcome.status === "added")).toBe(true);
    expect(await db.applications.count()).toBe(results.filter((r) => r.outcome.status === "added").length);
  });

  it("renders nothing from a hostile board answer except as the saved text", async () => {
    const db = freshDb();
    const evil = async (d: JobDraft) => ({ ...d, company: "<img src=x onerror=alert(1)>Acme", role: "<b>Boss</b>" });
    const [r] = await bulkAdd(db, ["https://jobs.example/acme/x"], deps({ enrichJobDraft: evil }));
    expect(r.outcome.status).toBe("added");
    expect((await db.applications.toArray())[0].company).toBe("<img src=x onerror=alert(1)>Acme");   // stored as text; the page only ever shows it as text
  });
});

describe("summarize", () => {
  const r = (link: string, status: LinkResult["outcome"]["status"]): LinkResult => ({
    link,
    outcome: status === "added" ? { status, id: 1, company: "A", role: "", guessed: guess } : status === "skipped" ? { status, existing: { id: 1, company: "A", role: "", stage: "Applied" } }
      : status === "unreadable" || status === "failed" ? { status, reason: "no" } : { status: "stopped" },
  });
  it("writes the sentence the form shows", () => {
    const results = [r("a", "added"), r("b", "added"), r("c", "added"), r("d", "added"), r("e", "skipped"), r("https://bad.example/x", "unreadable")];
    expect(summarize(results)).toBe("Added 4. Skipped 1 already saved. 1 couldn't be read: https://bad.example/x.");
  });
  it("leaves out what is zero, and says when nothing was added", () => {
    expect(summarize([r("a", "added")])).toBe("Added 1.");
    expect(summarize([r("a", "skipped"), r("b", "skipped")])).toBe("Skipped 2 already saved.");
    expect(summarize([])).toBe("Nothing was added.");
  });
  it("gives the count, not every link, when several can't be read, and mentions a stop", () => {
    expect(summarize([r("a", "unreadable"), r("b", "failed"), r("c", "stopped")])).toBe("2 couldn't be read. Stopped before 1 link.");
    expect(tally([r("a", "added"), r("b", "stopped")])).toMatchObject({ added: 1, stopped: 1 });
  });
  it("shortens a very long link", () => {
    expect(summarize([r(`https://x.example/${"a".repeat(300)}`, "unreadable")]).length).toBeLessThan(140);
  });
});

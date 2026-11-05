import { describe, expect, it, vi } from "vitest";
import { createHttp, defaultSleep, isRetryable, parseRetryAfter, ProviderHttpError, RETRY_WAITS } from "../../src/providers/backoff";
import { NotConnected } from "../../src/types";
import { fakeSleep, json, scriptedFetch, token } from "./helpers";

const URL_ = "https://example.test/x";
const quota = () => json({ error: { errors: [{ reason: "rateLimitExceeded" }] } }, 403);

describe("retry rules", () => {
  it.each([[429, ""], [500, ""], [502, ""], [503, ""], [504, ""], [403, "rateLimitExceeded"], [403, "userRateLimitExceeded"]])("%s %s is retried", (status, body) => {
    expect(isRetryable(status, body)).toBe(true);
  });
  it.each([[401, ""], [404, ""], [403, "insufficientPermissions"], [400, ""]])("%s %s is not", (status, body) => {
    expect(isRetryable(status, body)).toBe(false);
  });
  it("reads Retry-After as seconds or an HTTP date", () => {
    expect(parseRetryAfter("7")).toBe(7000);
    expect(parseRetryAfter("Wed, 01 Jan 2026 00:00:30 GMT", Date.parse("2026-01-01T00:00:00Z"))).toBe(30000);
    expect(parseRetryAfter("nonsense")).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});

describe("createHttp", () => {
  it("waits out a rate limit and retries on the default schedule", async () => {
    const s = scriptedFetch((_c, n) => (n < 2 ? quota() : json({ ok: 1 })));
    const { sleep, waits } = fakeSleep();
    const onWait = vi.fn();
    const res = await createHttp("gmail", token, { fetch: s.fetch, sleep, onWait }).get(URL_);
    expect(await res.json()).toEqual({ ok: 1 });
    expect(waits).toEqual([5000, 15000]);
    expect(onWait.mock.calls).toEqual([[5], [15]]);
  });

  it("honours Retry-After over the schedule on 429", async () => {
    const s = scriptedFetch((_c, n) => (n === 0 ? json({}, 429, { "Retry-After": "42" }) : json({ ok: 1 })));
    const { sleep, waits } = fakeSleep();
    await createHttp("outlook", token, { fetch: s.fetch, sleep }).get(URL_);
    expect(waits).toEqual([42000]);
  });

  it("caps an absurd Retry-After", async () => {
    const s = scriptedFetch((_c, n) => (n === 0 ? json({}, 429, { "Retry-After": "99999" }) : json({})));
    const { sleep, waits } = fakeSleep();
    await createHttp("outlook", token, { fetch: s.fetch, sleep }).get(URL_);
    expect(waits).toEqual([300000]);
  });

  it("gives up after the last wait and hands back the failing response", async () => {
    const s = scriptedFetch(() => quota());
    const { sleep, waits } = fakeSleep();
    const res = await createHttp("gmail", token, { fetch: s.fetch, sleep }).get(URL_);
    expect(res.status).toBe(403);
    expect(waits).toEqual(RETRY_WAITS.map((w) => w * 1000));
    expect(s.calls).toHaveLength(RETRY_WAITS.length + 1);
  });

  it.each([[404, { error: "notFound" }], [403, { error: { errors: [{ reason: "insufficientPermissions" }] } }]])("%s is not retried", async (status, body) => {
    const s = scriptedFetch(() => json(body, status));
    const { sleep, waits } = fakeSleep();
    const res = await createHttp("gmail", token, { fetch: s.fetch, sleep }).get(URL_);
    expect(res.status).toBe(status);
    expect(waits).toEqual([]);
    expect(s.calls).toHaveLength(1);
  });

  it("on 401 asks the token source again and retries once", async () => {
    let issued = 0;
    const source = vi.fn(async () => `tok${++issued}`);
    const s = scriptedFetch((c) => (c.headers.get("authorization") === "Bearer tok1" ? json({}, 401) : json({ ok: 1 })));
    const res = await createHttp("gmail", source, { fetch: s.fetch }).get(URL_);
    expect(res.status).toBe(200);
    expect(source).toHaveBeenCalledTimes(2);
    expect(s.calls.map((c) => c.headers.get("authorization"))).toEqual(["Bearer tok1", "Bearer tok2"]);
  });

  it("throws NotConnected when the retry is rejected too", async () => {
    const s = scriptedFetch(() => json({}, 401));
    await expect(createHttp("gmail", token, { fetch: s.fetch }).get(URL_)).rejects.toBeInstanceOf(NotConnected);
    expect(s.calls).toHaveLength(2);
  });

  it("lets NotConnected from the token source through", async () => {
    const source = async () => {
      throw new NotConnected("nope");
    };
    const s = scriptedFetch(() => json({}));
    await expect(createHttp("gmail", source, { fetch: s.fetch }).get(URL_)).rejects.toBeInstanceOf(NotConnected);
    expect(s.calls).toHaveLength(0);
  });

  it("stops before sending when already aborted, and passes the signal to fetch", async () => {
    const s = scriptedFetch(() => json({}));
    const ctl = new AbortController();
    await createHttp("gmail", token, { fetch: s.fetch }).get(URL_, { signal: ctl.signal });
    expect(s.calls[0].signal).toBe(ctl.signal);
    ctl.abort();
    await expect(createHttp("gmail", token, { fetch: s.fetch }).get(URL_, { signal: ctl.signal })).rejects.toThrow();
    expect(s.calls).toHaveLength(1);
  });

  it("one rate limit holds back every other request on the client until the wait ends", async () => {
    let limited = false;
    const s = scriptedFetch((c) => {
      if (c.url.pathname === "/first" && !limited) {
        limited = true;
        return json({}, 429, { "Retry-After": "3" });
      }
      return json({ ok: c.url.pathname });
    });
    const waits: number[] = [];
    let endWait!: () => void;
    const sleep = (ms: number) => {
      waits.push(ms);
      return new Promise<void>((resolve) => (endWait = resolve));
    };
    const http = createHttp("gmail", token, { fetch: s.fetch, sleep });
    const first = http.get("https://example.test/first");
    await vi.waitFor(() => expect(waits).toEqual([3000]));
    const second = http.get("https://example.test/second");
    await new Promise((r) => setTimeout(r, 10));
    expect(s.calls.map((c) => c.url.pathname)).toEqual(["/first"]); // the second request is waiting too
    endWait();
    expect((await second).status).toBe(200);
    expect((await first).status).toBe(200);
    expect(waits).toEqual([3000]); // one wait, shared
  });

  it("a request waiting on someone else's rate limit can still be aborted", async () => {
    const s = scriptedFetch((c) => (c.url.pathname === "/first" ? json({}, 429) : json({})));
    const http = createHttp("gmail", token, { fetch: s.fetch, sleep: () => new Promise<void>(() => {}), retryWaits: [1] });
    void http.get("https://example.test/first");
    await vi.waitFor(() => expect(s.calls).toHaveLength(1));
    const ctl = new AbortController();
    const second = http.get("https://example.test/second", { signal: ctl.signal });
    ctl.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(s.calls).toHaveLength(1);
  });

  it("abort interrupts a backoff wait", async () => {
    const s = scriptedFetch(() => json({}, 429));
    const ctl = new AbortController();
    const http = createHttp("gmail", token, { fetch: s.fetch, sleep: defaultSleep });
    const pending = http.get(URL_, { signal: ctl.signal });
    setTimeout(() => ctl.abort(), 10);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("ProviderHttpError", () => {
  it("carries the status", () => {
    expect(new ProviderHttpError(500, "x").status).toBe(500);
  });
});

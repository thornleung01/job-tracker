// The client's retry rules (never twice for an answered request), Retry-After, bodies, the real sleep, and keeping the key out of errors.
import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEOUT_MS, createClient } from "../../src/ai/client";
import type { AiRequest } from "../../src/ai/deps";
import { AiError } from "../../src/ai/errors";

const KEY = "sk-ant-api03-SECRETSECRETSECRET";
const request: AiRequest = { model: "claude-sonnet-5-5", system: "sys", user: "hello", schema: { type: "object", additionalProperties: false } };

type Step = Response | Error | (() => Promise<Response>);

const reply = (text: string) =>
  new Response(JSON.stringify({ model: "m", stop_reason: "end_turn", content: [{ type: "text", text }] }), { status: 200 });
const failure = (status: number, message = "nope", headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ type: "error", error: { type: "x", message } }), { status, headers });

/** A response whose body yields `chunks` and then, if the last one is an Error, fails. */
function streamed(chunks: (string | Error)[], init: ResponseInit = { status: 200 }, onCancel?: () => void): Response {
  const encoder = new TextEncoder();
  let i = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) return controller.close();
      const chunk = chunks[i++];
      if (chunk instanceof Error) return controller.error(chunk);
      controller.enqueue(encoder.encode(chunk));
    },
    cancel: onCancel,
  }), init);
}

function setup(steps: Step[], opts: { timeoutMs?: number } = {}) {
  let calls = 0;
  const sleeps: number[] = [];
  const fn = (async () => {
    const step = steps[Math.min(calls++, steps.length - 1)];
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step() : step.clone();
  }) as typeof fetch;
  const sleep = async (ms: number) => void sleeps.push(ms);
  return { complete: createClient({ fetch: fn, sleep, now: () => 0, ...opts }), calls: () => calls, sleeps };
}

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return e instanceof AiError ? e.code : `other:${String(e)}`;
  }
  return "none";
};

describe("a request the server already answered is never sent twice", () => {
  it("makes one call when the body of an ok reply dies half way, and says offline", async () => {
    const s = setup([async () => streamed(['{"model":"m","stop_reason":"end_turn","content":[{"type":"te', new TypeError("network error")])]);
    expect(await codeOf(s.complete(KEY, request))).toBe("offline");
    expect(s.calls()).toBe(1);
    expect(s.sleeps).toEqual([]);
  });

  it("makes one call when the body of an error reply dies half way", async () => {
    const s = setup([async () => streamed(['{"error":', new TypeError("network error")], { status: 503 })]);
    expect(await codeOf(s.complete(KEY, request))).toBe("offline");
    expect(s.calls()).toBe(1);
  });

  it("retries twice when fetch rejects before any headers arrive, then says offline", async () => {
    const s = setup([new TypeError("Failed to fetch")]);
    expect(await codeOf(s.complete(KEY, request))).toBe("offline");
    expect(s.calls()).toBe(3);
    expect(s.sleeps).toEqual([2000, 5000]);
  });

  it("doesn't retry a timeout, and the default timeout is 3 minutes", async () => {
    const s = setup([() => new Promise<Response>(() => undefined)], { timeoutMs: 10 });
    expect(await codeOf(s.complete(KEY, request))).toBe("timeout");
    expect(s.calls()).toBe(1);
    expect(s.sleeps).toEqual([]);
    expect(DEFAULT_TIMEOUT_MS).toBe(180_000);
  });
});

describe("retry-after", () => {
  it.each([["0"], ["-5"], ["0.0"], ["Thu, 01 Jan 1970 00:00:00 GMT"], ["not a date"]])("%j asks for nothing, so the backoff step is used", async (value) => {
    const s = setup([failure(429, "x", { "retry-after": value }), reply("{}")]);
    await s.complete(KEY, request);
    expect(s.sleeps).toEqual([2000]);
  });

  it("reads an HTTP date in the future", async () => {
    const s = setup([failure(503, "x", { "retry-after": "Thu, 01 Jan 1970 00:00:09 GMT" }), reply("{}")]);
    await s.complete(KEY, request);
    expect(s.sleeps).toEqual([9000]);
  });
});

describe("bodies", () => {
  it("cuts an oversized error body, cancels the rest, and still maps the status", async () => {
    let cancelled = false;
    const big = Array.from({ length: 30 }, () => "x".repeat(1000));
    const s = setup([async () => streamed(big, { status: 401 }, () => { cancelled = true; })]);
    expect(await codeOf(s.complete(KEY, request))).toBe("badKey");
    expect(s.calls()).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(cancelled).toBe(true);
  });

  it("reads a body that has no reader with text()", async () => {
    const fake = {
      ok: true, status: 200, url: "", headers: new Headers(), body: null,
      text: async () => JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: '{"a":1}' }] }),
    };
    const s = setup([async () => fake as unknown as Response]);
    expect((await s.complete(KEY, request)).json).toEqual({ a: 1 });
  });
});

describe("the real sleep between retries", () => {
  it("waits a tiny real time and retries", async () => {
    let calls = 0;
    const fn = (async () => (++calls === 1 ? failure(503) : reply('{"ok":1}'))) as typeof fetch;
    const complete = createClient({ fetch: fn, retryWaits: [0.01] });
    expect((await complete(KEY, request)).json).toEqual({ ok: 1 });
    expect(calls).toBe(2);
  });

  it("stops waiting when the caller aborts, and doesn't call again", async () => {
    let calls = 0;
    const fn = (async () => (++calls, failure(503))) as typeof fetch;
    const complete = createClient({ fetch: fn, retryWaits: [30] });
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 10);
    const started = Date.now();
    const err = await complete(KEY, request, { signal: ctl.signal }).catch((e: unknown) => e);
    expect((err as DOMException).name).toBe("AbortError");
    expect(calls).toBe(1);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("the key never leaks through an error", () => {
  const everywhere = (err: unknown): string => {
    const e = err as Error & { cause?: unknown };
    const own = Object.getOwnPropertyNames(e).map((k) => String((e as unknown as Record<string, unknown>)[k]));
    return [String(err), JSON.stringify(err), JSON.stringify(Object.entries(e)), ...own, String(e.cause), e.stack].join("\n");
  };

  it("keeps the key out of String, JSON, every property and the cause", async () => {
    const steps: Step[] = [
      failure(401, KEY), failure(400, KEY), failure(429, KEY), new TypeError(`fetch failed for ${KEY}`), reply(KEY),
      async () => streamed([KEY, new TypeError(KEY)]),
    ];
    for (const step of steps) {
      const err = await setup([step]).complete(KEY, request).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AiError);
      expect(everywhere(err)).not.toContain("SECRETSECRET");
      expect((err as { cause?: unknown }).cause).toBeUndefined();
    }
  });

  it("keeps it out after fetch rejections that name the key were retried", async () => {
    const s = setup([new TypeError(`bad ${KEY}`), new TypeError(`bad ${KEY}`), failure(503, KEY)]);
    const err = await s.complete(KEY, request).catch((e: unknown) => e);
    expect(s.calls()).toBe(3);
    expect((err as AiError).code).toBe("busy");
    expect(everywhere(err)).not.toContain("SECRETSECRET");
  });
});

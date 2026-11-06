import { describe, expect, it } from "vitest";
import { AI_URL, AI_VERSION, MAX_RETRY_AFTER_MS, createClient } from "../../src/ai/client";
import type { AiRequest } from "../../src/ai/deps";
import { AiError } from "../../src/ai/errors";
import type { AiErrorCode } from "../../src/ai/errors";
import { MAX_AI_INPUT_CHARS, MAX_AI_OUTPUT_CHARS } from "../../src/db/limits";

const KEY = "sk-ant-api03-SECRETSECRETSECRET";
const request: AiRequest = { model: "claude-sonnet-5-5", system: "sys", user: "hello", schema: { type: "object", additionalProperties: false } };

type Call = { url: string; init: RequestInit };
type Step = Response | Error | ((init: RequestInit) => Promise<Response>);

const reply = (text: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ model: "claude-sonnet-5-5-20261001", stop_reason: "end_turn", content: [{ type: "text", text }], ...extra }), { status: 200 });
const failure = (status: number, message = "nope", extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ type: "error", error: { type: "x", message, ...extra }, request_id: "req_1" }), { status, headers });

/** A fetch that plays the steps in order (the last repeats) and records every call. */
function setup(steps: Step[], opts: { timeoutMs?: number } = {}) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step(init ?? {}) : step.clone();
  }) as typeof fetch;
  const sleep = async (ms: number, signal?: AbortSignal) => {
    sleeps.push(ms);
    if (signal?.aborted) throw signal.reason;
  };
  const complete = createClient({ fetch: fn, sleep, now: () => 0, ...opts });
  return { complete, calls, sleeps };
}

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return e instanceof AiError ? e.code : `other:${String(e)}`;
  }
  return "none";
};

const body = (c: Call) => JSON.parse(String(c.init.body)) as Record<string, unknown>;

describe("the request", () => {
  it("sends exactly the documented headers, with the key only in x-api-key", async () => {
    const { complete, calls } = setup([reply('{"a":1}')]);
    await complete(KEY, request);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(AI_URL);
    expect(calls[0].init.headers).toEqual({
      "content-type": "application/json",
      "x-api-key": KEY,
      "anthropic-version": AI_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    });
    expect(JSON.stringify(calls[0].init.headers).toLowerCase()).not.toContain("authorization");
    expect(String(calls[0].init.body)).not.toContain(KEY);
    expect(AI_VERSION).toBe("2026-10-21");
  });

  it("is a cors request that sends no cookies or referrer and refuses redirects", async () => {
    const { complete, calls } = setup([reply("{}")]);
    await complete(KEY, request);
    expect(calls[0].init).toMatchObject({ method: "POST", credentials: "omit", referrerPolicy: "no-referrer", mode: "cors", redirect: "error" });
  });

  it("builds the structured-output body with no tool_choice, prefill or thinking", async () => {
    const { complete, calls } = setup([reply("{}")]);
    await complete(KEY, request);
    const b = body(calls[0]);
    expect(b).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 8000,
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
      output_config: { format: { type: "json_schema", schema: request.schema } },
    });
    expect(b).not.toHaveProperty("tool_choice");
    expect(b).not.toHaveProperty("thinking");
    expect((b.messages as { role: string }[]).every((m) => m.role === "user")).toBe(true);
  });

  it("uses the caller's maxTokens", async () => {
    const { complete, calls } = setup([reply("{}")]);
    await complete(KEY, { ...request, maxTokens: 123 });
    expect(body(calls[0]).max_tokens).toBe(123);
  });

  it("refuses input over the limit without making a request", async () => {
    const { complete, calls } = setup([reply("{}")]);
    expect(await codeOf(complete(KEY, { ...request, user: "x".repeat(MAX_AI_INPUT_CHARS) }))).toBe("tooLong");
    expect(calls).toHaveLength(0);
    expect(await codeOf(complete(KEY, { ...request, system: "x".repeat(MAX_AI_INPUT_CHARS), user: "y" }))).toBe("tooLong");
    expect(calls).toHaveLength(0);
  });
});

describe("the reply", () => {
  it("returns the parsed JSON of the first text block and the model from the reply", async () => {
    const res = new Response(JSON.stringify({ model: "m-1", stop_reason: "end_turn", content: [{ type: "thinking", text: "no" }, { type: "text", text: '{"a":[1,2]}' }, { type: "text", text: "{}" }] }));
    const { complete } = setup([res]);
    expect(await complete(KEY, request)).toEqual({ json: { a: [1, 2] }, model: "m-1" });
  });

  it("falls back to the requested model", async () => {
    const { complete } = setup([new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] }))]);
    expect((await complete(KEY, request)).model).toBe("claude-sonnet-5-5");
  });

  it("maps max_tokens to cutOff and refusal to refused", async () => {
    expect(await codeOf(setup([reply("{", { stop_reason: "max_tokens" })]).complete(KEY, request))).toBe("cutOff");
    expect(await codeOf(setup([reply("", { stop_reason: "refusal" })]).complete(KEY, request))).toBe("refused");
  });

  it("maps a non-JSON text block, no text block and a non-JSON body to badReply", async () => {
    expect(await codeOf(setup([reply("here you go")]).complete(KEY, request))).toBe("badReply");
    expect(await codeOf(setup([new Response(JSON.stringify({ stop_reason: "end_turn", content: [] }))]).complete(KEY, request))).toBe("badReply");
    expect(await codeOf(setup([new Response("<html>")]).complete(KEY, request))).toBe("badReply");
  });

  it("maps an oversized body to cutOff", async () => {
    const big = new Response("x".repeat(MAX_AI_OUTPUT_CHARS + 1));
    expect(await codeOf(setup([big]).complete(KEY, request))).toBe("cutOff");
  });

  it("refuses a reply that came from another host", async () => {
    const res = reply("{}");
    Object.defineProperty(res, "url", { value: "https://evil.example/v1/messages" });
    const { complete, calls } = setup([async () => res]);
    expect(await codeOf(complete(KEY, request))).toBe("badReply");
    expect(calls).toHaveLength(1);
  });

  it("treats a blocked redirect (fetch throws) as offline", async () => {
    expect(await codeOf(setup([new TypeError("redirect")]).complete(KEY, request))).toBe("offline");
  });
});

describe("status mapping", () => {
  const cases: [string, number, string, Record<string, unknown>, AiErrorCode, number][] = [
    ["other 401", 401, "invalid x-api-key", {}, "badKey", 1],
    ["CORS 401", 401, "CORS requests are not allowed for this Organization", {}, "orgBlocked", 1],
    ["403", 403, "forbidden", {}, "badKey", 1],
    ["402", 402, "billing", {}, "needsCredit", 1],
    ["spend limit by code", 429, "x", { details: { error_code: "enforced_spend_limit_reached" } }, "spendLimit", 1],
    ["spend limit by message", 429, "You have reached your workspace spending limit", {}, "spendLimit", 1],
    ["400", 400, "bad", {}, "badReply", 1],
    ["413", 413, "too big", {}, "tooLong", 1],
    ["404", 404, "nope", {}, "badReply", 1],
    ["plain 429", 429, "slow down", {}, "rateLimited", 3],
    ["500", 500, "oops", {}, "busy", 3],
    ["502", 502, "oops", {}, "busy", 3],
    ["503", 503, "oops", {}, "busy", 3],
    ["504", 504, "oops", {}, "busy", 3],
    ["529", 529, "overloaded", {}, "busy", 3],
  ];
  it.each(cases)("%s", async (_name, status, message, extra, code, callCount) => {
    const { complete, calls } = setup([failure(status, message, extra)]);
    expect(await codeOf(complete(KEY, request))).toBe(code);
    expect(calls).toHaveLength(callCount);
  });

  it("maps an unreadable error body by status alone", async () => {
    expect(await codeOf(setup([new Response("<html>", { status: 503 })]).complete(KEY, request))).toBe("busy");
    expect(await codeOf(setup([new Response("<html>", { status: 401 })]).complete(KEY, request))).toBe("badKey");
  });
});

describe("retries", () => {
  it("retries a plain 429 and then succeeds", async () => {
    const { complete, calls, sleeps } = setup([failure(429), reply('{"ok":true}')]);
    expect((await complete(KEY, request)).json).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it("gives up after 2 retries with the short backoff steps", async () => {
    const { complete, calls, sleeps } = setup([failure(429)]);
    expect(await codeOf(complete(KEY, request))).toBe("rateLimited");
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2000, 5000]);
  });

  it("retries a 529 and then succeeds", async () => {
    const { complete, calls } = setup([failure(529, "overloaded"), failure(529, "overloaded"), reply("{}")]);
    await complete(KEY, request);
    expect(calls).toHaveLength(3);
  });

  it("honours retry-after, capped", async () => {
    const a = setup([failure(429, "x", {}, { "retry-after": "7" }), reply("{}")]);
    await a.complete(KEY, request);
    expect(a.sleeps).toEqual([7000]);
    const b = setup([failure(429, "x", {}, { "retry-after": "3600" }), reply("{}")]);
    await b.complete(KEY, request);
    expect(b.sleeps).toEqual([MAX_RETRY_AFTER_MS]);
  });

  it("falls back to the backoff step when retry-after is unreadable", async () => {
    const { complete, sleeps } = setup([failure(503, "x", {}, { "retry-after": "soon" }), reply("{}")]);
    await complete(KEY, request);
    expect(sleeps).toEqual([2000]);
  });

  it("retries network errors, then reports offline", async () => {
    const { complete, calls } = setup([new TypeError("Failed to fetch")]);
    expect(await codeOf(complete(KEY, request))).toBe("offline");
    expect(calls).toHaveLength(3);
    const again = setup([new TypeError("Failed to fetch"), reply("{}")]);
    await again.complete(KEY, request);
    expect(again.calls).toHaveLength(2);
  });

  it("never retries a spend limit, a bad reply or a cut-off", async () => {
    const spend = setup([failure(429, "x", { details: { error_code: "enforced_spend_limit_reached" } })]);
    await codeOf(spend.complete(KEY, request));
    expect(spend.calls).toHaveLength(1);
    expect(spend.sleeps).toEqual([]);
    const cut = setup([reply("{", { stop_reason: "max_tokens" })]);
    await codeOf(cut.complete(KEY, request));
    expect(cut.calls).toHaveLength(1);
  });
});

describe("timeout and abort", () => {
  it("times out a fetch that never resolves and ignores its signal", async () => {
    const { complete, calls } = setup([() => new Promise<Response>(() => undefined)], { timeoutMs: 20 });
    expect(await codeOf(complete(KEY, request))).toBe("timeout");
    expect(calls).toHaveLength(1);
  });

  it("aborts the fetch's own signal on timeout", async () => {
    let seen: AbortSignal | null | undefined;
    const { complete } = setup([(init) => { seen = init.signal; return new Promise<Response>(() => undefined); }], { timeoutMs: 20 });
    await codeOf(complete(KEY, request));
    expect(seen?.aborted).toBe(true);
  });

  it("rethrows the caller's abort when it was aborted before the call", async () => {
    const { complete, calls } = setup([reply("{}")]);
    const ctl = new AbortController();
    ctl.abort();
    const err = await complete(KEY, request, { signal: ctl.signal }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AiError);
    expect((err as DOMException).name).toBe("AbortError");
    expect(calls).toHaveLength(0);
  });

  it("rethrows the caller's abort during a request", async () => {
    const { complete } = setup([() => new Promise<Response>(() => undefined)]);
    const ctl = new AbortController();
    const p = complete(KEY, request, { signal: ctl.signal }).catch((e: unknown) => e);
    ctl.abort();
    const err = await p;
    expect(err).not.toBeInstanceOf(AiError);
    expect((err as DOMException).name).toBe("AbortError");
  });

  it("rethrows the caller's abort during a retry wait", async () => {
    const ctl = new AbortController();
    const calls: number[] = [];
    const fn = (async () => {
      calls.push(1);
      return failure(503);
    }) as typeof fetch;
    const sleep = (_ms: number, signal?: AbortSignal) =>
      new Promise<void>((_, reject) => {
        ctl.abort();
        reject(signal?.reason);
      });
    const complete = createClient({ fetch: fn, sleep });
    const err = await complete(KEY, request, { signal: ctl.signal }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AiError);
    expect((err as DOMException).name).toBe("AbortError");
    expect(calls).toHaveLength(1);
  });
});

describe("secrets", () => {
  it("never puts the key in a thrown error's message or stack", async () => {
    const steps: Step[] = [failure(401), failure(429), failure(500), new TypeError(`bad ${KEY}`), reply("nope"), failure(403, KEY)];
    for (const step of steps) {
      const err = await setup([step]).complete(KEY, request).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AiError);
      expect(String((err as Error).message)).not.toContain(KEY);
      expect(String((err as Error).stack)).not.toContain(KEY);
    }
  });
});

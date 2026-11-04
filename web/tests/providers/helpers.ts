import type { Sleep } from "../../src/providers/backoff";

export const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export interface Call {
  url: URL;
  headers: Headers;
  signal?: AbortSignal | null;
}

/** A scripted fetch: `handler` answers each request; every request is recorded. */
export function scriptedFetch(handler: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: new URL(String(input)), headers: new Headers(init?.headers), signal: init?.signal };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

/** Records waits (ms) and returns at once. */
export function fakeSleep() {
  const waits: number[] = [];
  const sleep: Sleep = async (ms, signal) => {
    if (signal?.aborted) throw signal.reason;
    waits.push(ms);
  };
  return { sleep, waits };
}

export const token = () => Promise.resolve("tok");

export async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}


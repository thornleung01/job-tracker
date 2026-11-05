import { NotConnected, type ProviderName, type TokenSource } from "../types";

/** Seconds to wait after each rate-limit answer before asking again (same schedule as gmail.py). */
export const RETRY_WAITS: readonly number[] = [5, 15, 30, 60, 60];
const MAX_RETRY_AFTER_MS = 300_000;

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface HttpOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Injectable for tests so backoff is instant. Must reject when `signal` aborts. */
  sleep?: Sleep;
  retryWaits?: readonly number[];
  /** Called with the seconds about to be waited when the provider asks us to slow down. */
  onWait?: (seconds: number) => void;
  now?: () => number;
}

export class ProviderHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export function abortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException("Aborted", "AbortError");
}

export function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

/** Settles like `p`, or rejects with the abort error as soon as `signal` aborts. */
function raceAbort(p: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return p;
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export const defaultSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Retry-After as milliseconds: delta-seconds or an HTTP date. Null when absent or unreadable. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(parseFloat(v) * 1000);
  const when = Date.parse(v);
  return Number.isNaN(when) ? null : Math.max(0, when - now);
}

/**
 * Google's "slow down" answers (also Graph's throttling): too many requests, or a hiccup on their side.
 * Google reports a quota hit as 403 with a body reason of rateLimitExceeded or userRateLimitExceeded; any other 403 is a real refusal.
 */
export function isRetryable(status: number, body: string): boolean {
  return [429, 500, 502, 503, 504].includes(status) || (status === 403 && body.includes("ateLimitExceeded"));
}

export async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new ProviderHttpError(res.status, `HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

export interface Http {
  /**
   * GET with a bearer token. 401: asks the token source again and retries once, then NotConnected.
   * Rate limits and 5xx: waits (Retry-After, else the schedule) and retries. Anything else, including a
   * rate limit that outlasts the schedule, comes back as the Response for the caller to judge.
   * One rate limit answers for the whole mailbox, so while a request waits, every other request on this client waits too.
   */
  get(url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<Response>;
}

export function createHttp(provider: ProviderName, tokenSource: TokenSource, opts: HttpOptions = {}, baseHeaders: Record<string, string> = {}): Http {
  const sleep = opts.sleep ?? defaultSleep;
  const waits = opts.retryWaits ?? RETRY_WAITS;
  const now = opts.now ?? Date.now;
  /** Settles when the rate-limit wait in progress ends; null when nobody is waiting. Never rejects. */
  let cooling: Promise<void> | null = null;
  return {
    async get(url, init = {}) {
      const { signal } = init;
      let retries = 0;
      let refreshed = false;
      for (;;) {
        ensureNotAborted(signal);
        while (cooling) await raceAbort(cooling, signal);
        const token = await tokenSource(provider, signal);
        const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
        const res = await doFetch(url, { method: "GET", headers: { ...baseHeaders, ...init.headers, Authorization: `Bearer ${token}` }, signal });
        if (res.status === 401) {
          if (refreshed) throw new NotConnected(`${provider === "gmail" ? "Gmail" : "Outlook"} rejected the login. Reconnect it and try again.`);
          refreshed = true;
          continue;
        }
        if (res.ok) return res;
        const text = res.status === 403 ? await res.clone().text().catch(() => "") : "";
        if (!isRetryable(res.status, text) || retries >= waits.length) return res;
        const ms = Math.min(parseRetryAfter(res.headers.get("retry-after"), now()) ?? waits[retries] * 1000, MAX_RETRY_AFTER_MS);
        retries++;
        opts.onWait?.(ms / 1000);
        const wait = sleep(ms, signal);
        const mine = wait.then(() => undefined, () => undefined);
        const shared: Promise<void> = cooling ? Promise.all([cooling, mine]).then(() => undefined) : mine;
        cooling = shared;
        void shared.then(() => {
          if (cooling === shared) cooling = null;
        });
        await wait;
      }
    },
  };
}

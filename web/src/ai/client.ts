// Calls the Anthropic Messages API straight from the browser with the person's own key. Nothing here logs or keeps a key, a header, a request body
// or a reply body: every failure becomes an AiError whose words are fixed sentences (see errors.ts).
//
// Checked against platform.claude.com on 2026-11-06:
// - api/overview: `anthropic-version` is required, and its current documented value is 2026-10-21; `x-api-key` is still accepted. Keys that aren't
//   scoped to one workspace also need an `anthropic-workspace-id` header (else a 400, which maps to badReply here). We don't send one.
// - manage-claude/authentication, "Browser-based applications": a direct browser call is CORS and is accepted only with
//   `anthropic-dangerous-direct-browser-access: true`. Organizations with ZDR or the Compliance API get a 401 whose message begins
//   "CORS requests are not allowed for this Organization" even with a valid key (orgBlocked).
// - build-with-claude/structured-outputs: `output_config.format = { type: "json_schema", schema }`, no beta header, the JSON is in the text block.
import { isRecord } from "../db/isRecord";
import { MAX_AI_INPUT_CHARS, MAX_AI_OUTPUT_CHARS } from "../db/limits";
import { abortError, defaultSleep, ensureNotAborted, parseRetryAfter } from "../providers/backoff";
import type { Sleep } from "../providers/backoff";
import type { AiReply, AiRequest, Complete } from "./deps";
import { AiError } from "./errors";

export const AI_HOST = "api.anthropic.com";
export const AI_URL = `https://${AI_HOST}/v1/messages`;
export const AI_VERSION = "2026-10-21";
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_TOKENS = 8000;
/** Seconds to wait before the first and the second retry when the server gives no Retry-After. */
export const RETRY_WAITS: readonly number[] = [2, 5];
export const MAX_RETRY_AFTER_MS = 30_000;
/** An error body is small; read no more than this much of one. */
const MAX_ERROR_CHARS = 20_000;

export interface ClientOptions {
  fetch?: typeof fetch;
  sleep?: Sleep;
  timeoutMs?: number;
  /** Seconds to wait before each retry. Its length is the number of retries. */
  retryWaits?: readonly number[];
  now?: () => number;
}

/** A failed attempt. `retryAfterMs` is the server's own wish, when it sent a readable Retry-After. */
interface Failure {
  error: AiError;
  retry: boolean;
  retryAfterMs?: number | null;
}

/** Reads at most `maxChars` characters of the body. Null when there is more. */
async function readCapped(res: Response, maxChars: number): Promise<string | null> {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    return text.length > maxChars ? null : text;
  }
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length > maxChars) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
  }
  text += decoder.decode();
  return text.length > maxChars ? null : text;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The error for a failed status. The body only decides between the cases below; it is never kept. */
function classify(status: number, body: unknown): Pick<Failure, "error" | "retry"> {
  const err = isRecord(body) && isRecord(body.error) ? body.error : {};
  const message = typeof err.message === "string" ? err.message : "";
  const details = isRecord(err.details) ? err.details : {};
  switch (status) {
    case 401:
      return { error: new AiError(message.startsWith("CORS requests are not allowed") ? "orgBlocked" : "badKey"), retry: false };
    case 403:
      return { error: new AiError("badKey"), retry: false };
    case 402:
      return { error: new AiError("needsCredit"), retry: false };
    case 413:
      return { error: new AiError("tooLong"), retry: false };
    case 429:
      if (details.error_code === "enforced_spend_limit_reached" || /spend(ing)? limit/i.test(message)) return { error: new AiError("spendLimit"), retry: false };
      return { error: new AiError("rateLimited"), retry: true };
    case 500:
    case 502:
    case 503:
    case 504:
    case 529:
      return { error: new AiError("busy"), retry: true };
    default:
      // A 400 invalid_request_error means we built the request wrongly: a bug, not the person's doing. Nothing sensitive is logged.
      return { error: new AiError("badReply"), retry: false };
  }
}

/** The text of the first text block, as the JSON the model was asked for. */
function readAnswer(body: unknown, requested: string): AiReply {
  if (!isRecord(body)) throw new AiError("badReply");
  if (body.stop_reason === "max_tokens") throw new AiError("cutOff");
  if (body.stop_reason === "refusal") throw new AiError("refused");
  const block = Array.isArray(body.content) ? body.content.find((b): b is Record<string, unknown> => isRecord(b) && b.type === "text") : undefined;
  if (!block || typeof block.text !== "string") throw new AiError("badReply");
  let json: unknown;
  try {
    json = JSON.parse(block.text);
  } catch {
    throw new AiError("badReply");
  }
  return { json, model: typeof body.model === "string" && body.model ? body.model : requested };
}

export function createClient(opts: ClientOptions = {}): Complete {
  const sleep = opts.sleep ?? defaultSleep;
  const waits = opts.retryWaits ?? RETRY_WAITS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = opts.now ?? Date.now;

  /** One request. Returns the reply or a Failure; throws only for our timeout and the caller's own abort. */
  async function attempt(key: string, request: AiRequest, signal: AbortSignal | undefined): Promise<AiReply | Failure> {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    // Rejects on the caller's abort or on our timeout, so a fetch that ignores its signal can't hang us.
    const stopped = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new AiError("timeout"));
        ctl.abort();
      }, timeoutMs);
      onAbort = () => {
        reject(abortError(signal));
        ctl.abort();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    stopped.catch(() => undefined);
    try {
      const work = (async (): Promise<AiReply | Failure> => {
        const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
        let res: Response;
        let text: string | null;
        try {
          res = await doFetch(AI_URL, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": key,
              "anthropic-version": AI_VERSION,
              "anthropic-dangerous-direct-browser-access": "true",
            },
            body: JSON.stringify({
              model: request.model,
              max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
              system: request.system,
              messages: [{ role: "user", content: request.user }],
              output_config: { format: { type: "json_schema", schema: request.schema } },
            }),
            credentials: "omit",
            referrerPolicy: "no-referrer",
            mode: "cors",
            redirect: "error",
            signal: ctl.signal,
          });
          if (res.url && new URL(res.url).host !== AI_HOST) return { error: new AiError("badReply"), retry: false };
          text = await readCapped(res, res.ok ? MAX_AI_OUTPUT_CHARS : MAX_ERROR_CHARS);
        } catch {
          // A thrown fetch (or a body that dies half way) is a network failure. The caller's abort and our timeout win the race below.
          return { error: new AiError("offline"), retry: true };
        }
        if (res.ok) {
          if (text === null) return { error: new AiError("cutOff"), retry: false };
          return readAnswer(parseJson(text), request.model);
        }
        const failure = classify(res.status, text === null ? undefined : parseJson(text));
        return { ...failure, retryAfterMs: failure.retry ? parseRetryAfter(res.headers?.get?.("retry-after") ?? null, now()) : null };
      })().catch((e: unknown): Failure => ({ error: e instanceof AiError ? e : new AiError("badReply"), retry: false }));
      return await Promise.race([work, stopped]);
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
  }

  return async (key, request, options = {}) => {
    const { signal } = options;
    if (request.system.length + request.user.length > MAX_AI_INPUT_CHARS) throw new AiError("tooLong");
    for (let retries = 0; ; retries++) {
      ensureNotAborted(signal);
      const outcome = await attempt(key, request, signal);
      if (!("error" in outcome)) return outcome;
      if (!outcome.retry || retries >= waits.length) throw outcome.error;
      await sleep(Math.min(outcome.retryAfterMs ?? waits[retries] * 1000, MAX_RETRY_AFTER_MS), signal);
    }
  };
}

export const callClaude: Complete = createClient();

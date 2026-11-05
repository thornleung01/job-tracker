import type { MailProvider, Message, TokenSource } from "../types";
import { createHttp, ensureNotAborted, ProviderHttpError, readJson, type HttpOptions } from "./backoff";
import { base64ToBytes, decodeMimeWords, parseAddress } from "./headers";
import { htmlToText } from "./htmlToText";

export const GMAIL = "https://gmail.googleapis.com/gmail/v1";
export const EXCLUDE = "-in:spam -in:sent -in:drafts -category:promotions -category:social -category:forums";

export interface GmailOptions extends HttpOptions {
  address?: string | null;
  /** Yield oldest first, like the Python edition, so a cut-short sync has saved everything before where it stopped. */
  oldestFirst?: boolean;
  /** Called once the id list is read, with how many bodies will be downloaded. */
  onPending?: (count: number) => void;
}

export interface GmailProvider extends MailProvider {
  name: "gmail";
  /** Looks up the connected account's email address and stores it on `address`. */
  resolveAddress(signal?: AbortSignal): Promise<string>;
}

interface Part {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: Part[];
}
interface RawMessage {
  id: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: Part & { headers?: { name: string; value: string }[] };
}

function decodePart(part: Part): string {
  const type = part.headers?.find((h) => h.name.toLowerCase() === "content-type")?.value ?? "";
  const charset = /charset="?([\w.:-]+)"?/i.exec(type)?.[1] ?? "utf-8";
  const bytes = base64ToBytes(part.body?.data ?? "");
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function findPart(payload: Part, mime: string): string | null {
  if (payload.mimeType === mime && payload.body?.data) return decodePart(payload);
  for (const part of payload.parts ?? []) {
    const found = findPart(part, mime);
    if (found) return found;
  }
  return null;
}

export function isBulk(headers: Record<string, string>): boolean {
  return Boolean(
    headers["list-unsubscribe"] || headers["list-id"] || ["bulk", "list", "junk"].includes((headers["precedence"] ?? "").trim().toLowerCase()),
  );
}

function receivedAt(raw: RawMessage, headers: Record<string, string>): string {
  if (raw.internalDate) return new Date(Number(raw.internalDate)).toISOString();
  const when = new Date(headers["date"] ?? "");
  if (Number.isNaN(when.getTime())) throw new Error(`message ${raw.id} has no usable internalDate or Date header`);
  return when.toISOString();
}

export function parseGmailMessage(raw: RawMessage): Message {
  const payload = raw.payload ?? {};
  const headers: Record<string, string> = {};
  for (const h of payload.headers ?? []) headers[h.name.toLowerCase()] = h.value;
  const { name, email } = parseAddress(headers["from"] ?? "");
  const html = findPart(payload, "text/html") ?? "";
  let body = findPart(payload, "text/plain");
  if (body === null) body = html ? htmlToText(html) : (raw.snippet ?? "");
  return {
    bulk: isBulk(headers),
    id: raw.id,
    threadId: raw.threadId ?? raw.id,
    senderName: name,
    senderEmail: email,
    subject: decodeMimeWords(headers["subject"] ?? ""),
    receivedAt: receivedAt(raw, headers),
    body,
    webLink: null,
    html,
  };
}

export function createGmailProvider(tokenSource: TokenSource, opts: GmailOptions = {}): GmailProvider {
  const http = createHttp("gmail", tokenSource, opts);
  const getJson = async <T>(url: string, signal?: AbortSignal) => readJson<T>(await http.get(url, { signal }));

  const provider: GmailProvider = {
    name: "gmail",
    address: opts.address ?? null,
    async resolveAddress(signal) {
      provider.address = await getGmailAddress(tokenSource, opts, signal);
      return provider.address;
    },
    async *fetch(since, skip, signal) {
      const q = `after:${Math.floor(since.getTime() / 1000)} ${EXCLUDE}`;
      const ids: string[] = [];
      let page: string | undefined;
      do {
        const params = new URLSearchParams({ q, maxResults: "500" });
        if (page) params.set("pageToken", page);
        const data = await getJson<{ messages?: { id: string }[]; nextPageToken?: string }>(`${GMAIL}/users/me/messages?${params}`, signal);
        for (const ref of data.messages ?? []) ids.push(ref.id);
        page = data.nextPageToken;
      } while (page);

      const todo = ids.filter((id) => !skip(id)); // Gmail lists newest first
      if (opts.oldestFirst) todo.reverse();
      opts.onPending?.(todo.length);

      for (const id of todo) {
        ensureNotAborted(signal);
        let raw: RawMessage;
        try {
          raw = await getJson<RawMessage>(`${GMAIL}/users/me/messages/${encodeURIComponent(id)}?format=full`, signal);
        } catch (err) {
          if (err instanceof ProviderHttpError && err.status === 404) continue; // deleted since it was listed
          throw err;
        }
        let msg: Message;
        try {
          msg = parseGmailMessage(raw);
        } catch (err) {
          console.warn(`Skipping malformed Gmail message ${id}:`, err);
          continue;
        }
        yield msg;
      }
    },
  };
  return provider;
}

export async function getGmailAddress(tokenSource: TokenSource, opts: HttpOptions = {}, signal?: AbortSignal): Promise<string> {
  const http = createHttp("gmail", tokenSource, opts);
  const data = await readJson<{ emailAddress?: string }>(await http.get(`${GMAIL}/users/me/profile`, { signal }));
  if (!data.emailAddress) throw new Error("Gmail didn't share this account's email address. Try again.");
  return data.emailAddress;
}

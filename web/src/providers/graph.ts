import type { MailProvider, Message, TokenSource } from "../types";
import { createHttp, ensureNotAborted, readJson, type HttpOptions } from "./backoff";
import { htmlToText } from "./htmlToText";

export const GRAPH = "https://graph.microsoft.com/v1.0";
export const SKIP_FOLDERS = ["junkemail", "sentitems", "drafts", "deleteditems"];

// Immutable ids survive folder moves, which keeps dedup stable.
const HEADERS = { Prefer: 'IdType="ImmutableId"' };

export interface GraphOptions extends HttpOptions {
  address?: string | null;
}

export interface GraphProvider extends MailProvider {
  name: "outlook";
  /** Looks up the connected account's email address and stores it on `address`. */
  resolveAddress(signal?: AbortSignal): Promise<string>;
}

interface RawGraphMessage {
  id: string;
  conversationId?: string | null;
  subject?: string | null;
  from?: { emailAddress?: { name?: string | null; address?: string | null } } | null;
  receivedDateTime: string;
  body?: { contentType?: string; content?: string | null } | null;
  parentFolderId?: string;
  webLink?: string | null;
  internetMessageHeaders?: { name?: string; value?: string }[] | null;
}

function isBulk(headers: Record<string, string>): boolean {
  return Boolean(
    headers["list-unsubscribe"] || headers["list-id"] || ["bulk", "list", "junk"].includes((headers["precedence"] ?? "").trim().toLowerCase()),
  );
}

export function parseGraphMessage(raw: RawGraphMessage): Message {
  const sender = raw.from?.emailAddress ?? {};
  let text = raw.body?.content ?? "";
  let html = "";
  if ((raw.body?.contentType ?? "").toLowerCase() === "html") {
    html = text;
    text = htmlToText(text);
  }
  const headers: Record<string, string> = {};
  for (const h of raw.internetMessageHeaders ?? []) headers[(h.name ?? "").toLowerCase()] = h.value ?? "";
  const when = new Date(raw.receivedDateTime);
  if (Number.isNaN(when.getTime())) throw new Error(`message ${raw.id} has no usable receivedDateTime`);
  return {
    bulk: isBulk(headers),
    id: raw.id,
    threadId: raw.conversationId || raw.id,
    senderName: sender.name ?? "",
    senderEmail: sender.address ?? "",
    subject: raw.subject ?? "",
    receivedAt: when.toISOString(),
    body: text,
    webLink: raw.webLink || null,
    html,
  };
}

export function createGraphProvider(tokenSource: TokenSource, opts: GraphOptions = {}): GraphProvider {
  const http = createHttp("outlook", tokenSource, opts, HEADERS);

  const provider: GraphProvider = {
    name: "outlook",
    address: opts.address ?? null,
    async resolveAddress(signal) {
      provider.address = await getGraphAddress(tokenSource, opts, signal);
      return provider.address;
    },
    async *fetch(since, skip, signal) {
      const excluded = new Set<string>();
      for (const folder of SKIP_FOLDERS) {
        const res = await http.get(`${GRAPH}/me/mailFolders/${folder}?$select=id`, { signal });
        if (res.ok) excluded.add(((await res.json()) as { id: string }).id);
      }

      const sinceUtc = since.toISOString().slice(0, 19) + "Z";
      let url: string | undefined =
        `${GRAPH}/me/messages?$filter=receivedDateTime%20ge%20${sinceUtc}` +
        "&$orderby=receivedDateTime%20desc&$top=50" +
        "&$select=id,conversationId,subject,from,receivedDateTime,body,parentFolderId,webLink,internetMessageHeaders";
      while (url) {
        const data: { value?: RawGraphMessage[]; "@odata.nextLink"?: string } = await readJson(await http.get(url, { signal }));
        for (const raw of data.value ?? []) {
          ensureNotAborted(signal);
          if ((raw.parentFolderId && excluded.has(raw.parentFolderId)) || skip(raw.id)) continue;
          let msg: Message;
          try {
            msg = parseGraphMessage(raw);
          } catch (err) {
            console.warn(`Skipping malformed Outlook message ${raw.id}:`, err);
            continue;
          }
          yield msg;
        }
        url = data["@odata.nextLink"];
        // The bearer token only ever goes to Graph.
        if (url && !url.startsWith("https://graph.microsoft.com/")) throw new Error("Unexpected next page address from Microsoft Graph.");
      }
    },
  };
  return provider;
}

export async function getGraphAddress(tokenSource: TokenSource, opts: HttpOptions = {}, signal?: AbortSignal): Promise<string> {
  const http = createHttp("outlook", tokenSource, opts);
  const data = await readJson<{ mail?: string | null; userPrincipalName?: string | null }>(
    await http.get(`${GRAPH}/me?$select=mail,userPrincipalName`, { signal }),
  );
  const address = data.mail || data.userPrincipalName;
  if (!address) throw new Error("Microsoft signed you in but didn't share this account's email address.");
  return address;
}

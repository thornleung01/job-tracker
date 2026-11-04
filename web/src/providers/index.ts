import type { MailProvider, ProviderName, TokenSource } from "../types";
import { getGmailAddress, createGmailProvider, type GmailOptions } from "./gmail";
import { getGraphAddress, createGraphProvider, type GraphOptions } from "./graph";
import type { HttpOptions } from "./backoff";

export { createGmailProvider, getGmailAddress, parseGmailMessage, EXCLUDE, GMAIL, type GmailOptions, type GmailProvider } from "./gmail";
export { createGraphProvider, getGraphAddress, parseGraphMessage, GRAPH, SKIP_FOLDERS, type GraphOptions, type GraphProvider } from "./graph";
export { htmlToText } from "./htmlToText";
export { ProviderHttpError, RETRY_WAITS, parseRetryAfter, type HttpOptions, type Sleep } from "./backoff";

export function createProvider(name: ProviderName, tokenSource: TokenSource, opts: GmailOptions & GraphOptions = {}): MailProvider {
  return name === "gmail" ? createGmailProvider(tokenSource, opts) : createGraphProvider(tokenSource, opts);
}

/** The connected account's email address, for showing in the UI. */
export function getAddress(name: ProviderName, tokenSource: TokenSource, opts: HttpOptions = {}, signal?: AbortSignal): Promise<string> {
  return name === "gmail" ? getGmailAddress(tokenSource, opts, signal) : getGraphAddress(tokenSource, opts, signal);
}

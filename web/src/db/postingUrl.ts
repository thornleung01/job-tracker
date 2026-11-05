// The link to a job posting. One rule, used wherever a link is saved, imported or shown: an absolute http(s) address with
// no credentials, no fragment and at most 500 characters. Anything else is refused (saving) or dropped (importing).
import { ActionError } from "./errors";
import { MAX_URL_CHARS } from "./limits";

export const POSTING_URL_MESSAGE = "That link doesn't look right. Use a web address that starts with https://.";

/** The cleaned address, "" for empty input, or null when the value is not an acceptable link. */
export function parsePostingUrl(raw: unknown): string | null {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return "";
  if (!/^https?:\/\//i.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return null;
  if (url.username || url.password) return null;
  url.hash = "";
  const clean = url.href;
  return clean.length > MAX_URL_CHARS ? null : clean;
}

/** Trims and checks a link before it is saved. "" means no link. Throws ActionError for anything that is not a web address. */
export function cleanPostingUrl(raw: string): string {
  const clean = parsePostingUrl(raw);
  if (clean === null) throw new ActionError(POSTING_URL_MESSAGE);
  return clean;
}

/** The same check for places that must never fail (importing, rendering): "" when the value is not an acceptable link. */
export function safePostingUrl(raw: unknown): string {
  return parsePostingUrl(raw) ?? "";
}

/** The host of a (valid) link, for a tooltip. */
export function postingHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

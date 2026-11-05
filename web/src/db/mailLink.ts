// The "open in Outlook" link Microsoft gives for a message, kept only when it really points at Microsoft's own web mail.
// One rule, used when a message is saved and when a file is imported: an imported file is data from outside, and a link
// that says "Open in Outlook" must not lead anywhere else.

/** The hosts Microsoft Graph's webLink uses: Microsoft 365 (work or school) and outlook.com (personal). */
export const OUTLOOK_HOSTS: ReadonlySet<string> = new Set(["outlook.office.com", "outlook.office365.com", "outlook.live.com"]);

const MAX_WEB_LINK_CHARS = 2000;

/** The link when it is a plain https address on an Outlook host with no credentials, otherwise null. */
export function safeWebLink(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw || raw.length > MAX_WEB_LINK_CHARS) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || !OUTLOOK_HOSTS.has(url.hostname)) return null;
  return raw;
}

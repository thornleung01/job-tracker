// The text of a job posting, kept on the application so you can reread it before an interview. Text only: whatever a page
// or a job board sends is turned into plain lines here and never kept as markup.
import { MAX_POSTING_CHARS } from "../db/limits";
import { htmlToText } from "../providers/htmlToText";

const LOOKS_LIKE_MARKUP = /<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?\/?>/i;
const HAS_ENTITY = /&(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);/i;
const needsReading = (text: string): boolean => LOOKS_LIKE_MARKUP.test(text) || HAS_ENTITY.test(text);
const INLINE_TAGS = /<\/?(?:a|abbr|b|big|cite|code|em|font|i|mark|small|span|strong|sub|sup|u)\b[^>]*>/gi;

const clean = (text: string): string =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** One pass of HTML to text. Inline tags are dropped first so "<b>Python</b> and Java" stays one line. */
function markupToText(html: string): string {
  const flat = html.replace(/<br\s*\/?>/gi, "\n").replace(INLINE_TAGS, "");
  if (typeof DOMParser === "undefined") return flat.replace(/<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi, " ").replace(/<[^>]*>/g, "\n");
  return htmlToText(flat);
}

/**
 * Plain text from a posting's description, which may be HTML, HTML that was escaped again (Greenhouse sends it that way), or
 * text already. Cut to the limit. Returns "" for anything that isn't a string or has no text.
 */
export function postingText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let text = raw.slice(0, MAX_POSTING_CHARS * 8);
  // Escaped markup decodes to markup on the first pass, so look again, but never more than three times.
  for (let pass = 0; pass < 3 && needsReading(text); pass++) text = markupToText(text);
  if (LOOKS_LIKE_MARKUP.test(text)) text = text.replace(/<[^>]*>/g, " ");
  return clean(text).slice(0, MAX_POSTING_CHARS).trim();
}

/** Several parts of one posting (intro, duties, requirements) as one text, a blank line between parts. */
export function joinPostingParts(parts: readonly unknown[]): string {
  return parts.map(postingText).filter(Boolean).join("\n\n").slice(0, MAX_POSTING_CHARS).trim();
}

// The text of a job posting, kept on the application so you can reread it before an interview. Text only: whatever a page
// or a job board sends is turned into plain lines here and never kept as markup.
import { MAX_POSTING_CHARS } from "../db/limits";
import { htmlToText } from "../providers/htmlToText";
import { replaceTags, stripScriptBlocks, stripTags } from "./markup";

// A tag name, then a space (and a ">" somewhere later) or an immediate ">" or "/>". Scanned in one pass, see markup.ts.
const TAG_START = /<\/?[a-z][a-z0-9-]*(?:(\s)|\/?>)/gi;
function looksLikeMarkup(text: string): boolean {
  const lastGt = text.lastIndexOf(">");
  if (lastGt < 0) return false;
  TAG_START.lastIndex = 0;
  const m = TAG_START.exec(text);
  return m !== null && (m[1] === undefined || lastGt >= m.index + m[0].length);
}
const HAS_ENTITY = /&(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);/i;
const needsReading = (text: string): boolean => looksLikeMarkup(text) || HAS_ENTITY.test(text);
const INLINE_TAGS = /<\/?(?:a|abbr|b|big|cite|code|em|font|i|mark|small|span|strong|sub|sup|u)\b/;

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
  const flat = replaceTags(html.replace(/<br\s*\/?>/gi, "\n"), INLINE_TAGS, "");
  if (typeof DOMParser === "undefined") return stripTags(stripScriptBlocks(flat, " "), "\n");
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
  if (looksLikeMarkup(text)) text = stripTags(text, " ");
  return clean(text).slice(0, MAX_POSTING_CHARS).trim();
}

/** Several parts of one posting (intro, duties, requirements) as one text, a blank line between parts. */
export function joinPostingParts(parts: readonly unknown[]): string {
  return parts.map(postingText).filter(Boolean).join("\n\n").slice(0, MAX_POSTING_CHARS).trim();
}

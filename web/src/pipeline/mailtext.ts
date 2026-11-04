// Port of jobtracker/mailtext.py: the plain text of a stored email made readable.
//
// The text comes from HTML flattened to plain text, so it carries the marks of that: line breaks in the middle of
// sentences, non-breaking spaces, invisible padding characters, whole reply chains and marketing footers. This repairs the
// line breaks, folds the reply chain and the footer, and shows each link as its domain. Everything is escaped, and links
// are shown but never made clickable.
import { py, pyFull, match, sub, finditer, test } from "./pyre";
import { cpLen, escapeHtml, firstChar, isLower, partition, rstrip, strip } from "./pystr";
import { UrlValueError, urlHostname } from "./url";

const R = String.raw;

const INVISIBLE = py("[\\u{034f}\\u{200b}-\\u{200f}\\u{2060}\\u{feff}\\u{00ad}]", "g");
const URL_RE = py(R`https?://[^\s<>"')\]]+`, "ig");
const BRACKETED_URL = py(R`[(\[]\s*(https?://[^\s<>"')\]]+)\s*[)\]]`, "ig");

const BULLETS = "-\\u{2022}*\\u{2013}";
const LIST_ITEM = py(String.raw`^(?:[${BULLETS}]|\d{1,2}[.)])\s+\S`);
const LIST_MARKER_G = py(String.raw`^(?:[${BULLETS}]|\d{1,2}[.)])\s+`, "g");
const SALUTATION = py(R`^(?:hi|hello|hey|dear|good (?:morning|afternoon|evening))\b[^.!?]{0,40}[,!]?$`, "i");
const SIGNOFF = py(
  R`^(?:best|best regards|kind regards|regards|warm regards|thanks|thank you|many thanks|cheers|sincerely|talk soon)[,!.]?$`,
  "i",
);
const BANNER = py(R`^(?:EXT SENDER|EXTERNAL (?:EMAIL|SENDER)|CAUTION: This (?:email|message)|\[EXTERNAL\])`, "i");
const QUOTE_START = [
  py(R`^On .{3,160}\bwrote:?$`, "i"),
  py(R`^Le .{3,160}\ba \u{e9}crit\s?:?$`, "i"),
  py(R`^-{2,}\s*Original Message\s*-{2,}$`, "i"),
  py(R`^>`),
];
// A reply's own header ("On Fri, Oct 23 ... wrote:") always starts a new block, however it was wrapped.
const QUOTE_LEAD = py(R`^(?:On (?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,? |[A-Z][a-z]{2,8} \d)|Le \w+ \d|From: )`);
const HEADER_LABEL = py(R`^(?:From|Sent|To|Cc|Bcc|Subject|Date|De|Envoy\u{e9}|\u{c0}|Objet):\s*$`);
const FOOTER = py(
  R`unsubscribe|this email was (?:intended|sent) for|you(?:'re| are) receiving (?:this|these|linkedin)|\u{a9}\s?\d{4}|` +
    R`manage (?:your )?(?:email )?(?:preferences|subscription|settings)|view (?:this email )?(?:online|in (?:your )?browser)`,
  "i",
);
const BULLET_ALONE = pyFull(`[${BULLETS}]`);
const HEADER_LINE = py(R`^(?:From|Sent|To|Cc|Subject|Date): `);
const SENTENCE_END = py(R`[.!?:]["')]?$`);
const OUTLOOK_FROM = py(R`^(?:From|De):\s`, "i");
const OUTLOOK_SENT = py(R`^(?:Sent|Date|Envoy)`, "i");
const WS_RUN = py(R`\s+`, "g");
const PARA_BREAK = py(R`\n\s*\n`);

/** Characters of real content that must come first, or a "view online" line at the top is not a footer. */
export const FOOTER_MIN_BEFORE = 150;

/** 'Pat Lee <pat@acme.com>' -> ['Pat Lee', 'pat@acme.com']. A bare address has no name. */
export function splitSender(sender: string | null | undefined): [string, string] {
  const s = strip(sender ?? "");
  if (s.includes("<")) {
    const [name, , rest] = partition(s, "<");
    return [strip(strip(name), '"'), strip(rstrip(rest, ">"))];
  }
  return s.includes("@") ? ["", s] : [s, ""];
}

const joinsTight = (ch: string): boolean => ":,;).".includes(ch) || ch === "?";

/** Is line b the continuation of line a? HTML turned every inline tag into a line break, so most are. */
export function joins(a: string, b: string): boolean {
  const b0 = firstChar(b);
  if (joinsTight(b0)) return true;
  if (match(BULLET_ALONE, a)) return true; // a bullet on its own line belongs to the next one
  if (test(HEADER_LABEL, a)) return true; // "From:" on one line, the sender on the next
  if (test(HEADER_LABEL, b) || test(HEADER_LINE, b)) return false; // ...and the next label starts a new line of the header
  if (
    test(LIST_ITEM, b) || test(SIGNOFF, b) || test(SALUTATION, b) || test(QUOTE_LEAD, b) ||
    test(SALUTATION, a) || test(SIGNOFF, a)
  ) {
    return false;
  }
  if (a.endsWith(":") && isLower(b0)) return true; // "Referrals:" then "you get a bonus": one thought
  if (test(SENTENCE_END, a)) return false;
  if (a.endsWith(",") && cpLen(a) <= 24) return false; // a short line ending in a comma is a greeting or a sign-off
  return true;
}

export function blocks(text: string | null | undefined): string[] {
  const t = sub(INVISIBLE, "", text || "").replaceAll("\xa0", " ").replaceAll("\u{202f}", " ").replaceAll("\r\n", "\n");
  const out: string[] = [];
  PARA_BREAK.lastIndex = 0;
  for (const chunk of t.split(PARA_BREAK)) {
    let cur = "";
    for (const raw of chunk.split("\n")) {
      const line = strip(sub(WS_RUN, " ", raw));
      if (!line || test(BANNER, line)) continue;
      if (!cur) cur = line;
      else if (joins(cur, line)) cur += (joinsTight(firstChar(line)) ? "" : " ") + line;
      else {
        out.push(cur);
        cur = line;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

function isQuoteStart(bl: string[], i: number): boolean {
  const b = bl[i];
  if (QUOTE_START.some((p) => test(p, b))) return true;
  // Outlook-style header: "From: ..." followed within a couple of lines by "Sent: ..." or "Date: ..."
  return test(OUTLOOK_FROM, b) && bl.slice(i + 1, i + 4).some((x) => test(OUTLOOK_SENT, x));
}

/** [the message, the earlier thread, the footer], each a list of text blocks. */
export function parts(body: string | null | undefined): [string[], string[], string[]] {
  let bl = blocks(body ?? "");
  let thread: string[] = [];
  for (let i = 1; i < bl.length; i++) {
    // a message that is only a quote has no thread to fold
    if (isQuoteStart(bl, i)) {
      thread = bl.slice(i);
      bl = bl.slice(0, i);
      break;
    }
  }
  let footer: string[] = [];
  let seen = 0;
  for (let i = 0; i < bl.length; i++) {
    const b = bl[i];
    if (i && seen >= FOOTER_MIN_BEFORE && test(FOOTER, b)) {
      footer = bl.slice(i);
      bl = bl.slice(0, i);
      break;
    }
    seen += cpLen(b);
  }
  return [bl, thread, footer];
}

/** Escape, and show each link as its domain (the full address stays in the tooltip). */
export function inline(input: string): string {
  const text = sub2(BRACKETED_URL, input);
  const out: string[] = [];
  let last = 0;
  for (const m of finditer(URL_RE, text)) {
    out.push(escapeHtml(text.slice(last, m.index)));
    const url = rstrip(m[0], ".,;:!?");
    let host: string;
    try {
      host = (urlHostname(url) || "link").replace(/^www\./, "");
    } catch (e) {
      if (!(e instanceof UrlValueError)) throw e;
      host = "link"; // "http://[abc" and the like: show it as a plain link rather than failing the page
    }
    out.push(`<span class="url" title="${escapeHtml(url)}">${escapeHtml(host)}</span>`);
    last = m.index + url.length;
  }
  out.push(escapeHtml(text.slice(last)));
  return out.join("");
}

// re.sub(pattern, lambda m: m.group(1), text)
function sub2(re: RegExp, s: string): string {
  re.lastIndex = 0;
  return s.replace(re, (_m, g1: string) => g1);
}

export function blocksToHtml(bl: string[]): string {
  const html: string[] = [];
  const items: string[] = [];
  const flush = () => {
    if (items.length) {
      html.push("<ul>" + items.map((i) => `<li>${i}</li>`).join("") + "</ul>");
      items.length = 0;
    }
  };
  for (const b of bl) {
    if (test(LIST_ITEM, b)) {
      items.push(inline(sub(LIST_MARKER_G, "", b)));
      continue;
    }
    flush();
    const cls = test(SIGNOFF, b) ? ' class="sig"' : "";
    html.push(`<p${cls}>${inline(b)}</p>`);
  }
  flush();
  return html.join("");
}

/** The email body as safe HTML: paragraphs and lists, the thread and footer folded under <details>. */
export function render(body: string | null | undefined): string {
  const [main, thread, footer] = parts(body);
  if (!(main.length || thread.length || footer.length)) {
    return '<div class="mail-text"><p class="mail-empty">No text was stored for this email.</p></div>';
  }
  const html = [blocksToHtml(main) || '<p class="mail-empty">Only quoted or footer text was stored for this email.</p>'];
  if (thread.length) html.push(`<details class="mail-fold"><summary>Earlier in this thread</summary>${blocksToHtml(thread)}</details>`);
  if (footer.length) html.push(`<details class="mail-fold"><summary>Footer and links</summary>${blocksToHtml(footer)}</details>`);
  return '<div class="mail-text">' + html.join("") + "</div>";
}

/** Not in Python: just the readable message text (no thread, no footer), paragraphs separated by a blank line. */
export function cleanMailText(body: string | null | undefined): string {
  return parts(body)[0].join("\n\n");
}

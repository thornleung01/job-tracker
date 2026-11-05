// Python str behaviours the pipeline relies on, where JavaScript's differ. Strings are walked by code point, as Python does.
import { CASEFOLD_EXCEPTIONS, COMBINING_RANGES, TITLECASE_EXCEPTIONS } from "./unicodeTables";

// str.isspace(): the same set Python's \s, split() and strip() use. JS's \s also matches the BOM, which Python's does not.
const SPACE_CLASS = /^[\t-\r\x1c-\x20\x85\xa0\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}]$/u;
const ALNUM = /^[\p{L}\p{N}]$/u;
const LOWER = /^\p{Lowercase}$/u;

/** Number of code points (Python len()). */
export function cpLen(s: string): number {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n--;
        i++;
      }
    }
  }
  return n;
}

/** s[:n] by code points. */
export function cpHead(s: string, n: number): string {
  if (n >= s.length) return s;
  let out = "";
  let count = 0;
  for (const ch of s) {
    if (count++ >= n) break;
    out += ch;
  }
  return out;
}

/** s[0] by code points ("" when empty). */
export function firstChar(s: string): string {
  const cp = s.codePointAt(0);
  return cp === undefined ? "" : String.fromCodePoint(cp);
}

const isSpace = (ch: string): boolean => SPACE_CLASS.test(ch);
const isAlnum = (ch: string): boolean => ALNUM.test(ch);
export const isLower = (ch: string): boolean => LOWER.test(ch);
const isAscii = (ch: string): boolean => ch.charCodeAt(0) < 128;

/** unicodedata.combining(ch) != 0: a binary search of the generated ranges, because JS has no direct equivalent. */
function combining(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x300) return false;
  let lo = 0;
  let hi = COMBINING_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = COMBINING_RANGES[mid];
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}

/** str.strip(chars) / str.strip() when `chars` is omitted (whitespace). */
export function strip(s: string, chars?: string): string {
  const set = chars === undefined ? null : new Set(Array.from(chars));
  const cps = Array.from(s);
  const drop = (ch: string) => (set ? set.has(ch) : isSpace(ch));
  let a = 0;
  let b = cps.length;
  while (a < b && drop(cps[a])) a++;
  while (b > a && drop(cps[b - 1])) b--;
  return cps.slice(a, b).join("");
}

/** str.rstrip(chars), by code point: unlike JS's trimEnd it takes the set of characters to remove. */
export function rstrip(s: string, chars: string): string {
  const set = new Set(Array.from(chars));
  const cps = Array.from(s);
  let b = cps.length;
  while (b > 0 && set.has(cps[b - 1])) b--;
  return cps.slice(0, b).join("");
}

/** str.split() with no arguments: runs of whitespace separate, empties dropped. */
export function splitWords(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of s) {
    if (isSpace(ch)) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** str.partition(sep): [before, sep, after]. */
export function partition(s: string, sep: string): [string, string, string] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, "", ""] : [s.slice(0, i), sep, s.slice(i + sep.length)];
}

/** str.rpartition(sep): splits at the last sep, and a missing sep puts the whole string last (unlike partition). */
export function rpartition(s: string, sep: string): [string, string, string] {
  const i = s.lastIndexOf(sep);
  return i < 0 ? ["", "", s] : [s.slice(0, i), sep, s.slice(i + sep.length)];
}

/** str.casefold(): full case folding. toLowerCase alone misses cases like "\u{df}" (to "ss"), so the exceptions come from a table. */
export function casefold(s: string): string {
  let out = "";
  for (const ch of s) out += CASEFOLD_EXCEPTIONS[ch] ?? ch.toLowerCase();
  return out;
}

/** str.capitalize(): first character titlecased, the rest lowercased. */
export function capitalize(s: string): string {
  const first = firstChar(s);
  if (!first) return "";
  const lowered = s.toLowerCase();
  return (TITLECASE_EXCEPTIONS[first] ?? first.toUpperCase()) + lowered.slice(first.toLowerCase().length);
}

/** urllib.parse.quote(s, safe="/") for str input. */
export function quote(s: string, safe = "/"): string {
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    if (b < 128 && (/[A-Za-z0-9_.\-~]/.test(ch) || safe.includes(ch))) out += ch;
    else out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&#34;" };

/** markupsafe.escape: the five characters it escapes, with its numeric entities for the two quotes. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>'"]/g, (c) => ESCAPES[c]);
}

/** Python's unicodedata.normalize + the ASCII-aware fold used by company/role keys. */
export function fold(value: string): string {
  const out: string[] = [];
  for (const ch of casefold(value).normalize("NFKD")) {
    // Marks are dropped, not kept: this one explicitly after an ASCII letter, any other because a mark is not a letter
    // or digit (so kana with a dakuten fold to the plain kana). Python's own comment says otherwise: PARITY_NOTES 4.
    if (combining(ch) && out.length > 0 && isAscii(out[out.length - 1])) continue;
    if (isAlnum(ch)) out.push(ch);
  }
  return out.join("");
}

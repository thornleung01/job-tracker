// Makes text safe for the PDF's built-in fonts, which can only draw WinAnsi (Windows-1252). Pure.
import type { DocSection } from "../../db/schema";

/** The characters WinAnsi has beyond ASCII and Latin-1: the 0x80 to 0x9F block. */
const WIN_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

export function isWinAnsi(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff) || WIN_EXTRA.has(ch);
}

/** Invisible characters that are dropped without a word: nothing visible is lost. */
const INVISIBLE = /[­​-‏‪-‮⁠﻿]/gu;
/** Spaces and tabs that become an ordinary space. */
const SPACES = /[\t   -   　]/gu;

const CLOSEST: Record<string, string> = {
  "‐": "-", "‑": "-", "‒": "-", "−": "-", "―": "—",
  "′": "'", "″": '"', "⁄": "/", "→": "->", "←": "<-",
  "●": "•", "○": "•", "▪": "•", "■": "•", "◦": "•", "‣": "•", "⁃": "-",
  "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "ı": "i", "ħ": "h",
};

/** Text the standard fonts can draw. `replaced` is true when a visible character had to be swapped for the closest one or a "?". */
export function toWinAnsi(text: string): { text: string; replaced: boolean } {
  let replaced = false;
  const base = text.normalize("NFC").replace(INVISIBLE, "").replace(SPACES, " ").replace(/\r\n?/g, "\n");
  let out = "";
  for (const ch of base) {
    if (ch === "\n" || isWinAnsi(ch)) {
      out += ch;
      continue;
    }
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || (c >= 0x7f && c <= 0xa0)) {
      out += " ";
      continue;
    }
    replaced = true;
    const mapped = CLOSEST[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const folded = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += folded && [...folded].every(isWinAnsi) ? folded : "?";
  }
  return { text: out, replaced };
}

/** The sections with every line, label and heading made WinAnsi-safe, and whether anything visible changed. Ids and kinds are untouched. */
export function sanitiseSections(sections: readonly DocSection[]): { sections: DocSection[]; replacedChars: boolean } {
  let replacedChars = false;
  const fix = (s: string): string => {
    const r = toWinAnsi(s);
    if (r.replaced) replacedChars = true;
    return r.text;
  };
  const out = sections.map((s) => ({
    ...s,
    heading: fix(s.heading),
    items: s.items.map((i) => ({
      ...i,
      text: fix(i.text),
      ...(i.label !== undefined ? { label: fix(i.label) } : {}),
      ...(i.right !== undefined ? { right: fix(i.right) } : {}),
    })),
  }));
  return { sections: out, replacedChars };
}

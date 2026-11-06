// Turns the lines of a resume into sections you can check and edit. Nothing here saves anything.
import { normalizeSections } from "../../db/documentShape";
import type { DocSection } from "../../db/schema";

const SUMMARY = "Summary";
const MAX_HEADING_CHARS = 40;
const MAX_HEADING_WORDS = 6;
/** Bullet glyphs, a dash, and the private-use bullets Word's Symbol font leaves behind. */
const BULLET = /^[•·▪◦●■□○‣⁃–—\-*]\s*/;
/** Words that stay lowercase inside a Title Case heading. */
const SMALL = new Set(["and", "of", "the", "for", "in", "to", "a", "on", "with", "&"]);

const letters = (s: string) => s.replace(/[^\p{L}]/gu, "");

function isAllCaps(line: string): boolean {
  const l = letters(line);
  return l.length >= 2 && l === l.toLocaleUpperCase() && l !== l.toLocaleLowerCase();
}

function isTitleCase(line: string): boolean {
  if (/\d/.test(line) || /[.,;]$/.test(line)) return false;
  const words = line.split(" ");
  if (words.length > MAX_HEADING_WORDS || !/^\p{Lu}/u.test(words[0])) return false;
  return words.every((w) => SMALL.has(w.toLocaleLowerCase()) || /^\p{Lu}/u.test(w));
}

/** The heading's text when the line is one, otherwise null. */
function headingOf(line: string): string | null {
  if (line.length > MAX_HEADING_CHARS) return null;
  if (line.endsWith(":")) return line.slice(0, -1).trim() || null;
  if (line.endsWith(".")) return null;
  return isAllCaps(line) || isTitleCase(line) ? line : null;
}

/**
 * A short line that is all caps, Title Case without a full stop, or ends in a colon is a heading. A line starting with a bullet or a dash is
 * an item (the bullet is dropped), and so is any other line. Lines before the first heading go under "Summary".
 */
export function splitSections(text: string): DocSection[] {
  const sections: { heading: string; items: { text: string }[] }[] = [];
  const before: { text: string }[] = [];
  let current: { heading: string; items: { text: string }[] } | null = null;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const bullet = BULLET.test(line);
    const heading = bullet ? null : headingOf(line);
    if (heading) {
      current = { heading, items: [] };
      sections.push(current);
      continue;
    }
    const item = { text: bullet ? line.replace(BULLET, "").trim() : line };
    if (!item.text) continue;
    (current ? current.items : before).push(item);
  }
  if (before.length) sections.unshift({ heading: SUMMARY, items: before });
  return normalizeSections(sections);
}

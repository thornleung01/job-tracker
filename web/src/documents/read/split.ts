// Turns the lines of a resume into sections you can check and edit. Nothing here saves anything.
import { normalizeSections } from "../../db/documentShape";
import type { DocSection } from "../../db/schema";

const SUMMARY = "Summary";
const HEADER = "Header";
const MAX_HEADING_CHARS = 40;
const MAX_HEADING_WORDS = 6;
/** Bullet glyphs, a dash, and the private-use bullets Word's Symbol font leaves behind. */
const BULLET = /^[•·▪◦●■□○‣⁃–—\-*]\s*/;
/** Words that stay lowercase inside a Title Case line. */
const SMALL = new Set(["and", "of", "the", "for", "in", "to", "a", "on", "with", "&"]);
/**
 * The section names a resume uses ("Work Experience", "Skills and Qualifications"). A Title Case line is only a heading when it is one of
 * these: otherwise a company, a job title or a school ("Associate, Data and Analytics") would each become a section of its own.
 */
const KNOWN_HEADING = new RegExp(
  "^(?:(?:professional|work|relevant|technical|core|key|additional|selected|volunteer)\\s+)?" +
    "(?:summary|objective|profile|experience|employment(?: history)?|skills(?: and (?:qualifications|abilities|expertise))?|qualifications|" +
    "education(?: and training)?|certifications?|certificates|licen[sc]es|projects|awards(?: and honou?rs)?|honou?rs|publications|" +
    "volunteering|languages|interests|references|achievements|accomplishments|activities|leadership|training|courses|information|history)$",
);
/** A name: up to five words of letters, with no digits, "@" or "|". */
const NAME = /^\p{L}[\p{L}'’.-]*(?: \p{L}[\p{L}'’.-]*){0,4}$/u;
/** A line of contact details: an email address, a "|" between details, a phone number or a LinkedIn link. */
const CONTACT = /@|\||linkedin|\+?\d[\d\s().-]{6,}\d/i;

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
  if (isAllCaps(line)) return line;
  return isTitleCase(line) && KNOWN_HEADING.test(line.toLocaleLowerCase().replace(/&/g, "and")) ? line : null;
}

/** A job or school line (dates, "Present", or a short Title Case line): it starts something new, even right after a bullet that has no full stop. */
const startsAnEntry = (line: string) => /\b(?:19|20)\d{2}\b|\b(?:Present|Current)\b/i.test(line) || isTitleCase(line);

/**
 * A line that carries on the one before it. A PDF keeps a long bullet's line breaks, so the rest of it arrives as lines of its own: one that
 * starts in lowercase, or (after a bullet that stopped without a full stop) one that doesn't start an entry.
 */
function continues(previous: { text: string; bullet: boolean } | undefined, line: string): boolean {
  if (!previous) return false;
  if (/^\p{Ll}/u.test(line)) return true;
  return previous.bullet && !/[.!?:;)]$/.test(previous.text) && !startsAnEntry(line);
}

interface Draft {
  heading: string;
  items: { text: string; bullet: boolean }[];
}

/**
 * A short line that is all caps, ends in a colon, or is a known section name ("Work Experience") is a heading. A line starting with a bullet
 * or a dash is an item (the bullet is dropped), and so is any other line, except that a line which carries on the one before it is joined
 * to it. A name followed by a line of contact details at the very top is the "Header". Other lines before the first heading go under "Summary".
 */
export function splitSections(text: string): DocSection[] {
  const sections: Draft[] = [];
  const before: Draft["items"] = [];
  let current: Draft | null = null;
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const header: Draft["items"] = [];
  if (lines.length > 1 && NAME.test(lines[0]) && CONTACT.test(lines[1])) {
    header.push({ text: lines[0], bullet: false }, { text: lines[1], bullet: false });
    lines.splice(0, 2);
  }
  for (const line of lines) {
    const bullet = BULLET.test(line);
    const heading = bullet ? null : headingOf(line);
    if (heading) {
      current = { heading, items: [] };
      sections.push(current);
      continue;
    }
    const items = current ? current.items : before;
    const body = bullet ? line.replace(BULLET, "").trim() : line;
    if (!body) continue;
    const last = items[items.length - 1];
    if (!bullet && continues(last, body)) last.text = `${last.text} ${body}`;
    else items.push({ text: body, bullet });
  }
  const all = [
    ...(header.length ? [{ heading: HEADER, items: header }] : []),
    ...(before.length ? [{ heading: SUMMARY, items: before }] : []),
    ...sections,
  ];
  return normalizeSections(all.map((s) => ({ heading: s.heading, items: s.items.map((i) => ({ text: i.text })) })));
}

// Turns the lines of a resume into sections you can check and edit. Nothing here saves anything.
import { normalizeSections } from "../../db/documentShape";
import { MAX_DOC_LABEL_CHARS } from "../../db/limits";
import type { DocItemKind, DocSection } from "../../db/schema";

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
  const gap = splitGap(line);
  if (gap && (isDateRange(gap[1]) || isLocation(gap[1]))) return false; // a right-aligned date or location is an entry's own line
  const flat = flatten(line);
  if (/^\p{Ll}/u.test(flat)) return true;
  return previous.bullet && !/[.!?:;)]$/.test(flatten(previous.text)) && !startsAnEntry(flat);
}

// Gaps: a "\t" marks where text was right-aligned. The PDF reader puts one where it saw a wide gap, and 3 or more spaces count too.

/** One line with its whitespace squeezed to single spaces, except that a gap (a tab, or 3 or more spaces) stays as one tab. */
export function squeezeLine(line: string): string {
  return line
    .replace(/[  ]{3,}/g, "\t")
    .split("\t")
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\t");
}
/** The line with each gap turned back into a space. */
const flatten = (line: string) => line.replace(/\t+/g, " ").trim();
/** The text left of the last gap and the text right of it, or null when the line has no gap or nothing on a side. */
function splitGap(line: string): [string, string] | null {
  const at = line.lastIndexOf("\t");
  if (at < 0) return null;
  const left = flatten(line.slice(0, at));
  const right = line.slice(at + 1).trim();
  return left && right ? [left, right] : null;
}

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?";
const DATE = `(?:${MONTH}\\s+)?(?:19|20)\\d{2}`;
const RANGE = `${DATE}\\s*(?:–|—|-|to)\\s*(?:${DATE}|Present|Current|Now)`;
const DATE_ONLY = new RegExp(`^(?:${RANGE}|${DATE})$`, "i");
const TRAILING_RANGE = new RegExp(`^(.*?\\S)\\s+(${RANGE})$`, "i");
const isDateRange = (s: string) => DATE_ONLY.test(s);

/** Canadian provinces and territories and US states, as the two-letter codes a location ends in. */
const REGION_CODES = new Set(
  "AB BC MB NB NL NS NT NU ON PE QC SK YT AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "),
);
const CITY_WORD = "\\p{Lu}[\\p{L}.'’-]*";
const LOCATION = new RegExp(`^(?:Remote|${CITY_WORD}(?: ${CITY_WORD}){0,3}, ([A-Z]{2}))$`, "u");
function isLocation(s: string): boolean {
  const m = LOCATION.exec(s);
  return !!m && (!m[1] || REGION_CODES.has(m[1]));
}
/** Words that start a two-word city name ("New York", "San Francisco"), so the city isn't cut in half. */
const CITY_PREFIX = new Set(["New", "San", "Los", "Las", "St.", "Saint", "Fort", "Mount", "Port", "North", "South", "East", "West", "Salt", "Sault", "Palo", "Santa"]);
/** "Northwind Traders Toronto, ON" as ["Northwind Traders", "Toronto, ON"], or null. */
function trailingLocation(line: string): [string, string] | null {
  const m = /^(.*?)\s*,\s*([A-Z]{2})$/.exec(line);
  if (!m || !REGION_CODES.has(m[2])) return null;
  const words = m[1].split(" ");
  const isCap = (w: string) => /^\p{Lu}/u.test(w);
  if (words.length < 2 || !isCap(words[words.length - 1])) return null;
  const take = words.length > 2 && isCap(words[words.length - 2]) && CITY_PREFIX.has(words[words.length - 2]) ? 2 : 1;
  const left = words.slice(0, words.length - take).join(" ");
  return left ? [left, `${words.slice(-take).join(" ")}, ${m[2]}`] : null;
}

// Which kind of section a heading is, and what a line becomes in it.

type Area = "work" | "education" | "skills" | "other";
function areaOf(heading: string): Area {
  const h = heading.toLocaleLowerCase();
  if (/skills|qualifications|technologies|tools|languages/.test(h)) return "skills";
  if (/education|school|training|courses|certifications?/.test(h)) return "education";
  if (/experience|employment|work|history|volunteer|projects/.test(h)) return "work";
  return "other";
}

const MAX_LABEL_WORDS = 6;
const MAX_LEFT_WORDS = 10;
const TITLE_WORDS = /\b(?:Analyst|Manager|Associate|Planner|Engineer|Director|Lead|Coordinator|Specialist|Consultant|Intern|Developer|Scientist|Officer|Assistant|Representative|Supervisor)s?\b/;
const COMPANY_SUFFIX = /,\s*(?:Inc|Ltd|LLC|Corp|Co|Limited|Incorporated)\.?$/i;
/** Words a sentence trails off with before a date, so "Worked at Acme from 2019 - 2022" is not taken for a job title line. */
const DANGLING = /\b(?:from|in|since|during|between|until|through|and|of|at)$/i;
/** Words that can follow a skill's first word as part of its label ("Programming Languages", "Data Visualization"). */
const LABEL_MORE = new Set(["languages", "tools", "skills", "analysis", "analytics", "technologies", "platforms", "frameworks", "databases", "libraries", "software", "management", "development", "visualization", "reporting", "systems", "methods", "and"]);

interface Parsed {
  text: string;
  kind?: DocItemKind;
  label?: string;
  right?: string;
}

/** "Label: rest" with the label at most 6 words and 60 characters and text after the colon, or null. */
function labelled(body: string): { label: string; text: string } | null {
  const m = /^([^:]+?)\s*:\s+(\S.*)$/.exec(body);
  if (!m) return null;
  const label = m[1].trim();
  if (!label || label.length > MAX_DOC_LABEL_CHARS || label.split(" ").length > MAX_LABEL_WORDS) return null;
  return { label, text: m[2].trim() };
}

/** A skills line as { label, text }, or null when it isn't clearly "Label values". */
function skillOf(line: string): { label: string; text: string } | null {
  const gap = splitGap(line);
  if (gap) return { label: gap[0], text: gap[1] };
  const flat = flatten(line);
  const colon = labelled(flat);
  if (colon) return colon;
  const words = flat.split(" ");
  const isLabelWord = (w: string) => /^\p{Lu}[\p{L}/&-]*$/u.test(w);
  if (!isLabelWord(words[0])) return null;
  let n = 1;
  while (n < 3 && n < words.length - 1 && isLabelWord(words[n]) && LABEL_MORE.has(words[n].toLocaleLowerCase())) n++;
  const label = words.slice(0, n).join(" ");
  const text = words.slice(n).join(" ");
  if (!/[,·|;]/.test(text) || !/^[\p{Lu}\d]/u.test(text) || label.length >= text.length) return null;
  return { label, text };
}

/** One line of a section as the kind of line it clearly is, or as plain text when no rule clearly matches. */
function parseLine(item: { text: string; bullet: boolean }, area: Area, previous: Parsed | undefined): Parsed {
  if (item.bullet) {
    const body = flatten(item.text);
    const l = labelled(body);
    return l ? { kind: "bullet", label: l.label, text: l.text } : { kind: "bullet", text: body };
  }
  const plain: Parsed = { text: flatten(item.text) };
  if (area === "skills") {
    const skill = skillOf(item.text);
    return skill ? { kind: "skill", ...skill } : plain;
  }
  if (area !== "work" && area !== "education") return plain;
  const orgKind = area === "work" ? "org" : "school";
  const gap = splitGap(item.text);
  if (gap) {
    const [left, right] = gap;
    if (isLocation(right)) return { kind: orgKind, text: left, right };
    if (area === "work" && isDateRange(right)) return { kind: "title", text: left, right };
    return plain;
  }
  const flat = plain.text;
  const loc = trailingLocation(flat);
  if (loc && loc[0].split(" ").length <= MAX_LEFT_WORDS) return { kind: orgKind, text: loc[0], right: loc[1] };
  if (area !== "work") return plain;
  const dated = TRAILING_RANGE.exec(flat);
  const datedLeft = dated?.[1].replace(/[\s,|]+$/, "");
  if (dated && datedLeft && datedLeft.split(" ").length <= MAX_LEFT_WORDS && !DANGLING.test(datedLeft)) return { kind: "title", text: datedLeft, right: dated[2] };
  const afterEntry = previous?.kind === "org" || previous?.kind === "bullet";
  const looksLikeTitle = flat.includes(",") ? !COMPANY_SUFFIX.test(flat) : TITLE_WORDS.test(flat);
  if (afterEntry && isTitleCase(flat) && looksLikeTitle) return { kind: "title", text: flat };
  return plain;
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
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map(squeezeLine).filter(Boolean);
  const header: string[] = [];
  if (lines.length > 1 && NAME.test(flatten(lines[0])) && CONTACT.test(flatten(lines[1]))) {
    header.push(flatten(lines[0]), flatten(lines[1]));
    lines.splice(0, 2);
  }
  for (const line of lines) {
    const bullet = BULLET.test(line);
    const gap = splitGap(line);
    const entryGap = !!gap && (isDateRange(gap[1]) || isLocation(gap[1]));
    const heading = bullet || entryGap ? null : headingOf(flatten(line));
    if (heading) {
      current = { heading, items: [] };
      sections.push(current);
      continue;
    }
    const items = current ? current.items : before;
    const body = bullet ? line.replace(BULLET, "").trim() : line;
    if (!flatten(body)) continue;
    const last = items[items.length - 1];
    if (!bullet && continues(last, body)) last.text = `${last.text} ${flatten(body)}`;
    else items.push({ text: body, bullet });
  }
  const kinded = (heading: string, drafts: Draft["items"]) => {
    const area = areaOf(heading);
    const out: Parsed[] = [];
    for (const draft of drafts) out.push(parseLine(draft, area, out[out.length - 1]));
    return { heading, items: out };
  };
  return normalizeSections([
    ...(header.length ? [{ heading: HEADER, items: header.map((text) => ({ text })) }] : []),
    ...(before.length ? [kinded(SUMMARY, before)] : []),
    ...sections.map((s) => kinded(s.heading, s.items)),
  ]);
}

// Turns the lines of a resume into sections you can check and edit. Nothing here saves anything.
import { HEADER_HEADING, normalizeSections } from "../../db/documentShape";
import { MAX_DOC_ITEM_CHARS, MAX_DOC_LABEL_CHARS } from "../../db/limits";
import type { DocItemKind, DocSection } from "../../db/schema";
import { MAX_FILE_BYTES } from "./errors";

const SUMMARY = "Summary";
const MAX_HEADING_CHARS = 40;
const MAX_HEADING_WORDS = 6;
/**
 * How much of a text is read: the same bound as a file (5 MB), counted in characters, so pasted text can't be bigger than a file. Past that
 * the text is ignored. Lines are bounded too: 20,000 of them, and each one cut at MAX_LINE_CHARS, because an item is cut at
 * MAX_DOC_ITEM_CHARS anyway and a hostile text mustn't be able to make the line rules slow. The rest is dropped without a message.
 */
const MAX_TEXT_CHARS = MAX_FILE_BYTES;
const MAX_LINES = 20_000;
const MAX_LINE_CHARS = MAX_DOC_ITEM_CHARS * 4;
/** Bullet glyphs, a dash, and the private-use bullets Word's Symbol font leaves behind. */
const BULLET = /^[•·▪◦●■□○‣⁃–—\-*\uF0B7\uF0A7\uF0D8]\s*/;
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

/** A line of the text with its own bullet flag (the bullet glyph itself is already dropped). */
interface RawLine {
  text: string;
  bullet: boolean;
}

const lettersOnly = (s: string) => s.replace(/[^\p{L}]/gu, "");
const startsUppercase = (word: string) => /^\p{Lu}/u.test(word);

function isAllCaps(line: string): boolean {
  const letters = lettersOnly(line);
  return letters.length >= 2 && letters === letters.toLocaleUpperCase() && letters !== letters.toLocaleLowerCase();
}

function isTitleCase(line: string): boolean {
  if (/\d/.test(line) || /[.,;]$/.test(line)) return false;
  const words = line.split(" ");
  if (words.length > MAX_HEADING_WORDS || !startsUppercase(words[0])) return false;
  return words.every((w) => SMALL.has(w.toLocaleLowerCase()) || startsUppercase(w));
}

/** The heading's text when the line is one, otherwise null. */
function headingOf(line: string): string | null {
  if (line.length > MAX_HEADING_CHARS) return null;
  if (line.endsWith(":")) return line.slice(0, -1).trim() || null;
  if (line.endsWith(".")) return null;
  if (isAllCaps(line)) return line;
  return isTitleCase(line) && KNOWN_HEADING.test(line.toLocaleLowerCase().replace(/&/g, "and")) ? line : null;
}

/**
 * A job or school line (dates, "Present", or a short Title Case line): it starts something new, even right after a bullet that has no full stop.
 * Known limit: any four-digit year counts, so a sentence that mentions one ("Moved to Toronto in 2019 to join the team") can start an entry.
 */
const startsAnEntry = (line: string) => /\b(?:19|20)\d{2}\b|\b(?:Present|Current)\b/i.test(line) || isTitleCase(line);

/** True when the text ends in a full stop or other closing mark, looking past trailing whitespace (a gap is a tab). Reads only the end of the text. */
function endsSentence(text: string): boolean {
  let at = text.length - 1;
  while (at >= 0 && /\s/.test(text[at])) at--;
  return at >= 0 && ".!?:;)".includes(text[at]);
}

/**
 * A line that carries on the one before it. A PDF keeps a long bullet's line breaks, so the rest of it arrives as lines of its own: one that
 * starts in lowercase, or (after a bullet that stopped without a full stop) one that doesn't start an entry. An item that already has as much
 * text as an item can keep takes no more: the rest would be cut anyway, and joining onto it again and again is what makes a long text slow.
 */
function continues(previous: RawLine | undefined, line: string): boolean {
  if (!previous || previous.text.length >= MAX_DOC_ITEM_CHARS) return false;
  if (isEntryGap(splitGap(line))) return false; // a right-aligned date or location is an entry's own line
  const flat = flatten(line);
  if (/^\p{Ll}/u.test(flat)) return true;
  return previous.bullet && !endsSentence(previous.text) && !startsAnEntry(flat);
}

// Gaps: a "\t" marks where text was right-aligned. The PDF reader puts one where it saw a wide gap, and 3 or more spaces count too.

/** One line with its whitespace squeezed to single spaces, except that a gap (a tab, or 3 or more spaces, or non-breaking spaces) stays as one tab. */
export function squeezeLine(line: string): string {
  return line
    .replace(/[\u00A0 ]{3,}/g, "\t")
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
/** True when the right side of a gap is dates or a location: the line is then an entry's own line, never a heading or a wrapped sentence. */
const isEntryGap = (gap: [string, string] | null) => !!gap && (isDateRange(gap[1]) || isLocation(gap[1]));

/** A month name or its short form, with an optional full stop: "Jan", "Sept.", "March". */
const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?";
/** A year from 1900 to 2099, with a month before it when there is one: "2019", "Jan 2019". */
const DATE = `(?:${MONTH}\\s+)?(?:19|20)\\d{2}`;
/** Two dates joined by a dash or "to", the second possibly "Present", "Current" or "Now": "Jan 2019 – Present", "2019-2021", "2019 to Now". */
const RANGE = `${DATE}\\s*(?:–|—|-|to)\\s*(?:${DATE}|Present|Current|Now)`;
/** A whole string that is one date or one range: the right side of a gap. */
const DATE_ONLY = new RegExp(`^(?:${RANGE}|${DATE})$`, "i");
/** A line that ends in a range: group 1 is the text before it, group 2 the range ("Senior Analyst Aug 2024 – Present"). */
const TRAILING_RANGE = new RegExp(`^(.*?\\S)\\s+(${RANGE})$`, "i");
const isDateRange = (s: string) => DATE_ONLY.test(s);

/**
 * Canadian provinces and territories and US states, as the two-letter codes a location ends in. Several codes are also English words or
 * common abbreviations (ON, IN, OR, ME, OK, CA), so a code alone proves little: the rules that use it also need a capitalized city before it.
 */
const REGION_CODES = new Set(
  "AB BC MB NB NL NS NT NU ON PE QC SK YT AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "),
);
/**
 * The full names of the provinces, territories and states, in lowercase (a name is matched whatever its case). A name is much less ambiguous
 * than a code, but "Washington", "Georgia", "Indiana", "Virginia" and "Jersey" are also words, so a name only counts after a comma
 * ("Atlanta, Georgia"), never bare.
 */
const REGION_NAMES = new Set(
  [
    "Ontario", "Quebec", "Québec", "British Columbia", "Alberta", "Manitoba", "Saskatchewan", "Nova Scotia", "New Brunswick", "Newfoundland and Labrador",
    "Prince Edward Island", "Yukon", "Northwest Territories", "Nunavut",
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois",
    "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri",
    "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma",
    "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
    "West Virginia", "Wisconsin", "Wyoming", "District of Columbia",
  ].map((name) => name.toLocaleLowerCase()),
);
/** What follows the comma of a location: one to four words of letters. It only counts when it is a code (as written, in capitals) or a full name. */
const REGION = "\\p{L}+(?: \\p{L}+){0,3}";
const isRegion = (s: string) => REGION_CODES.has(s) || REGION_NAMES.has(s.toLocaleLowerCase());
/** One capitalized word of a city name: "Toronto", "St.", "Saint-Laurent". */
const CITY_WORD = "\\p{Lu}[\\p{L}.'’-]*";
/** A whole location: "Remote", or a city of up to four capitalized words, a comma and a region ("Toronto, ON", "Salt Lake City, UT", "Toronto, Ontario"). */
const LOCATION = new RegExp(`^(?:Remote|${CITY_WORD}(?: ${CITY_WORD}){0,3}, (${REGION}))$`, "u");
function isLocation(s: string): boolean {
  const match = LOCATION.exec(s);
  return !!match && (!match[1] || isRegion(match[1]));
}
/** Words that start a two-word city name ("New York", "San Francisco"), so the city isn't cut in half. */
const CITY_PREFIX = new Set(["New", "San", "Los", "Las", "St.", "Saint", "Fort", "Mount", "Port", "North", "South", "East", "West", "Salt", "Sault", "Palo", "Santa"]);
/** A line that ends in a comma and a region: group 1 is the text before the comma, group 2 the region. */
const TRAILING_REGION = new RegExp(`^(.*?)\\s*,\\s*(${REGION})$`, "u");
/**
 * "Northwind Traders Toronto, ON" (or "Toronto, Ontario") as ["Northwind Traders", "Toronto, ON"], or null. With no gap to say where the city starts, the city is the
 * last word before the code, or the last two when the first of them is a CITY_PREFIX word. That is a guess with a known limit: a city of
 * three or more words ("Acme Salt Lake City, UT") is cut in the wrong place (org "Acme Salt Lake", city "City, UT"). With a gap
 * ("Acme<tab>Salt Lake City, UT") the city is exact.
 */
function trailingLocation(line: string): [string, string] | null {
  const match = TRAILING_REGION.exec(line);
  if (!match || !isRegion(match[2])) return null;
  const words = match[1].split(" ");
  if (words.length < 2 || !startsUppercase(words[words.length - 1])) return null;
  const prefix = words[words.length - 2];
  const cityWordCount = words.length > 2 && startsUppercase(prefix) && CITY_PREFIX.has(prefix) ? 2 : 1;
  // "Northwind Traders, Toronto, ON": the comma after the company belongs to neither side
  const left = words.slice(0, words.length - cityWordCount).join(" ").replace(/[\s,]+$/, "");
  return left ? [left, `${words.slice(-cityWordCount).join(" ")}, ${match[2]}`] : null;
}

// Which kind of section a heading is, and what a line becomes in it.

type Area = "work" | "education" | "skills" | "other";
/**
 * The area of a heading, by whole words (so "Teamwork" and "Network" aren't "work"). The order matters: a heading that fits two areas takes
 * the first, so "Skills and Work Experience" and "Languages" are skills, and "Training" is education. Anything else (Awards, Interests,
 * Publications, a summary) is "other": its lines stay plain, except bullets.
 */
function areaOf(heading: string): Area {
  const h = heading.toLocaleLowerCase();
  if (/\b(?:skills|qualifications|technologies|tools|languages)\b/.test(h)) return "skills";
  if (/\b(?:education|school|training|courses|certifications?)\b/.test(h)) return "education";
  if (/\b(?:experiences?|employment|work|history|volunteer(?:ing)?|projects?)\b/.test(h)) return "work";
  return "other";
}

/** A skill's label is at most this many words (it is also cut at MAX_DOC_LABEL_CHARS). */
const MAX_LABEL_WORDS = 6;
/** The text left of a location or date range is at most this many words, or the line is more likely a sentence than a company or a job title. */
const MAX_LEFT_WORDS = 10;
/**
 * Words that make a short Title Case line look like a job title. An English list skewed to analyst and engineering roles, so a title outside it
 * ("Pastry Chef", "Teacher") is only caught when it ends in a date range.
 */
const TITLE_WORDS = /\b(?:Analyst|Manager|Associate|Planner|Engineer|Director|Lead|Coordinator|Specialist|Consultant|Intern|Developer|Scientist|Officer|Assistant|Representative|Supervisor)s?\b/;
/** A company name ending in a legal suffix ("Acme Corp, Inc"), which is not a job title even after a comma. */
const COMPANY_SUFFIX = /,\s*(?:Inc|Ltd|LLC|Corp|Co|Limited|Incorporated)\.?$/i;
/** Words a sentence trails off with before a date, so "Worked at Acme from 2019 - 2022" is not taken for a job title line. */
const DANGLING = /\b(?:from|in|since|during|between|until|through|and|of|at)$/i;
/** Words that can follow a skill's first word as part of its label ("Programming Languages", "Data Visualization"). */
const LABEL_MORE = new Set(["languages", "tools", "skills", "analysis", "analytics", "technologies", "platforms", "frameworks", "databases", "libraries", "software", "management", "development", "visualization", "reporting", "systems", "methods", "and"]);
/**
 * First words a skills line may start with when nothing but a space separates the label from the values ("Analytics Excel, Tableau"). A short
 * English list: without it any list of capitalized names ("Tableau Excel, Power BI") would lose its first word to a label. A label with a
 * colon or a gap is trusted whatever it says, and so is a first word with a slash ("Programming/Database").
 */
const LABEL_FIRST_WORDS = new Set(["programming", "analytics", "technologies", "technical", "tools", "languages", "frameworks", "databases", "database", "platforms", "software", "methods", "methodologies", "cloud", "data", "systems", "certifications", "soft", "core", "other"]);

interface Parsed {
  text: string;
  kind?: DocItemKind;
  label?: string;
  right?: string;
}

/** "Label: rest" with a short label and text after the colon, or null. */
function labelled(body: string): { label: string; text: string } | null {
  const match = /^([^:]+?)\s*:\s+(\S.*)$/.exec(body);
  if (!match) return null;
  const label = match[1].trim();
  if (!label || label.length > MAX_DOC_LABEL_CHARS || label.split(" ").length > MAX_LABEL_WORDS) return null;
  return { label, text: match[2].trim() };
}

const isLabelWord = (w: string) => /^\p{Lu}[\p{L}/&-]*$/u.test(w);

/**
 * A label and its values split by nothing but a space, or null. "Programming Languages SQL, Python" gives label "Programming Languages":
 * the first word must be a known label word (or have a slash), up to two more may follow from LABEL_MORE, and what is left must look like
 * a list that starts with a capital or a digit and is longer than the label.
 */
function leadingLabelOf(flat: string): { label: string; text: string } | null {
  const words = flat.split(" ");
  const first = words[0];
  if (!isLabelWord(first) || !(LABEL_FIRST_WORDS.has(first.toLocaleLowerCase()) || first.includes("/"))) return null;
  let count = 1;
  while (count < 3 && count < words.length - 1 && isLabelWord(words[count]) && LABEL_MORE.has(words[count].toLocaleLowerCase())) count++;
  const label = words.slice(0, count).join(" ");
  const text = words.slice(count).join(" ");
  if (!/[,·|;]/.test(text) || !/^[\p{Lu}\d]/u.test(text) || label.length >= text.length) return null;
  return { label, text };
}

/** A skills line as { label, text }, or null when it isn't clearly "Label values". */
function skillOf(line: string): { label: string; text: string } | null {
  const gap = splitGap(line);
  if (gap) return { label: gap[0], text: gap[1] };
  const flat = flatten(line);
  return labelled(flat) ?? leadingLabelOf(flat);
}

/** A bullet's line, with its label cut off at the first colon when there is a short one. */
function bulletLineOf(text: string): Parsed {
  const body = flatten(text);
  const withLabel = labelled(body);
  return withLabel ? { kind: "bullet", label: withLabel.label, text: withLabel.text } : { kind: "bullet", text: body };
}

/** The kind of the line that names an employer, or a school in an education section. */
const orgKindOf = (area: "work" | "education"): DocItemKind => (area === "work" ? "org" : "school");

/** A line with a gap: a location on the right makes it an org or school line, and dates on the right make it a title (work only). */
function gapLineOf([left, right]: [string, string], area: "work" | "education"): Parsed | null {
  if (isLocation(right)) return { kind: orgKindOf(area), text: left, right };
  if (area === "work" && isDateRange(right)) return { kind: "title", text: left, right };
  return null;
}

/** A line with no gap that ends in a city and region code: the org or school, and the location on the right. */
function orgLineOf(flat: string, area: "work" | "education"): Parsed | null {
  const loc = trailingLocation(flat);
  if (!loc || loc[0].split(" ").length > MAX_LEFT_WORDS) return null;
  const [org, place] = loc;
  return { kind: orgKindOf(area), text: org, right: place };
}

/**
 * A job title with no gap: either text that ends in a date range, or a short Title Case line with a title word right after an org or a bullet.
 * A dated line must end its left part in a capitalized word, a digit or "&" (job titles do), so a sentence that happens to end in dates
 * ("Led the Q3 migration, finished Mar 2021 – Jun 2021") stays plain.
 */
function titleLineOf(flat: string, previous: Parsed | undefined): Parsed | null {
  const dated = TRAILING_RANGE.exec(flat);
  const datedLeft = dated?.[1].replace(/[\s,|]+$/, "");
  if (dated && datedLeft && datedLeft.split(" ").length <= MAX_LEFT_WORDS && !DANGLING.test(datedLeft)) {
    const lastWord = datedLeft.slice(datedLeft.lastIndexOf(" ") + 1);
    if (/^[\p{Lu}\d&]/u.test(lastWord)) return { kind: "title", text: datedLeft, right: dated[2] };
  }
  const afterEntry = previous?.kind === "org" || previous?.kind === "bullet";
  // a title word, and not a company name that ends in "Inc" or "Ltd"
  const looksLikeTitle = TITLE_WORDS.test(flat) && !COMPANY_SUFFIX.test(flat);
  return afterEntry && isTitleCase(flat) && looksLikeTitle ? { kind: "title", text: flat } : null;
}

/** An org, school or title line in a work or education section, or null when no rule clearly matches. */
function entryLineOf(text: string, area: "work" | "education", previous: Parsed | undefined): Parsed | null {
  const gap = splitGap(text);
  if (gap) return gapLineOf(gap, area);
  const flat = flatten(text);
  return orgLineOf(flat, area) ?? (area === "work" ? titleLineOf(flat, previous) : null);
}

/** One line of a section as the kind of line it clearly is, or as plain text when no rule clearly matches. */
function parseLine(item: RawLine, area: Area, previous: Parsed | undefined): Parsed {
  if (item.bullet) return bulletLineOf(item.text);
  const plain: Parsed = { text: flatten(item.text) };
  if (area === "skills") {
    const skill = skillOf(item.text);
    return skill ? { kind: "skill", ...skill } : plain;
  }
  if (area === "work" || area === "education") return entryLineOf(item.text, area, previous) ?? plain;
  return plain;
}

interface Draft {
  heading: string;
  items: RawLine[];
}

/** The first two lines are a name and a line of contact details: the Header. */
const isHeaderPair = (first: string, second: string) => NAME.test(flatten(first)) && CONTACT.test(flatten(second));

/** The first MAX_LINES lines that have something in them, each squeezed. Stops reading as soon as it has them. */
function readLines(text: string): string[] {
  const clean = text.slice(0, MAX_TEXT_CHARS).replace(/\r\n?/g, "\n");
  const lines: string[] = [];
  let start = 0;
  while (start <= clean.length && lines.length < MAX_LINES) {
    const end = clean.indexOf("\n", start);
    const stop = end < 0 ? clean.length : end;
    const line = squeezeLine(clean.slice(start, Math.min(stop, start + MAX_LINE_CHARS)));
    if (line) lines.push(line);
    start = stop + 1;
  }
  return lines;
}

/**
 * A short line that is all caps, ends in a colon, or is a known section name ("Work Experience") is a heading. A line starting with a bullet
 * or a dash is an item (the bullet is dropped), and so is any other line, except that a line which carries on the one before it is joined
 * to it. A name followed by a line of contact details at the very top is the "Header". Other lines before the first heading go under "Summary".
 */
export function splitSections(text: string): DocSection[] {
  const sections: Draft[] = [];
  const beforeFirstHeading: RawLine[] = [];
  let current: Draft | null = null;
  const lines = readLines(text);
  const header: string[] = [];
  if (lines.length > 1 && isHeaderPair(lines[0], lines[1])) {
    header.push(flatten(lines[0]), flatten(lines[1]));
    lines.splice(0, 2);
  }
  for (const line of lines) {
    const bullet = BULLET.test(line);
    const heading = bullet || isEntryGap(splitGap(line)) ? null : headingOf(flatten(line));
    if (heading) {
      current = { heading, items: [] };
      sections.push(current);
      continue;
    }
    const items = current ? current.items : beforeFirstHeading;
    const body = bullet ? line.replace(BULLET, "").trim() : line;
    if (!flatten(body)) continue;
    const last = items[items.length - 1];
    if (!bullet && continues(last, body)) last.text = `${last.text} ${flatten(body)}`;
    else items.push({ text: body, bullet });
  }
  const withKinds = (heading: string, drafts: RawLine[]) => {
    const area = areaOf(heading);
    const out: Parsed[] = [];
    for (const draft of drafts) out.push(parseLine(draft, area, out[out.length - 1]));
    return { heading, items: out };
  };
  return normalizeSections([
    ...(header.length ? [{ heading: HEADER_HEADING, items: header.map((text) => ({ text })) }] : []),
    ...(beforeFirstHeading.length ? [withKinds(SUMMARY, beforeFirstHeading)] : []),
    ...sections.map((s) => withKinds(s.heading, s.items)),
  ]);
}

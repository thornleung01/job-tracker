// Checks what the model sent back. Pure. The reply is untrusted: its shape is validated, its ids are ignored, and every line is compared
// with the source text so a person can see anything that wasn't in their file before they save it.
import { HEADER_HEADING, newItemId, normalizeSections } from "../db/documentShape";
import { isRecord } from "../db/isRecord";
import type { DocItem, DocSection } from "../db/schema";
import { AiError } from "./errors";
import { CONVERT_KINDS, type ConvertKind } from "./prompts";

/** A line the person should look at before saving: `detail` is a number, date or name that isn't in the source text, `label` a made-up bullet label. */
export interface ConvertFlag {
  itemId: string;
  kind: "detail" | "label";
  note: string;
}

/** What the model sends: one item of a section. */
export interface ConvertReplyItem {
  kind: ConvertKind;
  text: string;
  label: string;
  right: string;
}
export interface ConvertReply {
  header: { name: string; contact: string[] };
  sections: { heading: string; items: ConvertReplyItem[] }[];
}

/** A missing string is "", anything else that isn't a string is a bad reply. */
function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  throw new AiError("badReply");
}

/**
 * The header is read leniently on purpose: a contact entry that isn't a string is dropped (a stray number in the list shouldn't lose the
 * whole resume). The rest of the reply is strict: a `text`, `label` or `right` that isn't a string would change the content, so it is a bad reply.
 */
function parseHeader(rawHeader: unknown): ConvertReply["header"] {
  if (rawHeader !== undefined && !isRecord(rawHeader)) throw new AiError("badReply");
  const contact = isRecord(rawHeader) ? rawHeader.contact : undefined;
  if (contact !== undefined && !Array.isArray(contact)) throw new AiError("badReply");
  return {
    name: isRecord(rawHeader) ? str(rawHeader.name).trim() : "",
    contact: (contact ?? []).filter((c): c is string => typeof c === "string").map((c) => c.trim()).filter(Boolean),
  };
}

/** Validates the model's JSON. Extra properties are ignored, missing strings are "", an unknown kind becomes a plain line. */
export function parseConvertReply(json: unknown): ConvertReply {
  if (!isRecord(json)) throw new AiError("badReply");
  const header = parseHeader(json.header);
  if (!Array.isArray(json.sections)) throw new AiError("badReply");
  const sections = json.sections.map((s) => {
    if (!isRecord(s) || !Array.isArray(s.items)) throw new AiError("badReply");
    const items = s.items.map((i): ConvertReplyItem => {
      if (!isRecord(i)) throw new AiError("badReply");
      const kind = CONVERT_KINDS.find((k) => k === i.kind) ?? "line";
      return { kind, text: str(i.text), label: str(i.label), right: str(i.right) };
    });
    return { heading: str(s.heading), items };
  });
  if (!header.name && !header.contact.length && !sections.some((s) => s.items.length)) throw new AiError("badReply");
  return { header, sections };
}

/** The reply as the editor's sections. Ids are always fresh, never the model's. */
export function buildSections(reply: ConvertReply): DocSection[] {
  const sections: unknown[] = [];
  if (reply.header.name) {
    const lines = [reply.header.name, ...reply.header.contact];
    sections.push({ id: newItemId(), heading: HEADER_HEADING, items: lines.map((text) => ({ id: newItemId(), text })) });
  }
  for (const s of reply.sections) {
    sections.push({
      id: newItemId(),
      heading: s.heading,
      items: s.items.map((i) => ({
        id: newItemId(), text: i.text, label: i.label, right: i.right, ...(i.kind === "line" ? {} : { kind: i.kind }),
      })),
    });
  }
  return normalizeSections(sections);
}

// -- Comparing with the source -------------------------------------------------------------------------------------------------------

const CURLY_QUOTES = /[‘’‚‛`´]/g;
const DASHES = /[‐‑‒–—―−]/g;

/** Lowercase, no accents (or ligatures: NFKD), straight quotes, one kind of dash and single spaces. */
const fold = (s: string): string =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(CURLY_QUOTES, "'").replace(DASHES, "-").replace(/\s+/g, " ");

/** The text with words that a line break split ("Mar-\nketing") joined again, as a file extraction leaves them. */
const rejoin = (s: string): string => s.replace(/(\p{L})-[ \t]*\r?\n[ \t]*(\p{L})/gu, "$1$2");

/**
 * A word: letters and apostrophes only, so "C++", "Node.js", "3D" and "R&D" split into pieces or drop their digits and symbols. Scripts
 * without capitals (CJK) are matched too, but they never count as a capitalised name.
 */
const WORD = /\p{L}[\p{L}'’]*/gu;
/**
 * A number: digits with optional thousands commas and decimals ("1,200", "3.5"). Currency symbols and percent signs aren't part of it, a
 * range ("2019-2022") gives two numbers, and number words ("twelve") aren't numbers.
 */
const NUMBER = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
/** A word as it is compared: folded, with quotes at its ends dropped. */
const key = (w: string): string => fold(w).replace(/^'+|'+$/g, "");
const wordsOf = (s: string): string[] => (s.match(WORD) ?? []).map(key).filter(Boolean);
/** A number without its commas, so "$1,200" and "1200" match. */
const numberKey = (n: string): string => n.replace(/,/g, "");

/** Everyday English words that would only add noise to the list of dropped words. Hand-tuned, English only: add to it when a real file shows noise. */
const COMMON_WORDS = (
  "above after again also among around because been before being between both cannot could does doing done down during each else even ever from further " +
  "gets give given goes going have having here herself himself into itself just keep know like made make many more most much must myself only other over own " +
  "same should since some such than that their theirs them then there these they this those through under until upon very were what when where whether " +
  "which while whom will with within without would your yours yourself across along although another anyone anything either every however " +
  "including onto per rather several still toward towards used using via whose about"
).split(" ");
/** Section names the template renames ("Profile" becomes "Professional summary"), so they aren't a dropped word. */
const RENAMED_SECTION_WORDS = "profile objective summary employment history".split(" ");
const STOPWORDS = new Set([...COMMON_WORDS, ...RENAMED_SECTION_WORDS]);
/** A page number: "3", "Page 3", "Page 3 of 4", "3 / 4". */
const PAGE_NUMBER = /^\s*(?:page\s+)?\d+(?:\s*(?:of|\/)\s*\d+)?\s*$/i;
/** Words a model may capitalise that a resume often words differently. */
const WORDS_MODEL_CAPITALISES = new Set(["present", "current"]);
/** Small words a bullet's label may add to the bullet's own words ("Planning and forecasting") without counting as made up. */
const SMALL_LABEL_WORDS = new Set(["and", "the", "for", "of", "to", "in", "on", "a", "an", "or", "with"]);
/** Shortest source word that is listed as dropped (shorter ones are mostly noise). */
const MIN_UNUSED_WORD_LENGTH = 4;
const MAX_UNUSED_WORDS = 40;
const MAX_NOTE_DETAILS = 3;

/**
 * The capitalised words of `text` (2+ letters), leaving out the first word of a sentence when `skipFirst`.
 *
 * Limits: a name that follows an abbreviation's period ("U.S. Army") is skipped as if it began a sentence, and an invented name that
 * begins a sentence is missed. An acronym is flagged only when it is absent from the source.
 */
function capitalised(text: string, skipFirst: boolean): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(WORD)) {
    const word = m[0];
    if (!/^\p{Lu}/u.test(word) || word.replace(/[^\p{L}]/gu, "").length < 2) continue;
    if (skipFirst) {
      const before = text.slice(0, m.index).replace(/[\s"'“”‘’(\[]+$/u, "");
      if (before === "" || /[.!?:]$/.test(before)) continue;
    }
    out.push(word);
  }
  return out;
}

interface SourceIndex {
  words: Set<string>;
  numbers: Set<string>;
}
function indexSource(source: string): SourceIndex {
  const text = rejoin(source);
  return { words: new Set(wordsOf(text)), numbers: new Set((text.match(NUMBER) ?? []).map(numberKey)) };
}

/**
 * The "detail tokens" of `text` that the source doesn't have. A detail token is a number, or a capitalised word that doesn't begin a
 * sentence (a name, a tool, a company). It is compared with the whole source, not with the line it came from, so a made-up number that
 * appears anywhere else in the file passes: a swapped figure is only caught when the figure itself is new.
 */
function missingDetails(text: string, src: SourceIndex, skipFirst: boolean): string[] {
  const out = (text.match(NUMBER) ?? []).filter((n) => !src.numbers.has(numberKey(n)));
  for (const w of capitalised(text, skipFirst)) {
    const k = key(w);
    if (k && !src.words.has(k) && !WORDS_MODEL_CAPITALISES.has(k)) out.push(w);
  }
  return out;
}

/** Only prose can begin with a capital for no reason: a company, a school or a skill's values can't. */
const isProse = (kind: DocItem["kind"]): boolean => kind === undefined || kind === "bullet";

/** Every text of the result in one string (headings, lines, labels and right-hand text), for the words that made it through. */
function resultText(sections: readonly DocSection[]): string {
  return sections.flatMap((s) => [s.heading, ...s.items.flatMap((i) => [i.text, i.label ?? "", i.right ?? ""])]).join("\n");
}

/** Up to MAX_UNUSED_WORDS distinct words of the source (4+ letters, no page numbers or everyday words) that `resultWords` doesn't have. */
function unusedSourceWords(sourceText: string, resultWords: ReadonlySet<string>): string[] {
  const body = rejoin(sourceText).split(/\r?\n/).filter((l) => !PAGE_NUMBER.test(l)).join("\n");
  const unused: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(WORD)) {
    const k = key(m[0]);
    if (k.length < MIN_UNUSED_WORD_LENGTH || STOPWORDS.has(k) || seen.has(k)) continue;
    seen.add(k);
    if (!resultWords.has(k)) unused.push(m[0].toLowerCase());
    if (unused.length >= MAX_UNUSED_WORDS) break;
  }
  return unused;
}

/**
 * Flags the converted lines that carry a detail the source doesn't have (a number, a date or a capitalised name) and the bullet labels the
 * model wrote itself, and lists up to MAX_UNUSED_WORDS words of the source that are nowhere in the result. Each flag names its line by id.
 */
export function checkAgainstSource(sourceText: string, sections: readonly DocSection[]): { flags: ConvertFlag[]; unused: string[] } {
  const src = indexSource(sourceText);
  const flags: ConvertFlag[] = [];
  for (const section of sections) {
    const header = section.heading === HEADER_HEADING;
    for (const item of section.items) {
      const parts = [item.text, item.right ?? "", ...(item.kind === "skill" ? [item.label ?? ""] : [])];
      const skipFirst = isProse(item.kind) && !header;
      const missing = [...new Set(parts.flatMap((p, i) => missingDetails(p, src, i === 0 && skipFirst)))];
      if (missing.length) flags.push({ itemId: item.id, kind: "detail", note: `Not in your file: ${missing.slice(0, MAX_NOTE_DETAILS).join(", ")}` });
      if (item.kind === "bullet" && item.label && wordsOf(item.label).some((w) => !SMALL_LABEL_WORDS.has(w) && !src.words.has(w))) {
        flags.push({ itemId: item.id, kind: "label", note: "Label added by AI" });
      }
    }
  }
  return { flags, unused: unusedSourceWords(sourceText, new Set(wordsOf(resultText(sections)))) };
}

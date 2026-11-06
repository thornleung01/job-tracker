// Checks what the model sent back. Pure. The reply is untrusted: its shape is validated, its ids are ignored, and every line is compared
// with the source text so a person can see anything that wasn't in their file before they save it.
import { HEADER_HEADING, newItemId, normalizeSections } from "../db/documentShape";
import type { DocItem, DocSection } from "../db/schema";
import type { ConvertFlag } from "../sync/convert";
import { AiError } from "./errors";
import { CONVERT_KINDS, type ConvertKind } from "./prompts";

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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (): never => {
  throw new AiError("badReply");
};
/** A missing string is "", anything else that isn't a string is a bad reply. */
const str = (v: unknown): string => (v === undefined || v === null ? "" : typeof v === "string" ? v : bad());

/** Validates the model's JSON. Extra properties are ignored, missing strings are "", an unknown kind becomes a plain line. */
export function parseConvertReply(json: unknown): ConvertReply {
  if (!isRecord(json)) return bad();
  const rawHeader = json.header;
  if (rawHeader !== undefined && !isRecord(rawHeader)) return bad();
  const contact = isRecord(rawHeader) ? rawHeader.contact : undefined;
  if (contact !== undefined && !Array.isArray(contact)) return bad();
  const header = {
    name: isRecord(rawHeader) ? str(rawHeader.name).trim() : "",
    contact: (contact ?? []).filter((c): c is string => typeof c === "string").map((c) => c.trim()).filter(Boolean),
  };
  if (!Array.isArray(json.sections)) return bad();
  const sections = json.sections.map((s) => {
    if (!isRecord(s) || !Array.isArray(s.items)) return bad();
    const items = s.items.map((i): ConvertReplyItem => {
      if (!isRecord(i)) return bad();
      const kind = CONVERT_KINDS.find((k) => k === i.kind) ?? "line";
      return { kind, text: str(i.text), label: str(i.label), right: str(i.right) };
    });
    return { heading: str(s.heading), items };
  });
  if (!header.name && !header.contact.length && !sections.some((s) => s.items.length)) return bad();
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

/** Lowercase, no accents, straight quotes, one kind of dash and single spaces. */
const fold = (s: string): string =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[‘’‚‛`´]/g, "'").replace(/[‐‑‒–—―−]/g, "-").replace(/\s+/g, " ");

/** The text with words that a line break split ("Mar-\nketing") joined again, as a file extraction leaves them. */
const rejoin = (s: string): string => s.replace(/(\p{L})-[ \t]*\r?\n[ \t]*(\p{L})/gu, "$1$2");

const WORD = /\p{L}[\p{L}'’]*/gu;
const NUMBER = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
/** A word as it is compared: folded, with quotes at its ends dropped. */
const key = (w: string): string => fold(w).replace(/^'+|'+$/g, "");
const wordsOf = (s: string): string[] => (s.match(WORD) ?? []).map(key).filter(Boolean);
/** A number without its commas, so "$1,200" and "1200" match. */
const numberKey = (n: string): string => n.replace(/,/g, "");

const STOPWORDS = new Set((
  "about above after again also among around because been before being between both cannot could does doing done down during each else even ever from further " +
  "gets give given goes going have having here herself himself into itself just keep know like made make many more most much must myself only other over own " +
  "same should since some such than that their theirs them then there these they this those through under until upon very were what when where whether " +
  "which while whom will with within without would your yours yourself across along although another anyone anything either every however " +
  "including onto per rather several still toward towards used using via whose " +
  // section names the template renames ("Profile" becomes "Professional summary"), so they aren't a dropped word
  "profile objective summary employment history about"
).split(" "));
/** A page number: "3", "Page 3", "Page 3 of 4", "3 / 4". */
const PAGE_NUMBER = /^\s*(?:page\s+)?\d+(?:\s*(?:of|\/)\s*\d+)?\s*$/i;
/** Words a model may capitalise that a resume often words differently. */
const COMMON = new Set(["present", "current"]);
const SMALL_LABEL_WORDS = new Set(["and", "the", "for", "of", "to", "in", "on", "a", "an", "or", "with"]);

/** The capitalised words of `text` (2+ letters), leaving out the first word of a sentence when `skipFirst`. */
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

/** The details of `text` that the source doesn't have: numbers, and capitalised words that don't begin a sentence. */
function missingDetails(text: string, src: SourceIndex, skipFirst: boolean): string[] {
  const out = (text.match(NUMBER) ?? []).filter((n) => !src.numbers.has(numberKey(n)));
  for (const w of capitalised(text, skipFirst)) {
    const k = key(w);
    if (k && !src.words.has(k) && !COMMON.has(k)) out.push(w);
  }
  return out;
}

/** Only prose can begin with a capital for no reason: a company, a school or a skill's values can't. */
const isProse = (kind: DocItem["kind"]): boolean => kind === undefined || kind === "bullet";

/**
 * Flags the converted lines that carry a detail the source doesn't have (a number, a date or a capitalised name) and the bullet labels the
 * model wrote itself, and lists up to 40 words of the source that are nowhere in the result. Each flag names its line by id.
 */
export function checkAgainstSource(sourceText: string, sections: readonly DocSection[]): { flags: ConvertFlag[]; unused: string[] } {
  const src = indexSource(sourceText);
  const flags: ConvertFlag[] = [];
  const result: string[] = [];
  for (const section of sections) {
    result.push(section.heading);
    const header = section.heading === HEADER_HEADING;
    for (const item of section.items) {
      result.push(item.text, item.label ?? "", item.right ?? "");
      const parts = [item.text, item.right ?? "", ...(item.kind === "skill" ? [item.label ?? ""] : [])];
      const skipFirst = isProse(item.kind) && !header;
      const missing = [...new Set(parts.flatMap((p, i) => missingDetails(p, src, i === 0 && skipFirst)))];
      if (missing.length) flags.push({ itemId: item.id, kind: "detail", note: `Not in your file: ${missing.slice(0, 3).join(", ")}` });
      if (item.kind === "bullet" && item.label && wordsOf(item.label).some((w) => !SMALL_LABEL_WORDS.has(w) && !src.words.has(w))) {
        flags.push({ itemId: item.id, kind: "label", note: "Label added by AI" });
      }
    }
  }
  const inResult = new Set(wordsOf(result.join("\n")));
  const body = rejoin(sourceText).split(/\r?\n/).filter((l) => !PAGE_NUMBER.test(l)).join("\n");
  const unused: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(WORD)) {
    const k = key(m[0]);
    if (k.length < 4 || STOPWORDS.has(k) || seen.has(k)) continue;
    seen.add(k);
    if (!inResult.has(k)) unused.push(m[0].toLocaleLowerCase());
    if (unused.length >= 40) break;
  }
  return { flags, unused };
}

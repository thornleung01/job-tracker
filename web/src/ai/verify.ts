// Checks what the model sent back. Pure. The reply is untrusted: its shape is validated, its ids are ignored, and every line is compared
// with the source text so a person can see anything that wasn't in their file before they save it.
import { HEADER_HEADING, newItemId, normalizeSections } from "../db/documentShape";
import { isRecord } from "../db/isRecord";
import type { DocItem, DocSection } from "../db/schema";
import { MAX_DOC_ITEM_CHARS, MAX_DOC_ITEMS, MAX_DOC_LABEL_CHARS } from "../db/limits";
import { AiError } from "./errors";
import { masterText, type MasterLine, type TailorMaster } from "./master";
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
export const wordsOf = (s: string): string[] => (s.match(WORD) ?? []).map(key).filter(Boolean);
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
export const SMALL_LABEL_WORDS = new Set(["and", "the", "for", "of", "to", "in", "on", "a", "an", "or", "with"]);
/** Shortest source word that is listed as dropped (shorter ones are mostly noise). */
const MIN_UNUSED_WORD_LENGTH = 4;
const MAX_UNUSED_WORDS = 40;
/** How many details a flag note names. */
const NOTE_DETAILS = 3;

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

export interface SourceIndex {
  words: Set<string>;
  numbers: Set<string>;
}
export function indexSource(source: string): SourceIndex {
  const text = rejoin(source);
  return { words: new Set(wordsOf(text)), numbers: new Set((text.match(NUMBER) ?? []).map(numberKey)) };
}

/**
 * The "detail tokens" of `text` that the source doesn't have. A detail token is a number, or a capitalised word that doesn't begin a
 * sentence (a name, a tool, a company). It is compared with the whole source, not with the line it came from, so a made-up number that
 * appears anywhere else in the file passes: a swapped figure is only caught when the figure itself is new.
 */
export function missingDetails(text: string, src: SourceIndex, skipFirst: boolean): string[] {
  const out = (text.match(NUMBER) ?? []).filter((n) => !src.numbers.has(numberKey(n)));
  for (const w of capitalised(text, skipFirst)) {
    const k = key(w);
    if (k && !src.words.has(k) && !WORDS_MODEL_CAPITALISES.has(k)) out.push(w);
  }
  return out;
}

/** Only prose can begin with a capital for no reason: a company, a school or a skill's values can't. */
const isProse = (kind: DocItem["kind"]): boolean => kind === undefined || kind === "bullet";

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
      if (missing.length) flags.push({ itemId: item.id, kind: "detail", note: `Not in your file: ${missing.slice(0, NOTE_DETAILS).join(", ")}` });
      if (item.kind === "bullet" && item.label && wordsOf(item.label).some((w) => !SMALL_LABEL_WORDS.has(w) && !src.words.has(w))) {
        flags.push({ itemId: item.id, kind: "label", note: "Label added by AI" });
      }
    }
  }
  return { flags, unused: unusedSourceWords(sourceText, new Set(wordsOf(masterText(sections)))) };
}

// -- Tailoring ------------------------------------------------------------------------------------------------------------------------
// The model only ever chooses, orders and rewords lines of the master. Its reply names master lines by id, and anything that doesn't match
// (an unknown id, a bullet under the wrong job) is dropped. The header, companies, titles and schools aren't in the reply's shape at all.

/** What the model sends for tailoring. */
export interface TailorReply {
  summary: string;
  skills: { sourceId: string; text: string }[];
  jobs: { orgId: string; bullets: { sourceId: string; label: string; text: string }[] }[];
  cover: { paragraphs: string[] };
}

const MAX_COVER_PARAGRAPHS = 5;

const clip = (s: string, max: number): string => s.replace(/\r\n?/g, "\n").trim().slice(0, max);
const arr = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) throw new AiError("badReply");
  return v;
};
const rec = (v: unknown): Record<string, unknown> => {
  if (!isRecord(v)) throw new AiError("badReply");
  return v;
};

/** Validates the model's JSON: every part must have its shape and its strings must be strings. Long text and long lists are cut, extra properties ignored. */
export function parseTailorReply(json: unknown): TailorReply {
  const r = rec(json);
  const reply: TailorReply = {
    summary: clip(str(r.summary), MAX_DOC_ITEM_CHARS),
    skills: arr(r.skills).slice(0, MAX_DOC_ITEMS).map((s) => {
      const o = rec(s);
      return { sourceId: str(o.sourceId).trim(), text: clip(str(o.text), MAX_DOC_ITEM_CHARS) };
    }),
    jobs: arr(r.jobs).slice(0, MAX_DOC_ITEMS).map((j) => {
      const o = rec(j);
      return {
        orgId: str(o.orgId).trim(),
        bullets: arr(o.bullets).slice(0, MAX_DOC_ITEMS).map((b) => {
          const p = rec(b);
          return { sourceId: str(p.sourceId).trim(), label: clip(str(p.label), MAX_DOC_LABEL_CHARS), text: clip(str(p.text), MAX_DOC_ITEM_CHARS) };
        }),
      };
    }),
    cover: { paragraphs: arr(rec(r.cover).paragraphs).slice(0, MAX_COVER_PARAGRAPHS).map((p) => clip(str(p), MAX_DOC_ITEM_CHARS)).filter(Boolean) },
  };
  if (!reply.cover.paragraphs.length) throw new AiError("badReply");
  return reply;
}

/** A line of the tailored resume: where it came from, what it says, and what the person should look at before keeping it. */
export interface CheckedLine {
  sourceId: string;
  /** every master line this one replaces, when more than one (a summary written on several lines) */
  sourceIds?: string[];
  label: string;
  text: string;
  changed: boolean;
  flags: string[];
}
export interface CheckedTailor {
  /** null when the master has no summary: nothing is added */
  summary: CheckedLine | null;
  skills: CheckedLine[];
  /** master skill lines the model left out (none when it sent no valid skill: then all are kept) */
  droppedSkills: MasterLine[];
  /** one entry for every job of the master, in its order */
  jobs: { orgId: string; bullets: CheckedLine[]; dropped: MasterLine[] }[];
  cover: { paragraphs: string[]; flags: string[] };
}

/** Words that claim a credential. A model told to add a degree writes one of these, and a capital letter alone wouldn't catch "a degree in physics". */
const CREDENTIAL =
  /\b(?:ph\.?d|doctorate|doctoral|mba|b\.?sc|m\.?sc|bachelor'?s?|master'?s|degree|diploma|graduat(?:e|ed|es|ion)|certified|certification|chartered|clearance|fluent|licen[cs]ed?)\b/gi;
/** A credential is supported only by the source's own words around it: this many characters either side of each place the source uses the word. */
const CREDENTIAL_REACH = 80;
/** How many words after a credential word say what it is for ("degree in physics"). */
const CREDENTIAL_SUBJECT_WORDS = 2;
const credentialKey = (w: string): string => fold(w).replace(/[.']/g, "").replace(/s$/, "");
const SUBJECT_SKIP = new Set([...SMALL_LABEL_WORDS, "from", "at", "by", "as", "is", "was", "are", "my", "our"]);

/** Whether the source uses the credential word `claim` with the words that follow it in `text` close by, not just somewhere. */
function credentialSupported(claim: RegExpMatchArray, text: string, srcFolded: string): boolean {
  const k = credentialKey(claim[0]);
  const after = text.slice((claim.index ?? 0) + claim[0].length);
  const subject = wordsOf(after)
    .filter((w) => !SUBJECT_SKIP.has(w) && !CREDENTIAL_WORD.test(w))
    .slice(0, CREDENTIAL_SUBJECT_WORDS);
  for (const m of srcFolded.matchAll(CREDENTIAL)) {
    if (credentialKey(m[0]) !== k) continue;
    const at = m.index ?? 0;
    const near = new Set(wordsOf(srcFolded.slice(Math.max(0, at - CREDENTIAL_REACH), at + m[0].length + CREDENTIAL_REACH)));
    if (subject.every((w) => near.has(w))) return true;
  }
  return false;
}
const CREDENTIAL_WORD = new RegExp(`^${CREDENTIAL.source}$`, "i");

/** A web address, a domain or an email address, written in any case. A tailored line has no reason to add one. */
const LINK_LIKE =
  /[^\s<>()"',;]+@[^\s<>()"',;]+\.[a-z]{2,}|(?:https?:\/\/|www\.)[^\s<>()"',;]+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|ca|org|net|io|co|dev|app|ai|us|uk|me|ly|info|biz|edu|gov|xyz|tech)\b(?:\/[^\s<>()"',;]*)?/gi;
const linkKey = (s: string): string => fold(s).replace(/[.\/]+$/, "");

/** The values of a skills line ("python, sql; aws"), each one a thing the person claims to know. */
const skillValues = (text: string): string[] => text.split(/[,;|\u2022\u00b7]/).map((v) => v.trim()).filter(Boolean);

/**
 * What a tailored text claims that the source doesn't have: numbers, names and tools (the convert detector), credentials without their own
 * support nearby, web addresses and email addresses, and, on a skills line, any value whose words the source doesn't have (a lowercase "kubernetes"
 * has no capital to give it away). Phone numbers are digit runs, so the number check already covers them.
 */
function unfoundClaims(text: string, src: SourceIndex, srcFolded: string, skipFirst: boolean, skills = false): string[] {
  const found = missingDetails(text, src, skipFirst);
  for (const m of text.matchAll(CREDENTIAL)) if (!credentialSupported(m, text, srcFolded)) found.push(m[0]);
  for (const m of text.matchAll(LINK_LIKE)) if (!srcFolded.includes(linkKey(m[0]))) found.push(m[0]);
  if (skills) for (const v of skillValues(text)) if (wordsOf(v).some((w) => !src.words.has(w))) found.push(v);
  return [...new Set(found)];
}
const note = (missing: string[]): string[] => (missing.length ? [`Not in your resume: ${missing.slice(0, NOTE_DETAILS).join(", ")}`] : []);

const GREETING = /^dear\b/i;
const SIGN_OFF_PHRASES = "sincerely|regards|best regards|kind regards|warm regards|best|cheers|yours truly|yours sincerely|respectfully|thank you|thanks";
/** Only a known phrase on its own ("Sincerely,"), a known phrase and a short name ("Sincerely, Jordan"), or a short line that ends in a comma. Never a full sentence. */
const SIGN_OFF = new RegExp(`^(?:(?:${SIGN_OFF_PHRASES})[,.!]?|(?:${SIGN_OFF_PHRASES}),\\s*[^.!?,]{1,40}|[^.!?,]{1,40},)$`, "i");
/** The paragraphs without a greeting or sign-off the model wrote anyway: the app adds its own greeting. */
function bodyParagraphs(paragraphs: readonly string[]): string[] {
  const out = [...paragraphs];
  while (out.length && GREETING.test(out[0])) out.shift();
  while (out.length && SIGN_OFF.test(out[out.length - 1].trim())) out.pop();
  return out;
}

/**
 * Checks a parsed reply against the master. Pure.
 * - Lines are tied to the master by id. An unknown id, a repeat, or a bullet placed under a different job is dropped, and a job never
 *   has more bullets than the master has. A job left with none keeps the master's own bullets, so no job is ever empty.
 * - A line that carries a number, date, name, tool or credential the master doesn't have starts flagged, and so does a made-up bullet label.
 * - A cover letter paragraph is flagged for a number or name that is in neither the master nor the job's company and role. The posting text is
 *   left out on purpose: text in a posting is the likeliest way to talk a model into a claim.
 * `masterSource` is every text of the master (see masterText).
 */
export function checkTailored(
  master: TailorMaster, reply: TailorReply, ctx: { masterSource: string; company: string; role: string },
): CheckedTailor {
  const src = indexSource(ctx.masterSource);
  const srcFolded = fold(rejoin(ctx.masterSource));
  const claims = (text: string, skipFirst: boolean, skills = false) => note(unfoundClaims(text, src, srcFolded, skipFirst, skills));
  const same = (a: string, b: string) => fold(a).trim() === fold(b).trim();

  const line = (from: MasterLine, label: string, text: string, skipFirst: boolean, skills = false): CheckedLine => {
    const flags = claims(text, skipFirst, skills);
    if (label && !same(label, from.label) && wordsOf(label).some((w) => !SMALL_LABEL_WORDS.has(w) && !src.words.has(w))) flags.push("Label added by AI");
    return { sourceId: from.id, label, text, changed: !same(text, from.text) || !same(label, from.label), flags };
  };
  const kept = (from: MasterLine): CheckedLine => ({ sourceId: from.id, label: from.label, text: from.text, changed: false, flags: [] });

  let summary: CheckedLine | null = null;
  if (master.summaryId) {
    const from: MasterLine = { id: master.summaryId, label: "", text: master.summary };
    summary = { ...(reply.summary ? line(from, "", reply.summary, true) : kept(from)), sourceIds: master.summaryIds };
  }

  const skillById = new Map(master.skills.map((s) => [s.id, s]));
  const skillSeen = new Set<string>();
  let skills: CheckedLine[] = [];
  for (const s of reply.skills) {
    const from = skillById.get(s.sourceId);
    if (!from || !s.text || skillSeen.has(from.id)) continue;
    skillSeen.add(from.id);
    skills.push(line(from, from.label, s.text, false, true));
  }
  if (!skills.length) skills = master.skills.map(kept);
  const skillsUsed = new Set(skills.map((s) => s.sourceId));
  const droppedSkills = master.skills.filter((s) => !skillsUsed.has(s.id));

  const replyJobs = new Map<string, TailorReply["jobs"][number]>();
  for (const j of reply.jobs) if (!replyJobs.has(j.orgId)) replyJobs.set(j.orgId, j);
  const jobs = master.jobs.map((job) => {
    const own = new Map(job.bullets.map((b) => [b.id, b]));
    const seen = new Set<string>();
    let bullets: CheckedLine[] = [];
    for (const b of replyJobs.get(job.id)?.bullets ?? []) {
      const from = own.get(b.sourceId);
      if (!from || !b.text || seen.has(from.id)) continue;
      seen.add(from.id);
      bullets.push(line(from, b.label || from.label, b.text, true));
    }
    bullets = bullets.slice(0, job.bullets.length);
    if (!bullets.length) bullets = job.bullets.map(kept);
    const used = new Set(bullets.map((b) => b.sourceId));
    return { orgId: job.id, bullets, dropped: job.bullets.filter((b) => !used.has(b.id)) };
  });

  const paragraphs = bodyParagraphs(reply.cover.paragraphs);
  if (!paragraphs.length) throw new AiError("badReply");
  const coverSrc = indexSource(`${ctx.masterSource}\n${ctx.company}\n${ctx.role}`);
  const coverFolded = fold(`${ctx.masterSource}\n${ctx.company}\n${ctx.role}`);
  const coverFlags = paragraphs.flatMap((p, i) => {
    const missing = unfoundClaims(p, coverSrc, coverFolded, true);
    return missing.length ? [`Paragraph ${i + 1} has details not in your resume or the job: ${missing.slice(0, NOTE_DETAILS).join(", ")}`] : [];
  });
  return { summary, skills, droppedSkills, jobs, cover: { paragraphs, flags: coverFlags } };
}

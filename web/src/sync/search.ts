// Search on the Applications page: company and role, plus the subjects and bodies of an application's emails and the text of its
// notes and steps. Pure: the caller hands over what it has already loaded, and nothing here touches the database.
import { MAX_NOTE_CHARS, SEARCH_MAX_CHARS, SEARCH_MAX_WORDS, SEARCH_MIN_CHARS, SUBJECT_READ_CHARS } from "../db/limits";
import { BODY_LIMIT } from "../types";

/** How much of the text around a hit is shown. */
const SNIPPET_BEFORE = 30;
const SNIPPET_AFTER = 70;

export interface SearchRow {
  id: number;
  company: string;
  role: string;
}
export interface SearchEmail {
  applicationId: number | null;
  /** null once the email's content is erased */
  subject: string | null;
  body: string | null;
}
export interface SearchActivity {
  applicationId: number;
  kind: "note" | "step";
  label: string | null;
  body: string;
}

/** Why an application matched. "name" is the company or role, which the row already shows, so it has no snippet. */
export interface SearchMatch {
  via: "name" | "email" | "note" | "step";
  /** the text around the first hit, on one line; empty for "name" */
  snippet: string;
}

const NON_ASCII = /[^\u0000-\u007f]/;
const MARKS = /\p{M}/gu;

/** Lower case with accents taken off, so "résumé" and "RESUME" meet. Plain ASCII, nearly all of the text, skips the Unicode step. */
export function foldText(text: string): string {
  return NON_ASCII.test(text) ? text.normalize("NFD").replace(MARKS, "").toLowerCase() : text.toLowerCase();
}

/** The words of a search, folded, in the order typed, without repeats, at most SEARCH_MAX_WORDS. Empty for a search that is blank. */
export function searchWords(query: string): string[] {
  const words = foldText(query.slice(0, SEARCH_MAX_CHARS)).split(/\s+/).filter(Boolean);
  return [...new Set(words)].slice(0, SEARCH_MAX_WORDS);
}

/** `text` folded one character at a time, with where each folded character came from, so a hit can be cut out of the original. */
function foldWithMap(text: string): { folded: string; from: number[] } {
  let folded = "";
  const from: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = foldText(ch);
    for (let k = 0; k < f.length; k++) from.push(i);
    folded += f;
    i += ch.length;
  }
  return { folded, from };
}

/** About 100 characters of `text` around the first of `words` it holds, on one line, with an ellipsis where it was cut. */
export function snippetAround(text: string, words: readonly string[]): string {
  const { folded, from } = foldWithMap(text);
  let at = -1;
  for (const w of words) {
    const found = folded.indexOf(w);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) return "";
  const start = Math.max(0, (from[at] ?? 0) - SNIPPET_BEFORE);
  const end = Math.min(text.length, (from[at] ?? 0) + SNIPPET_AFTER);
  const cut = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${cut}${end < text.length ? "…" : ""}`;
}

/**
 * The applications that match `query`, with why. Every word must be found, in any order, ignoring case and accents. A word may be
 * in the company or role or in a single email's subject or body, or a single note or step: words are never pieced together from
 * several emails. An application whose name has all the words matches as "name" and its mail is never read. A search shorter than
 * SEARCH_MIN_CHARS, or a blank one, looks at company and role only (a blank one matches nothing: callers don't filter then).
 * Erased emails (no subject, no body) and emails that belong to another application never match.
 */
export function searchApplications(
  rows: readonly SearchRow[], emails: readonly SearchEmail[], activity: readonly SearchActivity[], query: string,
): Map<number, SearchMatch> {
  const hits = new Map<number, SearchMatch>();
  const words = searchWords(query.trim());
  if (!words.length) return hits;

  const rest = new Map<number, string[]>();
  for (const r of rows) {
    const name = foldText(`${r.company} ${r.role}`);
    const missing = words.filter((w) => !name.includes(w));
    if (!missing.length) hits.set(r.id, { via: "name", snippet: "" });
    else rest.set(r.id, missing);
  }
  if (!rest.size || query.trim().length < SEARCH_MIN_CHARS) return hits;

  // One pass over each list, keeping only what belongs to an application still looking for its words.
  const mailOf = new Map<number, SearchEmail[]>();
  for (const e of emails) {
    if (e.applicationId == null || !rest.has(e.applicationId) || (e.subject == null && e.body == null)) continue;
    const list = mailOf.get(e.applicationId);
    if (list) list.push(e);
    else mailOf.set(e.applicationId, [e]);
  }
  const notesOf = new Map<number, SearchActivity[]>();
  for (const a of activity) {
    if (!rest.has(a.applicationId)) continue;
    const list = notesOf.get(a.applicationId);
    if (list) list.push(a);
    else notesOf.set(a.applicationId, [a]);
  }

  for (const [id, missing] of rest) {
    const holds = (text: string) => {
      const f = foldText(text);
      return missing.every((w) => f.includes(w));
    };
    // newest first: the list is in the order stored, which is the order they arrived
    const mail = mailOf.get(id) ?? [];
    for (let i = mail.length - 1; i >= 0; i--) {
      const subject = (mail[i].subject ?? "").slice(0, SUBJECT_READ_CHARS);
      const body = (mail[i].body ?? "").slice(0, BODY_LIMIT);
      // A word may be in the subject and another in the body of the same email.
      const text = `${subject}\n${body}`;
      if (holds(text)) {
        hits.set(id, { via: "email", snippet: snippetAround(text, missing) });
        break;
      }
    }
    if (hits.has(id)) continue;
    const notes = notesOf.get(id) ?? [];
    for (let i = notes.length - 1; i >= 0; i--) {
      const text = `${notes[i].label ?? ""}\n${notes[i].body}`.slice(0, MAX_NOTE_CHARS);
      if (holds(text)) {
        hits.set(id, { via: notes[i].kind, snippet: snippetAround(text, missing) });
        break;
      }
    }
  }
  return hits;
}

/** "Matched in an email: …" for a row that matched on text other than its company or role, or "" for a name match. */
export function whyMatched(match: SearchMatch | undefined): string {
  if (!match || match.via === "name") return "";
  const where = match.via === "email" ? "an email" : match.via === "note" ? "a note" : "a step";
  return match.snippet ? `Matched in ${where}: ${match.snippet}` : `Matched in ${where}`;
}

// Python `re` patterns run as JavaScript RegExp, with Python's meaning.
//
// The pipeline's patterns are written (and stored in rules.yaml) as Python regexes. Instead of rewriting each one, `py`
// translates the source so the same text matches the same way. Each line is "Python  ->  JavaScript":
//   \w \d \s \b    ->  Unicode-aware versions (JS is ASCII-only for \w \d \b)
//   .               ->  any character except "\n" (JS also excludes \r, U+2028, U+2029)
//   $               ->  end of text, or just before a final "\n" (JS: end of text only)
//   (?P<n>...)      ->  (?<n>...)
//   (?P=n)          ->  \k<n>
//   \A  \Z          ->  ^  $
//   (?i) at the very start  ->  the "i" flag
//   {,n}            ->  {0,n}
//   a "{", "}" or "]" that is not part of a quantifier or set  ->  a literal one
// Possessive quantifiers, atomic groups, conditionals and other inline flags throw: they have no JS equivalent.
// Ignore case also matches Python's extra equivalences for "i" ("\u{130}" and "\u{131}"), which JS's case folding lacks.
// Flags: "i" ignore case, "g" global (finditer/sub), "y" sticky (re.match anchors at the start).
//
// `translate` walks the source once and hands each construct to a small reader (escape, set, group opener, brace).
// Every reader takes the source and the index where its construct starts, and returns the JS text plus the index
// just after it, so the loop never has to know how long a construct is.

const WORD = "\\p{L}\\p{N}_";
const SPACE = "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u{1680}\\u{2000}-\\u{200a}\\u{2028}\\u{2029}\\u{202f}\\u{205f}\\u{3000}";
const BOUNDARY = `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`;
const NOT_BOUNDARY = `(?:(?<=[${WORD}])(?=[${WORD}])|(?<![${WORD}])(?![${WORD}]))`;
const SYNTAX = "^$\\.*+?()[]{}|/";
const QUANT = /^\{(\d*)(,?)(\d*)\}/;
const DOTTED_I = "iI\\u{130}\\u{131}";

export class UnsupportedRegex extends Error {}

/** JS text for a piece of the source, and the index of the first character after it. */
interface Piece {
  text: string;
  next: number;
}

const isAsciiAlnum = (c: string) => /[A-Za-z0-9]/.test(c);

/** The character after a backslash. A backslash at the very end has nothing to escape. */
function escapedChar(source: string, backslash: number): string {
  const c = source[backslash + 1];
  if (c === undefined) throw new UnsupportedRegex("trailing backslash");
  return c;
}

/**
 * `\xhh`, `\uhhhh`, `\u{...}` and `\Uhhhhhhhh`, the same inside and outside a set. `at` is the index just after the
 * letter. Returns null for any other escape letter.
 */
function numericEscape(source: string, kind: string, at: number): Piece | null {
  if (kind === "x") return { text: `\\x${source.slice(at, at + 2)}`, next: at + 2 };
  if (kind === "u") {
    if (source[at] === "{") {
      // Not Python syntax: lets TS sources spell code points without literal characters.
      const end = source.indexOf("}", at);
      return { text: `\\u${source.slice(at, end + 1)}`, next: end + 1 };
    }
    return { text: `\\u{${source.slice(at, at + 4)}}`, next: at + 4 };
  }
  if (kind === "U") return { text: `\\u{${source.slice(at, at + 8).replace(/^0+(?=.)/, "")}}`, next: at + 8 };
  return null;
}

/** A backslash escape outside a set. */
function readEscape(source: string, backslash: number): Piece {
  const d = escapedChar(source, backslash);
  const at = backslash + 2;
  const numeric = numericEscape(source, d, at);
  if (numeric) return numeric;
  return { text: escapeOutsideSet(d), next: at };
}

function escapeOutsideSet(d: string): string {
  switch (d) {
    case "w":
      return `[${WORD}]`;
    case "W":
      return `[^${WORD}]`;
    case "d":
      return "\\p{Nd}";
    case "D":
      return "\\P{Nd}";
    case "s":
      return `[${SPACE}]`;
    case "S":
      return `[^${SPACE}]`;
    case "b":
      return BOUNDARY;
    case "B":
      return NOT_BOUNDARY;
    case "A":
      return "^";
    case "Z":
      return "$";
    case "n":
    case "t":
    case "r":
    case "f":
    case "v":
      return `\\${d}`;
    default:
      // \1 to \9 are back references. Any other letter or digit has no meaning here.
      if (/[1-9]/.test(d)) return `\\${d}`;
      if (isAsciiAlnum(d)) throw new UnsupportedRegex(`unsupported escape \\${d}`);
      return SYNTAX.includes(d) ? `\\${d}` : d;
  }
}

/** Returns [JS text, whether it is a shorthand like \d that a following "-" must not form a range with]. */
function escapeInSet(d: string): [string, boolean] {
  switch (d) {
    case "w":
      return [WORD, true];
    case "d":
      return ["\\p{Nd}", true];
    case "D":
      return ["\\P{Nd}", true];
    case "s":
      return [SPACE, true];
    case "b":
      return ["\\x08", false]; // \b inside a set is backspace, not a word boundary
    case "n":
    case "t":
    case "r":
    case "f":
    case "v":
      return [`\\${d}`, false];
    case "W":
    case "S":
    case "B":
      throw new UnsupportedRegex(`\\${d} inside a character class`);
    default:
      if (isAsciiAlnum(d)) throw new UnsupportedRegex(`unsupported escape \\${d}`);
      return [SYNTAX.includes(d) || d === "-" ? `\\${d}` : d, false];
  }
}

/** A character set, `[...]` or `[^...]`. `open` is the index of the "[". */
function readSet(source: string, open: number, ignoreCase: boolean): Piece {
  let i = open + 1;
  let charClass = "[";
  if (source[i] === "^") {
    charClass += "^";
    i++;
  }
  let first = true; // a "]" right after the opener is a literal member, not the end
  // The previous member was \d, \w or \s, so a following "-" is a literal hyphen, not a range.
  let lastWasShorthand = false;
  for (;;) {
    if (i >= source.length) throw new UnsupportedRegex("unterminated character set");
    const ch = source[i];
    if (ch === "]" && !first) return { text: charClass + "]", next: i + 1 };
    first = false;
    if (ch === "\\") {
      const d = escapedChar(source, i);
      const numeric = numericEscape(source, d, i + 2);
      if (numeric) {
        charClass += numeric.text;
        i = numeric.next;
        lastWasShorthand = false;
      } else {
        const [text, isShorthand] = escapeInSet(d);
        charClass += text;
        lastWasShorthand = isShorthand;
        i += 2;
      }
      continue;
    }
    if (ch === "]") charClass += "\\]";
    else if (ch === "-" && lastWasShorthand) charClass += "\\-";
    else if (ch === "[") charClass += "\\[";
    // Not at the start of a range ("[i-z]"): the expansion would put the extra letters between "i" and "-", an out-of-order range.
    else if (ignoreCase && (ch === "i" || ch === "I") && !(source[i + 1] === "-" && source[i + 2] !== "]")) charClass += DOTTED_I;
    else charClass += ch;
    lastWasShorthand = false;
    i++;
  }
}

/** A group opener that starts with "(?". `paren` is the index of the "(". `setsIgnoreCase` marks a leading (?i). */
function readGroupStart(source: string, paren: number): Piece & { setsIgnoreCase?: true } {
  const rest = source.slice(paren + 2);
  if (rest.startsWith("P<")) {
    const end = rest.indexOf(">");
    return { text: `(?<${rest.slice(2, end)}>`, next: paren + 2 + end + 1 };
  }
  if (rest.startsWith("P=")) {
    const end = rest.indexOf(")");
    return { text: `\\k<${rest.slice(2, end)}>`, next: paren + 2 + end + 1 };
  }
  if (/^(?::|=|!|<=|<!)/.test(rest)) return { text: "(?", next: paren + 2 }; // non-capturing and look-around work as they are
  if (rest.startsWith("i)") && paren === 0) return { text: "", next: paren + 4, setsIgnoreCase: true };
  throw new UnsupportedRegex(`unsupported group syntax (?${rest.slice(0, 2)}`);
}

/** A "{" : a counted quantifier such as {2}, {2,} or {,3}, or a literal brace when it is not one. */
function readBrace(source: string, open: number): Piece {
  const m = QUANT.exec(source.slice(open));
  if (!m || !(m[1] || m[3])) return { text: "\\{", next: open + 1 };
  const next = open + m[0].length;
  if (source[next] === "+") throw new UnsupportedRegex("possessive quantifier");
  return { text: `{${m[1] || "0"}${m[2]}${m[3]}}`, next };
}

/** Everything else: one character, with the few that mean something different in JS. */
function readPlain(source: string, at: number, ignoreCase: boolean): Piece {
  const c = source[at];
  const next = at + 1;
  if (c === "}") return { text: "\\}", next };
  if (c === "]") return { text: "\\]", next };
  if (c === ".") return { text: "[^\\n]", next }; // JS's "." also stops at \r, U+2028 and U+2029
  if (c === "$") return { text: "(?=\\n?$)", next }; // Python's "$" also matches before a final newline
  if ((c === "*" || c === "+" || c === "?") && source[next] === "+") throw new UnsupportedRegex("possessive quantifier");
  return { text: ignoreCase && (c === "i" || c === "I") ? `[${DOTTED_I}]` : c, next };
}

export function translate(source: string, flagIgnoreCase = false): { source: string; ignoreCase: boolean } {
  let out = "";
  let ignoreCase = flagIgnoreCase;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    let piece: Piece;
    if (c === "\\") piece = readEscape(source, i);
    else if (c === "[") piece = readSet(source, i, ignoreCase);
    else if (c === "(" && source[i + 1] === "?") {
      const group = readGroupStart(source, i);
      if (group.setsIgnoreCase) ignoreCase = true;
      piece = group;
    } else if (c === "{") piece = readBrace(source, i);
    else piece = readPlain(source, i, ignoreCase);
    out += piece.text;
    i = piece.next;
  }
  return { source: out, ignoreCase };
}

/** Compile a Python regex source. Pattern text is kept on `.pyPattern` for messages that quote it. */
export function py(source: string, flags = ""): RegExp {
  const t = translate(source, flags.includes("i"));
  const f = new Set(flags.split(""));
  if (t.ignoreCase) f.add("i");
  const re = new RegExp(t.source, "u" + [...f].join(""));
  (re as RegExp & { pyPattern?: string }).pyPattern = source;
  return re;
}

export const pattern = (re: RegExp): string => (re as RegExp & { pyPattern?: string }).pyPattern ?? re.source;

/** re.search(...).test: a fresh scan from the start. */
export function search(re: RegExp, s: string): RegExpExecArray | null {
  re.lastIndex = 0;
  return re.exec(s);
}

export const test = (re: RegExp, s: string): boolean => search(re, s) !== null;

/** re.match: anchored at the start. `re` must be compiled with the "y" flag. */
export function match(re: RegExp, s: string): RegExpExecArray | null {
  re.lastIndex = 0;
  return re.exec(s);
}

/** re.sub with a string replacement that has no group references. `re` must have the "g" flag. */
export function sub(re: RegExp, replacement: string, s: string): string {
  re.lastIndex = 0;
  return s.replace(re, () => replacement);
}

/** re.finditer. `re` must have the "g" flag. */
export function finditer(re: RegExp, s: string): RegExpExecArray[] {
  re.lastIndex = 0;
  return [...s.matchAll(re)] as RegExpExecArray[];
}

/** re.fullmatch as a sticky regex: use with `match`. */
export const pyFull = (source: string, flags = ""): RegExp => py(`(?:${source})\\Z`, flags + "y");

/** re.escape (Python 3.7+): only regex-special characters get a backslash. */
export function reEscape(s: string): string {
  return s.replace(/[()[\]{}?*+\-|^$\\.&~# \t\n\r\v\f]/g, (c) => "\\" + c);
}

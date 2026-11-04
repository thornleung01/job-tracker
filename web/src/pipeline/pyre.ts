// Python `re` patterns run as JavaScript RegExp, with Python's meaning.
//
// The pipeline's patterns are written (and stored in rules.yaml) as Python regexes. Instead of rewriting each one, `py`
// translates the source so the same text matches the same way:
//   \w \d \s \b   Unicode-aware like Python's str patterns (JS is ASCII-only for \w \d \b)
//   .             any character except "\n" (JS also excludes \r, U+2028, U+2029)
//   $             end of text, or just before a final "\n" (JS: end of text only)
//   (?P<n>...)    (?<n>...)        \Z  \A    (?i) at the very start    {,n}   literal "{" and "]"
// Possessive quantifiers, atomic groups, conditionals and other inline flags throw: they have no JS equivalent.
// Ignore case also matches Python's extra equivalences for "i" ("\u{130}" and "\u{131}"), which JS's case folding lacks.
// Flags: "i" ignore case, "g" global (finditer/sub), "y" sticky (re.match anchors at the start).

const WORD = "\\p{L}\\p{N}_";
const SPACE = "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u{1680}\\u{2000}-\\u{200a}\\u{2028}\\u{2029}\\u{202f}\\u{205f}\\u{3000}";
const BOUNDARY = `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`;
const NOT_BOUNDARY = `(?:(?<=[${WORD}])(?=[${WORD}])|(?<![${WORD}])(?![${WORD}]))`;
const SYNTAX = "^$\\.*+?()[]{}|/";
const QUANT = /^\{(\d*)(,?)(\d*)\}/;

export class UnsupportedRegex extends Error {}

function escapeOutside(c: string): string {
  if (/[A-Za-z0-9]/.test(c)) throw new UnsupportedRegex(`unsupported escape \\${c}`);
  return SYNTAX.includes(c) ? `\\${c}` : c === "-" ? "-" : c;
}

// Returns [translated text, whether it is a set that a following "-" must not form a range with].
function classEscape(c: string): [string, boolean] {
  switch (c) {
    case "w":
      return [WORD, true];
    case "d":
      return ["\\p{Nd}", true];
    case "D":
      return ["\\P{Nd}", true];
    case "s":
      return [SPACE, true];
    case "b":
      return ["\\x08", false];
    case "n":
    case "t":
    case "r":
    case "f":
    case "v":
      return [`\\${c}`, false];
    case "W":
    case "S":
    case "B":
      throw new UnsupportedRegex(`\\${c} inside a character class`);
    default:
      if (/[A-Za-z0-9]/.test(c)) throw new UnsupportedRegex(`unsupported escape \\${c}`);
      return [SYNTAX.includes(c) || c === "-" ? `\\${c}` : c, false];
  }
}

const DOTTED_I = "iI\\u{130}\\u{131}";

export function translate(source: string, flagIgnoreCase = false): { source: string; ignoreCase: boolean } {
  let out = "";
  let ignoreCase = flagIgnoreCase;
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === "\\") {
      const d = source[i + 1];
      if (d === undefined) throw new UnsupportedRegex("trailing backslash");
      i += 2;
      switch (d) {
        case "w":
          out += `[${WORD}]`;
          break;
        case "W":
          out += `[^${WORD}]`;
          break;
        case "d":
          out += "\\p{Nd}";
          break;
        case "D":
          out += "\\P{Nd}";
          break;
        case "s":
          out += `[${SPACE}]`;
          break;
        case "S":
          out += `[^${SPACE}]`;
          break;
        case "b":
          out += BOUNDARY;
          break;
        case "B":
          out += NOT_BOUNDARY;
          break;
        case "A":
          out += "^";
          break;
        case "Z":
          out += "$";
          break;
        case "n":
        case "t":
        case "r":
        case "f":
        case "v":
          out += `\\${d}`;
          break;
        case "x": {
          out += `\\x${source.slice(i, i + 2)}`;
          i += 2;
          break;
        }
        case "u": {
          if (source[i] === "{") {
            // Not Python syntax: lets TS sources spell code points without literal characters.
            const end = source.indexOf("}", i);
            out += `\\u${source.slice(i, end + 1)}`;
            i = end + 1;
            break;
          }
          out += `\\u{${source.slice(i, i + 4)}}`;
          i += 4;
          break;
        }
        case "U": {
          out += `\\u{${source.slice(i, i + 8).replace(/^0+(?=.)/, "")}}`;
          i += 8;
          break;
        }
        default:
          if (/[1-9]/.test(d)) out += `\\${d}`;
          else out += escapeOutside(d);
      }
      continue;
    }
    if (c === "[") {
      i++;
      let cls = "[";
      if (source[i] === "^") {
        cls += "^";
        i++;
      }
      let first = true;
      let afterSet = false;
      for (;;) {
        if (i >= n) throw new UnsupportedRegex("unterminated character set");
        const ch = source[i];
        if (ch === "]" && !first) {
          i++;
          break;
        }
        first = false;
        if (ch === "\\") {
          const d = source[i + 1];
          if (d === undefined) throw new UnsupportedRegex("trailing backslash");
          i += 2;
          if (d === "x") {
            cls += `\\x${source.slice(i, i + 2)}`;
            i += 2;
            afterSet = false;
          } else if (d === "u") {
            if (source[i] === "{") {
              const end = source.indexOf("}", i);
              cls += `\\u${source.slice(i, end + 1)}`;
              i = end + 1;
            } else {
              cls += `\\u{${source.slice(i, i + 4)}}`;
              i += 4;
            }
            afterSet = false;
          } else if (d === "U") {
            cls += `\\u{${source.slice(i, i + 8).replace(/^0+(?=.)/, "")}}`;
            i += 8;
            afterSet = false;
          } else {
            const [text, isSet] = classEscape(d);
            cls += text;
            afterSet = isSet;
          }
          continue;
        }
        if (ch === "]") cls += "\\]";
        else if (ch === "-" && afterSet) cls += "\\-";
        else if (ch === "[") cls += "\\[";
        else if (ignoreCase && (ch === "i" || ch === "I")) cls += DOTTED_I;
        else cls += ch;
        afterSet = false;
        i++;
      }
      out += cls + "]";
      continue;
    }
    if (c === "(" && source[i + 1] === "?") {
      const rest = source.slice(i + 2);
      if (rest.startsWith("P<")) {
        const end = rest.indexOf(">");
        out += `(?<${rest.slice(2, end)}>`;
        i += 2 + end + 1;
      } else if (rest.startsWith("P=")) {
        const end = rest.indexOf(")");
        out += `\\k<${rest.slice(2, end)}>`;
        i += 2 + end + 1;
      } else if (/^(?::|=|!|<=|<!)/.test(rest)) {
        out += "(?";
        i += 2;
      } else if (rest.startsWith("i)") && i === 0) {
        ignoreCase = true;
        i += 4;
      } else {
        throw new UnsupportedRegex(`unsupported group syntax (?${rest.slice(0, 2)}`);
      }
      continue;
    }
    if (c === "{") {
      const m = QUANT.exec(source.slice(i));
      if (m && (m[1] || m[3])) {
        out += `{${m[1] || "0"}${m[2]}${m[3]}}`;
        i += m[0].length;
        if (source[i] === "+") throw new UnsupportedRegex("possessive quantifier");
      } else {
        out += "\\{";
        i++;
      }
      continue;
    }
    if (c === "}") {
      out += "\\}";
      i++;
      continue;
    }
    if (c === "]") {
      out += "\\]";
      i++;
      continue;
    }
    if (c === ".") {
      out += "[^\\n]";
      i++;
      continue;
    }
    if (c === "$") {
      out += "(?=\\n?$)";
      i++;
      continue;
    }
    if ((c === "*" || c === "+" || c === "?") && source[i + 1] === "+") throw new UnsupportedRegex("possessive quantifier");
    out += ignoreCase && (c === "i" || c === "I") ? `[${DOTTED_I}]` : c;
    i++;
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

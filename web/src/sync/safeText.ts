// Text that came from an email or a link, made safe to put in one line of something else (a mail header, a calendar entry).

// Control characters, line and paragraph separators, and the invisible characters that reorder or hide text (bidi controls, zero-width
// and joiner characters, the soft hyphen, interlinear annotation marks).
const UNSAFE_CLASS = "[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u061c\\u2028\\u2029\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff\\ufff9-\\ufffb]";
const UNSAFE = new RegExp(UNSAFE_CLASS, "g");
const HAS_UNSAFE = new RegExp(UNSAFE_CLASS);

/** True when the text holds a character that oneLine would turn into a space: a control, a line separator or an invisible character. */
export const hasUnsafeChars = (text: string): boolean => HAS_UNSAFE.test(text);

/**
 * One line of at most `max` characters (whole characters, never half of an emoji): line breaks and other control or invisible
 * characters become spaces, runs of spaces become one, and the ends are trimmed. Anything that isn't text gives "".
 */
export function oneLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("").trimEnd() : text;
}

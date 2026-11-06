import { describe, expect, it } from "vitest";
import { ActionError } from "../../src/db/errors";
import { hasUnsafeChars, oneLine } from "../../src/sync/safeText";
import { cleanViewName } from "../../src/sync/savedViews";

// Everything that can hide, reorder or break text: a control, a line separator, a bidi control, a zero-width or joiner character,
// the soft hyphen, the interlinear annotation marks.
const HIDDEN = ["\u0000", "\u001f", "\u007f", "\u009f", "­", "؜", " ", " ", "​", "‏", "‪", "‮", "⁠", "⁢", "⁤", "⁦", "⁩", "﻿", "￹", "￻"];

describe("oneLine", () => {
  it.each(HIDDEN)("turns U+%s into a space", (ch) => {
    expect(oneLine(`a${ch}b`, 20)).toBe("a b");
  });

  it("keeps ordinary text, accents, emoji and other scripts as they are", () => {
    for (const text of ["Acme & Sons", "Café résumé", "太郎 山田", "Rocket 🚀 Labs", "O'Brien-Lee"]) expect(oneLine(text, 40)).toBe(text);
  });

  it("cuts to whole characters and squeezes spaces", () => {
    expect(oneLine("  a \n\t b  ", 20)).toBe("a b");
    expect(oneLine("🚀🚀🚀", 2)).toBe("🚀🚀");
    expect(oneLine(42, 5)).toBe("");
  });
});

describe("hasUnsafeChars", () => {
  it("is the same list oneLine uses, and doesn't remember the last answer", () => {
    for (const ch of HIDDEN) expect(hasUnsafeChars(`a${ch}b`), JSON.stringify(ch)).toBe(true);
    // a regular expression with the g flag would answer true, then false, for the same text
    for (let i = 0; i < 4; i++) expect(hasUnsafeChars("a​b")).toBe(true);
    expect(hasUnsafeChars("plain text, with punctuation: ok")).toBe(false);
  });

  it("is what keeps a saved view's name plain text", () => {
    for (const ch of ["⁠", "­", "؜", "￹", "​", "‮"]) {
      expect(() => cleanViewName(`My${ch}view`), JSON.stringify(ch)).toThrow(ActionError);
    }
    expect(cleanViewName("My view")).toBe("My view");
  });
});

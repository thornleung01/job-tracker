// Python `re` vs JS RegExp: the differences the translator exists for. (The golden file covers ~370 more.)
import { describe, expect, it } from "vitest";
import { py, pyFull, match, search, sub, translate, UnsupportedRegex } from "../../src/pipeline/pyre";
import { loadRules } from "../../src/pipeline/rules";
import { capitalize, casefold, fold, quote } from "../../src/pipeline/pystr";

const found = (src: string, text: string, flags = "") => search(py(src, flags), text)?.[0] ?? null;

describe("Unicode-aware classes", () => {
  it("\\w matches accented and non-Latin letters", () => expect(found(String.raw`\w+`, "caf\u{e9} \u{4f8b}")).toBe("caf\u{e9}"));
  it("\\b does not break inside an accented word", () => {
    expect(found(String.raw`\bunsubscribe\b`, "x \u{e9}unsubscribe\u{e9}")).toBeNull();
    expect(found(String.raw`\bunsubscribe\b`, "x unsubscribe!")).toBe("unsubscribe");
  });
  it("\\d matches other scripts' digits", () => expect(found(String.raw`\d+`, "\u{661}\u{662}\u{663}")).toBe("\u{661}\u{662}\u{663}"));
  it("\\s covers Python's whitespace, not the BOM", () => {
    expect(found(String.raw`\s+`, "a\u{1c}\u{85}\u{a0}\u{3000}b")).toBe("\u{1c}\u{85}\u{a0}\u{3000}");
    expect(found(String.raw`\s+`, "a\u{feff}b")).toBeNull();
  });
  it("\\w inside a class, and a literal hyphen after it", () => expect(found(String.raw`[\w-]+`, "a-b_c d")).toBe("a-b_c"));
  it("\\B", () => expect(found(String.raw`\Bx\B`, "axa")).toBe("x"));
});

describe("dot, anchors and \\Z", () => {
  it(". stops at \\n only", () => {
    expect(found("a.b", "a\rb")).toBe("a\rb");
    expect(found("a.b", "a\u{2028}b")).toBe("a\u{2028}b");
    expect(found("a.b", "a\nb")).toBeNull();
  });
  it(". is one code point", () => expect(found("a.b", "a\u{1f680}b")).toBe("a\u{1f680}b"));
  it("$ also matches before a final newline", () => {
    expect(found("end$", "the end\n")).toBe("end");
    expect(found("end$", "the end\n\n")).toBeNull();
  });
  it("\\Z only at the very end", () => {
    expect(found(String.raw`end\Z`, "the end\n")).toBeNull();
    expect(found(String.raw`end\Z`, "the end")).toBe("end");
  });
  it("fullmatch needs the whole string", () => {
    expect(match(pyFull("a|ab"), "ab")?.[0]).toBe("ab");
    expect(match(pyFull("jobs?", "i"), "jobsx")).toBeNull();
    expect(match(pyFull("jobs?", "i"), "jobs\n")).toBeNull();
  });
  it("re.match anchors at the start", () => {
    expect(match(py("b", "y"), "ab")).toBeNull();
    expect(match(py("a", "y"), "ab")?.[0]).toBe("a");
  });
});

describe("syntax differences", () => {
  it("named groups and back references", () => {
    expect(search(py(String.raw`(?P<a>\w+)@(?P<b>\w+)`), "pat@acme")?.groups).toMatchObject({ a: "pat", b: "acme" });
    expect(found("(?P<a>x)(?P=a)", "xx")).toBe("xx");
  });
  it("(?i) at the start", () => expect(found("(?i)hello", "HeLLo")).toBe("HeLLo"));
  it("{ and } and ] are literal when they are not a quantifier", () => {
    expect(found("a{b", "a{b")).toBe("a{b");
    expect(found("x{}", "x{}")).toBe("x{}");
    expect(found("a]", "a]")).toBe("a]");
  });
  it("{,n} means up to n", () => expect(found("a{,2}b", "aaab")).toBe("aab"));
  it("a leading ] in a class is a literal", () => expect(found("[]a]+", "]a]")).toBe("]a]"));
  it("code point escapes", () => {
    expect(found(String.raw`é`, "\u{e9}")).toBe("\u{e9}");
    expect(found(String.raw`[\U0001F680-\U0001F6FF]`, "x\u{1f680}")).toBe("\u{1f680}");
  });
  it("escaped punctuation that is not a JS escape", () => {
    expect(found(String.raw`\ \#\&\~\-\'`, " #&~-'")).toBe(" #&~-'");
  });
  it("unsupported constructs fail loudly", () => {
    expect(() => translate("a*+")).toThrow(UnsupportedRegex);
    expect(() => translate("(?>a)")).toThrow(UnsupportedRegex);
    expect(() => translate("(?s:a)")).toThrow(UnsupportedRegex);
    expect(() => translate(String.raw`\a`)).toThrow(UnsupportedRegex);
    expect(() => translate("[a")).toThrow(UnsupportedRegex);
  });
});

describe("case-insensitive and sub", () => {
  it("accented letters fold", () => expect(found("caf\u{e9}", "CAF\u{c9}", "i")).toBe("CAF\u{c9}"));
  it("sub replaces every match", () => expect(sub(py(String.raw`\s+`, "g"), " ", "a  b\t\nc\u{a0}d")).toBe("a b c d"));
  it("sub on a global regex can be reused", () => {
    const re = py("x", "g");
    expect(sub(re, "y", "xx")).toBe("yy");
    expect(sub(re, "y", "xx")).toBe("yy");
  });
});

describe("rules.yaml patterns survive translation", () => {
  const rules = loadRules();
  it("compiles every pattern and keeps the original text for reasons", () => {
    const all = [...rules.excludeSender, ...rules.excludeSubject, ...rules.negatedOffers, ...rules.conditionals, ...Object.values(rules.strong).flat(), ...Object.values(rules.weak).flat()];
    expect(all.length).toBeGreaterThan(80);
    expect(all.every((re) => re.flags.includes("i") && re.flags.includes("u"))).toBe(true);
  });
  it("the email-domain exclusion ends at the address", () => {
    expect(rules.excludeSender[0].test("digest@mail.substack.com")).toBe(true);
    expect(rules.excludeSender[0].test("a@substack.com.evil.io")).toBe(false);
  });
  it("a negated offer sentence", () => expect(rules.negatedOffers[0].test("We're unfortunately not able to extend an offer")).toBe(true));
});

describe("string helpers", () => {
  it("casefold is full case folding", () => {
    expect(casefold("Stra\u{df}e")).toBe("strasse");
    expect(casefold("\u{3a3}\u{3af}\u{3c3}\u{3c5}\u{3c6}\u{3bf}\u{3c2}")).toBe("\u{3c3}\u{3af}\u{3c3}\u{3c5}\u{3c6}\u{3bf}\u{3c3}");
  });
  it("fold drops Latin accents and anything that is not a letter or digit", () => {
    expect(fold("Caf\u{e9}!")).toBe("cafe");
    expect(fold("Zo\u{eb} & Co.")).toBe("zoeco");
    expect(fold("\u{4f8b}\u{3048}-1")).toBe("\u{4f8b}\u{3048}1");
  });
  it("capitalize titlecases the first character and lowercases the rest", () => {
    expect(capitalize("jOHN.doe")).toBe("John.doe");
    expect(capitalize("\u{df}x")).toBe("Ssx");
    expect(capitalize("")).toBe("");
  });
  it("quote matches urllib.parse.quote", () => {
    expect(quote("a b/c?d=e&f")).toBe("a%20b/c%3Fd%3De%26f");
    expect(quote("caf\u{e9}~-_.")).toBe("caf%C3%A9~-_.");
  });
});

// translate() is a loop over small readers (escape, set, group opener, brace, plain character). These pin each
// reader's exact output, taken from the one-function version they replaced.
describe("translate, one construct at a time", () => {
  const out = (src: string, ignoreCase = false) => translate(src, ignoreCase).source;

  describe("numeric escapes read the same inside and outside a set", () => {
    it.each([
      [String.raw`\x41`, String.raw`\x41`],
      ["\\u00e9", "\\u{00e9}"],
      [String.raw`\u{1F680}`, String.raw`\u{1F680}`],
      [String.raw`\U0001F680`, String.raw`\u{1F680}`],
      [String.raw`\U00000041`, String.raw`\u{41}`],
    ])("%s", (src, expected) => {
      expect(out(src)).toBe(expected);
      expect(out(`[${src}]`)).toBe(`[${expected}]`);
    });
  });

  describe("escapes outside a set", () => {
    it("shorthands and anchors", () => {
      expect(out(String.raw`\A\Z`)).toBe("^$");
      expect(out(String.raw`\d\D`)).toBe(String.raw`\p{Nd}\P{Nd}`);
      expect(out(String.raw`\n\t\r\f\v`)).toBe(String.raw`\n\t\r\f\v`);
      expect(out(String.raw`\1`)).toBe(String.raw`\1`);
    });
    it("punctuation: JS syntax characters keep their backslash, the rest lose it", () => expect(out(String.raw`\.\/\-\#`)).toBe(String.raw`\.\/-#`));
    it("an unknown letter, or a backslash at the end, fails loudly", () => {
      expect(() => out(String.raw`\a`)).toThrow("unsupported escape \\a");
      expect(() => out("\\")).toThrow("trailing backslash");
    });
  });

  describe("sets", () => {
    it("a hyphen after \\d or \\w is literal, after anything else it is a range", () => {
      expect(out(String.raw`[\d-z]`)).toBe(String.raw`[\p{Nd}\-z]`);
      expect(out(String.raw`[\w-]`)).toBe(String.raw`[\p{L}\p{N}_\-]`);
      expect(out("[a-z]")).toBe("[a-z]");
    });
    it("a hyphen after a numeric escape is still a range", () => expect(out(String.raw`[\x41-\x5a]`)).toBe(String.raw`[\x41-\x5a]`));
    it("\\b is backspace in a set", () => expect(out(String.raw`[\b]`)).toBe(String.raw`[\x08]`));
    it("a leading ] is a member, a [ is escaped", () => {
      expect(out("[]a]")).toBe(String.raw`[\]a]`);
      expect(out("[^]a]")).toBe(String.raw`[^\]a]`);
      expect(out("[a[b]")).toBe(String.raw`[a\[b]`);
    });
    it("ignore case adds the dotted and dotless i to every i in a set", () => {
      expect(out("[ab-i]", true)).toBe(String.raw`[ab-iI\u{130}\u{131}]`);
      expect(out("[x]", false)).toBe("[x]");
    });
    it("fails on \\W \\S \\B, a bad escape, a trailing backslash, or no closing bracket", () => {
      expect(() => out(String.raw`[\W]`)).toThrow("inside a character class");
      expect(() => out(String.raw`[\a]`)).toThrow("unsupported escape \\a");
      expect(() => out("[\\")).toThrow("trailing backslash");
      expect(() => out("[a")).toThrow("unterminated character set");
    });
  });

  describe("group openers", () => {
    it("named groups and back references", () => expect(out("(?P<n>a)(?P=n)")).toBe(String.raw`(?<n>a)\k<n>`));
    it("non-capturing and look-around groups pass through", () => expect(out("(?:a)(?=b)(?!c)(?<=d)(?<!e)")).toBe("(?:a)(?=b)(?!c)(?<=d)(?<!e)"));
    it("(?i) at the start turns on ignore case and writes nothing", () => {
      expect(translate("(?i)x")).toEqual({ source: "x", ignoreCase: true });
      expect(translate("(?i)i")).toEqual({ source: "[iI\\u{130}\\u{131}]", ignoreCase: true });
    });
    it("(?i) anywhere else, and other inline flags, fail loudly", () => {
      expect(() => out("x(?i)")).toThrow("unsupported group syntax");
      expect(() => out("(?s)a")).toThrow("unsupported group syntax");
    });
  });

  describe("braces and plain characters", () => {
    it("counted quantifiers, with {,n} as {0,n}", () => {
      expect(out("a{2}")).toBe("a{2}");
      expect(out("a{2,}")).toBe("a{2,}");
      expect(out("a{2,3}")).toBe("a{2,3}");
      expect(out("a{,3}")).toBe("a{0,3}");
    });
    it("a brace that is not a quantifier is literal", () => {
      expect(out("a{}")).toBe(String.raw`a\{\}`);
      expect(out("a{,}")).toBe(String.raw`a\{,\}`);
      expect(out("a}")).toBe(String.raw`a\}`);
      expect(out("a]")).toBe(String.raw`a\]`);
    });
    it("a possessive quantifier fails loudly, counted or not", () => {
      for (const src of ["a{2}+", "a++", "a?+", "a*+"]) expect(() => out(src)).toThrow("possessive quantifier");
    });
    it(". and $", () => expect(out("a.b$")).toBe("a[^\\n]b(?=\\n?$)"));
    it("ignore case widens i outside a set", () => expect(out("i", true)).toBe(String.raw`[iI\u{130}\u{131}]`));
  });
});

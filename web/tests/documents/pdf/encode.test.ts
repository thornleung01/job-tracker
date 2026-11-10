import { describe, expect, it } from "vitest";
import { isWinAnsi, sanitiseSections, toWinAnsi } from "../../../src/documents/pdf/encode";
import { bullet, item, org, section } from "./fixtures";

describe("toWinAnsi", () => {
  it("leaves ASCII, Latin-1, curly quotes, dashes and the bullet alone", () => {
    const s = "Café Zoë “quoted” ‘x’ a – b — c • €5 … ñ ü";
    expect(toWinAnsi(s)).toEqual({ text: s, replaced: false });
  });

  it("turns odd spaces into spaces and drops invisible characters without flagging", () => {
    expect(toWinAnsi("a b c\td​e﻿")).toEqual({ text: "a b c de", replaced: false });
  });

  it("keeps newlines and normalises CRLF", () => {
    expect(toWinAnsi("a\r\nb\rc\nd").text).toBe("a\nb\nc\nd");
  });

  it("swaps look-alikes for the closest character and says so", () => {
    expect(toWinAnsi("a‑b − ●")).toEqual({ text: "a-b - •", replaced: true });
    expect(toWinAnsi("Łódź")).toEqual({ text: "Lódz", replaced: true });
    expect(toWinAnsi("Kraków ā")).toEqual({ text: "Kraków a", replaced: true });
  });

  it("replaces emoji with one question mark each and non-Latin scripts with question marks", () => {
    expect(toWinAnsi("Great \u{1F600}!")).toEqual({ text: "Great ?!", replaced: true });
    expect(toWinAnsi("日本")).toEqual({ text: "??", replaced: true });
  });

  it("only ever outputs characters the standard fonts can draw", () => {
    const wild = "\u0000\u0007\u007f\u0085 \u{1F680} 中 а ✓ ́ x̀ \ud800";
    for (const ch of toWinAnsi(wild).text) expect(ch === "\n" || isWinAnsi(ch)).toBe(true);
  });
});

describe("sanitiseSections", () => {
  it("cleans headings, text, labels and right values, and keeps ids and kinds", () => {
    const secs = [section("Skills ✓", org("Café \u{1F600}", "Zürich 日"), bullet("L‑x", "ok"))];
    const out = sanitiseSections(secs);
    expect(out.replacedChars).toBe(true);
    expect(out.sections[0].heading).toBe("Skills ?");
    expect(out.sections[0].items[0]).toMatchObject({ text: "Café ?", right: "Zürich ?", kind: "org", id: secs[0].items[0].id });
    expect(out.sections[0].items[1]).toMatchObject({ label: "L-x", kind: "bullet" });
  });

  it("reports nothing replaced for clean text and does not change the input", () => {
    const secs = [section("Skills", item("SQL"))];
    const copy = JSON.stringify(secs);
    expect(sanitiseSections(secs).replacedChars).toBe(false);
    expect(JSON.stringify(secs)).toBe(copy);
  });
});

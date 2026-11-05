// providers/headers.ts stands in for Python's email.utils.parseaddr and email.header. The golden parity test
// (tests/pipeline/parity.test.ts, "parseAddress" and "decodeMimeWords") covers the headers real mail has. This file pins
// the inputs where the port reads a header differently on purpose, so a change there is a decision and not an accident.
import { describe, expect, it } from "vitest";
import { base64ToBytes, decodeMimeWords, isBulk, parseAddress } from "../../src/providers/headers";

describe("parseAddress where it differs from Python's parseaddr", () => {
  it("reads an unquoted comma in the name (parseaddr gives up and returns nothing)", () => {
    expect(parseAddress("Lee, Pat <pat@acme.com>")).toEqual({ name: "Lee, Pat", email: "pat@acme.com" });
  });

  it("keeps a run of spaces inside the name (parseaddr squeezes it to one)", () => {
    expect(parseAddress("  Acme   Careers   <jobs@acme.com>  ")).toEqual({ name: "Acme   Careers", email: "jobs@acme.com" });
  });

  it("takes the first of several addresses (parseaddr returns nothing)", () => {
    expect(parseAddress("Acme <jobs@acme.com>, Beta <hr@beta.com>")).toEqual({ name: "Acme", email: "jobs@acme.com" });
    expect(parseAddress("jobs@acme.com, hr@beta.com")).toEqual({ name: "", email: "jobs@acme.com" });
  });

  it("decodes an encoded name (parseaddr leaves it encoded)", () => {
    expect(parseAddress("=?UTF-8?B?Q2Fmw6kgUmVjcnV0ZW1lbnQ=?= <rh@cafe.fr>")).toEqual({ name: "Café Recrutement", email: "rh@cafe.fr" });
    expect(parseAddress('"=?UTF-8?B?QWNtZSBDYXJlZXJz?=" <jobs@acme.com>')).toEqual({ name: "Acme Careers", email: "jobs@acme.com" });
    expect(parseAddress("=?utf-8?q?Zo=C3=AB_M=C3=BCller?= <zoe@example.com>")).toEqual({ name: "Zoë Müller", email: "zoe@example.com" });
  });

  it("keeps an address-looking name as the name", () => {
    expect(parseAddress("jobs@acme.com <jobs@acme.com>")).toEqual({ name: "jobs@acme.com", email: "jobs@acme.com" });
  });
});

describe("decodeMimeWords where it differs from Python", () => {
  it("joins text glued to an encoded word with no space (Python adds a space)", () => {
    expect(decodeMimeWords("=?UTF-8?B?Zm9v?=bar")).toBe("foobar");
    expect(decodeMimeWords("foo=?UTF-8?B?YmFy?=")).toBe("foobar");
  });

  it("leaves text that is already decoded alone, including a lone =?", () => {
    expect(decodeMimeWords("Café – offer =? ?=")).toBe("Café – offer =? ?=");
  });

  it("leaves a word it can't decode as it was", () => {
    expect(decodeMimeWords("=?UTF-8?B?not base64!?=")).toBe("=?UTF-8?B?not base64!?=");
  });
});

describe("base64ToBytes and isBulk", () => {
  it("reads base64url without padding", () => {
    expect([...base64ToBytes("aGk_")]).toEqual([...new TextEncoder().encode("hi?")]);
    expect([...base64ToBytes("aGk")]).toEqual([...new TextEncoder().encode("hi")]);
  });

  it("says bulk for a list header or a bulk precedence, and not otherwise", () => {
    expect(isBulk({ "list-unsubscribe": "<mailto:x@y.z>" })).toBe(true);
    expect(isBulk({ "list-id": "<jobs.acme.com>" })).toBe(true);
    for (const p of ["bulk", " LIST ", "junk"]) expect(isBulk({ precedence: p }), p).toBe(true);
    expect(isBulk({ precedence: "first-class" })).toBe(false);
    expect(isBulk({})).toBe(false);
  });
});

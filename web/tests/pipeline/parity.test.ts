// Golden parity: every case in fixtures/pipeline-golden.json came from running the real Python function.
// Regenerate with `python scripts/export_fixtures.py`; the TS port must return exactly the stored `expected`.
import { describe, expect, it } from "vitest";
import goldenText from "../fixtures/pipeline-golden.json?raw";
import type { Message } from "../../src/types";
import {
  classify, extractCompanyRole, findApplication, isAtsDomain, makeLearned, mailboxLink, matchApplication, render, replyLink,
  sameRole, splitSender, stripConditionals, stripNegatedOffers, parts, companyKey, roleKey,
} from "../../src/pipeline";
import { blocks, inline, joins } from "../../src/pipeline/mailtext";
import { cleanRole, cleanValue, linkedinRole, senderCompany, tidy } from "../../src/pipeline/extract";
import { words } from "../../src/pipeline/match";
import { py, pyFull, match, search, sub } from "../../src/pipeline/pyre";
import { capitalize, casefold, cpHead, cpLen, escapeHtml, fold, quote, splitWords, strip } from "../../src/pipeline/pystr";
import { UrlValueError, urlHostname } from "../../src/pipeline/url";

interface Case {
  input: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  expected: unknown;
}
const golden = JSON.parse(goldenText) as { messages: Message[]; meta: { counts: Record<string, number> }; cases: Record<string, Case[]> };

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Runs every golden case of one function; fails listing the first mismatches. */
function parity(name: string, fn: (input: any) => unknown | Promise<unknown>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const cases = golden.cases[name] ?? [];
  it(`${name}: ${cases.length} cases`, async () => {
    expect(cases.length).toBeGreaterThan(0);
    const bad: unknown[] = [];
    for (const c of cases) {
      let actual: unknown;
      try {
        actual = await fn(c.input);
      } catch (e) {
        actual = { thrown: String(e) };
      }
      if (!deepEqual(actual, c.expected)) bad.push({ input: JSON.stringify(c.input).slice(0, 300), expected: c.expected, actual });
      if (bad.length >= 5) break;
    }
    expect(bad).toEqual([]);
  });
}

const msg = (i: number): Message => golden.messages[i];

/** "Name <addr>" the way the Python tests build senders. */
function fromSender(sender: string): Message {
  const [name, , addr] = [sender.split("<")[0], "", sender.includes("<") ? sender.split("<").slice(1).join("<") : ""];
  return {
    id: "m1", threadId: "t1", senderName: name.trim(), senderEmail: (addr ? addr.replace(/>+$/, "") : name).trim(),
    subject: "s", receivedAt: "2026-10-01T12:00:00.000Z", body: "",
  };
}

const matchJson = (m: RegExpExecArray | null) =>
  m === null ? null : { match: m[0], groups: m.slice(1).map((g) => g ?? null), named: Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, v ?? null])) };

describe("golden parity with the Python pipeline", () => {
  it("fixture file is present and sizeable", () => {
    const total = Object.values(golden.meta.counts).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(500);
  });

  describe("classify.py", () => {
    parity("classify", (i) => classify(msg(i.msg), i.learned ? makeLearned(i.learned) : null));
    parity("stripConditionals", (t) => stripConditionals(t));
    parity("stripNegatedOffers", (t) => stripNegatedOffers(t));
    parity("isAtsDomain", (d) => isAtsDomain(d));
  });

  describe("extract.py", () => {
    parity("extractCompanyRole", (i) => extractCompanyRole(msg(i)));
    parity("senderCompany", (i) => senderCompany(msg(i)));
    parity("tidy", (t) => tidy(t));
    parity("cleanValue", (i) => cleanValue(i.value, i.limit));
    parity("cleanRole", (r) => cleanRole(r));
    parity("linkedinRole", (i) => linkedinRole(fromSender(i.sender), i.body, i.company));
    parity("companyKey", (n) => companyKey(n));
    parity("roleKey", (n) => roleKey(n));
    parity("fold", (n) => fold(n));
  });

  describe("mailtext.py", () => {
    parity("blocks", (b) => blocks(b));
    parity("parts", (b) => parts(b));
    parity("render", (b) => render(b));
    parity("inline", (t) => inline(t));
    parity("joins", ([a, b]) => joins(a, b));
    parity("splitSender", (s) => splitSender(s));
    parity("urlHostname", (u) => {
      try {
        return { host: urlHostname(u) };
      } catch (e) {
        if (e instanceof UrlValueError) return { error: true };
        throw e;
      }
    });
  });

  describe("match.py", () => {
    parity("sameRole", (i) => sameRole(i.aKey, i.bKey, i.aRole, i.bRole));
    parity("words", (r) => words(r));
    const toResult = (m: { kind: string; applicationId: unknown }) => ({ kind: m.kind, applicationId: m.applicationId });
    parity("findApplication", async (i) => {
      const apps = i.applications;
      const thread = i.threadId ? i.threadApplicationId : null;
      const store = { threadApplication: () => thread, applicationsFor: () => apps };
      const viaStore = toResult(await findApplication(store, i.threadId, i.ckey, i.rkey, i.event, i.role));
      // the async store API and the pure core must agree
      const direct = toResult(matchApplication(thread, apps, i.ckey, i.rkey, i.event, i.role));
      return deepEqual(viaStore, direct) ? direct : { mismatch: [viaStore, direct] };
    });
  });

  describe("links.py", () => {
    parity("mailboxLink", (i) => mailboxLink(i.provider, i.address, i.threadId, i.webLink));
    parity("replyLink", (i) => replyLink(i.provider, i.account, i.sender, i.subject, i.webLink));
  });

  describe("Python str helpers", () => {
    parity("casefold", (s) => casefold(s));
    parity("capitalize", (s) => capitalize(s));
    parity("pyLower", (s) => s.toLowerCase());
    parity("quote", (s) => quote(s));
    parity("quoteNoSafe", (s) => quote(s, ""));
    parity("escapeHtml", (s) => escapeHtml(s));
    parity("strip", (s) => strip(s));
    parity("splitWords", (s) => splitWords(s));
    parity("cpLen", (s) => cpLen(s));
    parity("cpHead", (i) => cpHead(i.s, i.n));
  });

  describe("regex translation (Python re semantics)", () => {
    parity("regexSearch", (i) => matchJson(search(py(i.source, i.flags), i.text)));
    parity("regexMatch", (i) => matchJson(match(py(i.source, i.flags + "y"), i.text)));
    parity("regexFullmatch", (i) => matchJson(match(pyFull(i.source, i.flags), i.text)));
    parity("regexSplit", (i) => i.text.split(py(i.source, i.flags)));
    parity("regexSub", (i) => sub(py(i.source, i.flags), i.repl, i.text));
  });

  it("every golden function has a parity test above", () => {
    expect(Object.keys(golden.cases).sort()).toEqual(Object.keys(golden.meta.counts).sort());
  });
});

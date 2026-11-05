// The import validator on its own, with no database: every rule that refuses a file, and the fields it cuts or drops
// instead. portability.test.ts covers the same code through importAll, so this file only needs hand-made rows.
import { describe, expect, it } from "vitest";
import { EXPORT_FORMAT, EXPORT_VERSION, ImportError } from "../../src/portability";
import { parseEnvelope, parseExportData } from "../../src/portability/validate";

const T = "2026-10-01T09:00:00Z";
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** One of everything, each row valid and pointing at the others. */
function data(): Any {
  return {
    accounts: [{ id: 1, provider: "gmail", address: "me@gmail.com", lastSync: T, lastError: null, active: true }],
    applications: [{ id: 1, company: "Acme", companyKey: "acme", role: "Analyst", roleKey: "analyst", stage: "Applied", stageAt: T, appliedAt: T, lastActivity: T, locked: false, manual: false }],
    emails: [{ id: 1, accountId: 1, providerMsgId: "m1", threadId: "t1", receivedAt: T, sender: "a <a@b.co>", subject: "s", body: "b", related: true, event: "applied", confidence: "high", applicationId: 1, needsReview: false, webLink: null, bulk: false, hold: false, reason: null }],
    activity: [{ id: 1, applicationId: 1, kind: "note", label: null, body: "hi", occurredAt: T, createdAt: T }],
    feedback: [{ id: 1, createdAt: T, verdict: "not_job", senderEmail: "a@b.co", senderDomain: "b.co", subject: "s", reason: "r", applicationId: 1 }],
    ignoredMail: [{ id: 1, accountId: 1, providerMsgId: "i1", threadId: null, receivedAt: T, sender: "x", subject: "s", body: "b", webLink: null, reason: "r", createdAt: T, bulk: false }],
    learnedRules: [{ id: 1, kind: "block_sender", value: "a@b.co", evidence: 1, active: true, createdAt: T }],
    contactEdits: [{ key: "1|a@b.co", name: "Sam", title: "Recruiter", hidden: false }],
    settings: {},
  };
}

/** The problems the validator reports for data changed by `mutate`. */
function problems(mutate: (d: Any) => void): string[] {
  const d = data();
  mutate(d);
  try {
    parseExportData(d);
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    return (e as ImportError).problems;
  }
  throw new Error("the data was accepted");
}

it("accepts the hand-made data, so each refusal below is about the one thing changed", () => {
  const out = parseExportData(data());
  expect(out.applications).toHaveLength(1);
  expect(out.emails[0]).toMatchObject({ event: "applied", confidence: "high", applicationId: 1 });
  expect(out.learnedRules[0].evidence).toBe(1);
});

describe("values outside what the app writes are refused with the place and the reason", () => {
  it.each<[string, (d: Any) => void, string]>([
    ["a confidence that is not high, medium or low", (d) => (d.emails[0].confidence = "certain"), "emails #1: confidence must be high, medium or low."],
    ["a confidence that is not text", (d) => (d.emails[0].confidence = 3), "emails #1: confidence must be high, medium or low."],
    ["an activity kind other than note or step", (d) => (d.activity[0].kind = "call"), "activity #1: kind must be note or step."],
    ["a verdict other than job or not_job", (d) => (d.feedback[0].verdict = "maybe"), "feedback #1: verdict must be not_job or job."],
    ["a learned rule of an unknown kind", (d) => (d.learnedRules[0].kind = "block_everyone"), "learnedRules #1: kind is not a known rule kind."],
    ["a negative evidence count", (d) => (d.learnedRules[0].evidence = -1), "learnedRules #1: evidence must be a whole number."],
    ["a fractional evidence count", (d) => (d.learnedRules[0].evidence = 1.5), "learnedRules #1: evidence must be a whole number."],
    ["an evidence count that is text", (d) => (d.learnedRules[0].evidence = "2"), "learnedRules #1: evidence must be a whole number."],
    ["a negative id", (d) => (d.applications[0].id = -4), "applications #1: id must be a whole number."],
    ["an id of zero", (d) => (d.accounts[0].id = 0), "accounts #1: id must be a whole number."],
    ["a fractional id", (d) => (d.emails[0].id = 1.5), "emails #1: id must be a whole number."],
    ["an id that is text", (d) => (d.activity[0].id = "1"), "activity #1: id must be a whole number."],
    ["an id too big to be exact", (d) => (d.feedback[0].id = 2 ** 60), "feedback #1: id must be a whole number."],
    ["a missing id", (d) => delete d.ignoredMail[0].id, "ignoredMail #1: id is missing."],
    ["a flag that is not true or false", (d) => (d.applications[0].locked = "yes"), "applications #1: locked must be true or false."],
    ["a company that is not text", (d) => (d.applications[0].company = 42), "applications #1: company must be text."],
    ["a missing provider message id", (d) => delete d.emails[0].providerMsgId, "emails #1: providerMsgId is missing."],
  ])("%s", (_name, mutate, expected) => {
    expect(problems(mutate)).toContain(expected);
  });

  it("names the row that is wrong, not just the table", () => {
    const found = problems((d) => {
      d.applications.push({ ...d.applications[0], id: 2 }, { ...d.applications[0], id: 3, stage: "Hired" });
    });
    expect(found).toEqual(["applications #3: stage is not one of the six stages."]);
  });
});

describe("text that is too long is cut, never an error", () => {
  it.each<[string, (d: Any) => void, (out: Any) => string, number]>([
    ["an email address on an account", (d) => (d.accounts[0].address = "a".repeat(400)), (o) => o.accounts[0].address, 320],
    ["a provider message id", (d) => (d.emails[0].providerMsgId = "m".repeat(900)), (o) => o.emails[0].providerMsgId, 500],
    ["a thread id", (d) => (d.emails[0].threadId = "t".repeat(900)), (o) => o.emails[0].threadId, 500],
    ["a sender", (d) => (d.emails[0].sender = "s".repeat(1500)), (o) => o.emails[0].sender, 1000],
    ["a subject", (d) => (d.emails[0].subject = "s".repeat(2500)), (o) => o.emails[0].subject, 2000],
    ["a reason", (d) => (d.emails[0].reason = "r".repeat(1500)), (o) => o.emails[0].reason, 1000],
    ["a step label", (d) => (d.activity[0].label = "l".repeat(300)), (o) => o.activity[0].label, 200],
    ["a note", (d) => (d.activity[0].body = "n".repeat(12_000)), (o) => o.activity[0].body, 10_000],
    ["a learned rule value", (d) => (d.learnedRules[0].value = "v".repeat(1500)), (o) => o.learnedRules[0].value, 1000],
    ["a person's name", (d) => (d.contactEdits[0].name = "n".repeat(200)), (o) => o.contactEdits[0].name, 80],
    ["a person's title", (d) => (d.contactEdits[0].title = "t".repeat(200)), (o) => o.contactEdits[0].title, 100],
  ])("%s", (_name, mutate, read, max) => {
    const d = data();
    mutate(d);
    expect(read(parseExportData(d))).toHaveLength(max);
  });
});

describe("fields that are dropped instead of refused", () => {
  it("clears a feedback row's application when it is gone, and keeps the row", () => {
    const d = data();
    d.feedback[0].applicationId = 99;
    expect(parseExportData(d).feedback[0].applicationId).toBeNull();
  });

  it.each([[-1], [21], [1.5], ["3"], [null]])("drops interviewRounds %j", (rounds) => {
    const d = data();
    d.applications[0].interviewRounds = rounds;
    expect(parseExportData(d).applications[0]).not.toHaveProperty("interviewRounds");
  });

  it("keeps a rounds count in range, including zero", () => {
    for (const rounds of [0, 20]) {
      const d = data();
      d.applications[0].interviewRounds = rounds;
      expect(parseExportData(d).applications[0].interviewRounds).toBe(rounds);
    }
  });

  it("drops a posting link that is not a web address", () => {
    const d = data();
    d.applications[0].postingUrl = "javascript:alert(1)";
    expect(parseExportData(d).applications[0]).not.toHaveProperty("postingUrl");
  });

  it("leaves out a settings section that is not an object, and refuses a settings value that is not an object", () => {
    const d = data();
    d.settings = { appearance: "dark", sync: 5 };
    expect(parseExportData(d).settings).toEqual({});
    expect(problems((x) => (x.settings = 5))).toEqual(['"settings" must be an object.']);
  });
});

describe("keys that could poison an object", () => {
  /** JSON.parse makes `__proto__` an own property, unlike an object literal. */
  const hostile = (row: object) => {
    const rest = JSON.stringify(row).slice(1);
    return JSON.parse(`{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}${rest === "}" ? "" : ","}${rest}`);
  };

  it("never copies __proto__ or constructor from a row, and never changes Object.prototype", () => {
    const d = data();
    for (const table of ["accounts", "applications", "emails", "activity", "feedback", "ignoredMail", "learnedRules", "contactEdits"]) d[table] = d[table].map(hostile);
    d.settings = hostile({ appearance: hostile({ theme: "dark" }), sync: hostile({}) });
    const out = parseExportData(d);
    expect(({} as Any).polluted).toBeUndefined();
    for (const rows of Object.values(out).filter(Array.isArray) as object[][]) {
      for (const row of rows) {
        expect(Object.keys(row)).not.toContain("__proto__");
        expect(Object.keys(row)).not.toContain("constructor");
        expect((row as Any).polluted).toBeUndefined();
      }
    }
    expect(JSON.stringify(out.settings)).not.toContain("polluted");
  });
});

describe("the envelope", () => {
  const envelope = (over: Record<string, unknown> = {}) => ({ format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: T, source: "web", data: data(), ...over });

  it("reads a good one, and a version 1 file", () => {
    expect(parseEnvelope(envelope()).source).toBe("web");
    expect(parseEnvelope(envelope({ version: 1 })).data.applications).toHaveLength(1);
  });

  it.each([
    ["another format", { format: "something-else" }],
    ["no format", { format: undefined }],
  ])("refuses %s", (_name, over) => {
    expect(() => parseEnvelope(envelope(over))).toThrow("The file isn't a Job Tracker export.");
  });

  it.each([[0], [-1], [EXPORT_VERSION + 1], ["2"], [null]])("refuses version %j and says which version the app reads", (version) => {
    expect(() => parseEnvelope(envelope({ version }))).toThrow(`this app reads version ${EXPORT_VERSION}`);
  });

  it.each([[null], [5], ["x"], [[]]])("refuses a file that is %j", (raw) => {
    expect(() => parseEnvelope(raw)).toThrow(ImportError);
  });

  it("defaults the source and the time when they are missing or not text", () => {
    const out = parseEnvelope(envelope({ source: 7, exportedAt: undefined }));
    expect([out.source, out.exportedAt]).toEqual(["web", ""]);
  });
});

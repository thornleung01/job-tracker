// Checks an export before anything is written, so a bad or hostile file can never half-replace your data.
import { BODY_LIMIT } from "../types";
import type { ActivityRow, ApplicationRow, ContactEditRow, EmailRow, FeedbackRow, IgnoredMailRow, LearnedRuleRow, AccountRow, RuleKind } from "../db/schema";
import { isEvent, isStage } from "../db/stages";
import { iso } from "../db/time";
import { sanitizeAppearance, sanitizeSync } from "../sync/settings";
import { truncate } from "../sync/text";
import { EXPORT_FORMAT, EXPORT_VERSION, ImportError, type ExportData } from "./format";

type Rec = Record<string, unknown>;

const MAX_ROWS = 500_000;
const CONFIDENCE = ["high", "medium", "low"];
const RULE_KINDS: RuleKind[] = ["block_sender", "block_domain", "allow_sender", "distrust_pattern"];
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

class Check {
  constructor(readonly problems: string[] = [], private readonly label = "") {}
  fail(message: string): void {
    this.problems.push(`${this.label}${message}`);
  }
  at(label: string): Check {
    return new Check(this.problems, label);
  }
}

function rowsOf(raw: unknown, name: string, c: Check): Rec[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    c.fail(`"${name}" must be a list.`);
    return [];
  }
  if (raw.length > MAX_ROWS) {
    c.fail(`"${name}" has too many rows.`);
    return [];
  }
  const out: Rec[] = [];
  raw.forEach((r, i) => (isRec(r) ? out.push(r) : c.fail(`${name} #${i + 1} is not an object.`)));
  return out;
}

function str(r: Rec, key: string, c: Check, opts: { optional?: boolean; max?: number } = {}): string {
  const v = r[key];
  if (v === undefined || v === null) {
    if (!opts.optional) c.fail(`${key} is missing.`);
    return "";
  }
  if (typeof v !== "string") {
    c.fail(`${key} must be text.`);
    return "";
  }
  return opts.max ? v.slice(0, opts.max) : v;
}

function nullableStr(r: Rec, key: string, c: Check, max = 100_000): string | null {
  const v = r[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") {
    c.fail(`${key} must be text or empty.`);
    return null;
  }
  return v.slice(0, max);
}

function time(r: Rec, key: string, c: Check, optional = false): string | null {
  const v = r[key];
  if (v === undefined || v === null) {
    if (!optional) c.fail(`${key} is missing.`);
    return null;
  }
  if (typeof v !== "string" || Number.isNaN(new Date(v).getTime())) {
    c.fail(`${key} is not a date.`);
    return null;
  }
  return iso(v);
}

function flag(r: Rec, key: string, c: Check): boolean {
  const v = r[key];
  if (v === undefined || v === null) return false;
  if (typeof v !== "boolean") {
    c.fail(`${key} must be true or false.`);
    return false;
  }
  return v;
}

function id(r: Rec, key: string, c: Check, optional = false): number | null {
  const v = r[key];
  if (v === undefined || v === null) {
    if (!optional) c.fail(`${key} is missing.`);
    return null;
  }
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) {
    c.fail(`${key} must be a whole number.`);
    return null;
  }
  return v;
}

function uniqueIds(rows: { id: number }[], name: string, c: Check): void {
  const seen = new Set<number>();
  for (const r of rows) {
    if (seen.has(r.id)) c.fail(`${name} has the id ${r.id} twice.`);
    seen.add(r.id);
  }
}

/** Turns an unknown value into export data, or throws an ImportError listing what is wrong. */
export function parseExportData(raw: unknown): ExportData {
  const c = new Check();
  if (!isRec(raw)) throw new ImportError(["The file is not a Job Tracker export."]);
  const d = raw;

  const accounts: AccountRow[] = [];
  rowsOf(d.accounts, "accounts", c).forEach((r, i) => {
    const k = c.at(`accounts #${i + 1}: `);
    const provider = r.provider;
    if (provider !== "gmail" && provider !== "outlook") k.fail("provider must be gmail or outlook.");
    const rowId = id(r, "id", k);
    const address = str(r, "address", k, { max: 320 });
    if (rowId && (provider === "gmail" || provider === "outlook") && address) {
      accounts.push({ id: rowId, provider, address, lastSync: time(r, "lastSync", k, true), lastError: nullableStr(r, "lastError", k, 1000), active: r.active === undefined ? true : flag(r, "active", k) });
    }
  });

  const applications: ApplicationRow[] = [];
  rowsOf(d.applications, "applications", c).forEach((r, i) => {
    const k = c.at(`applications #${i + 1}: `);
    const rowId = id(r, "id", k);
    const stage = r.stage;
    if (!isStage(stage)) k.fail("stage is not one of the six stages.");
    const company = str(r, "company", k, { max: 200 });
    if (rowId && isStage(stage)) {
      applications.push({
        id: rowId, company, companyKey: str(r, "companyKey", k, { max: 200 }), role: str(r, "role", k, { max: 300 }),
        roleKey: str(r, "roleKey", k, { max: 300 }), stage, stageAt: time(r, "stageAt", k, true), appliedAt: time(r, "appliedAt", k, true),
        lastActivity: time(r, "lastActivity", k, true), locked: flag(r, "locked", k), manual: flag(r, "manual", k),
      });
    }
  });

  const accountIds = new Set(accounts.map((a) => a.id));
  const appIds = new Set(applications.map((a) => a.id));

  const emails: EmailRow[] = [];
  rowsOf(d.emails, "emails", c).forEach((r, i) => {
    const k = c.at(`emails #${i + 1}: `);
    const rowId = id(r, "id", k);
    const accountId = id(r, "accountId", k);
    if (accountId && !accountIds.has(accountId)) k.fail(`accountId ${accountId} is not in accounts.`);
    const applicationId = id(r, "applicationId", k, true);
    if (applicationId && !appIds.has(applicationId)) k.fail(`applicationId ${applicationId} is not in applications.`);
    const event = r.event ?? null;
    if (event !== null && !isEvent(event)) k.fail("event is not a known event.");
    const confidence = r.confidence ?? null;
    if (confidence !== null && !CONFIDENCE.includes(confidence as string)) k.fail("confidence must be high, medium or low.");
    const body = nullableStr(r, "body", k, 1_000_000);
    if (rowId && accountId) {
      emails.push({
        id: rowId, accountId, providerMsgId: str(r, "providerMsgId", k, { max: 500 }), threadId: nullableStr(r, "threadId", k, 500),
        receivedAt: time(r, "receivedAt", k) ?? "", sender: nullableStr(r, "sender", k, 1000), subject: nullableStr(r, "subject", k, 2000),
        body: body === null ? null : truncate(body, BODY_LIMIT), related: flag(r, "related", k),
        event: (event as EmailRow["event"]) ?? null, confidence: (confidence as EmailRow["confidence"]) ?? null, applicationId,
        needsReview: flag(r, "needsReview", k), webLink: nullableStr(r, "webLink", k, 2000), bulk: flag(r, "bulk", k), hold: flag(r, "hold", k),
        reason: nullableStr(r, "reason", k, 1000),
      });
    }
  });

  const activity: ActivityRow[] = [];
  rowsOf(d.activity, "activity", c).forEach((r, i) => {
    const k = c.at(`activity #${i + 1}: `);
    const rowId = id(r, "id", k);
    const applicationId = id(r, "applicationId", k);
    if (applicationId && !appIds.has(applicationId)) k.fail(`applicationId ${applicationId} is not in applications.`);
    if (r.kind !== "note" && r.kind !== "step") k.fail("kind must be note or step.");
    if (rowId && applicationId && (r.kind === "note" || r.kind === "step")) {
      activity.push({
        id: rowId, applicationId, kind: r.kind, label: nullableStr(r, "label", k, 200), body: str(r, "body", k, { optional: true, max: 10_000 }),
        occurredAt: time(r, "occurredAt", k) ?? "", createdAt: time(r, "createdAt", k) ?? "",
      });
    }
  });

  const feedback: FeedbackRow[] = [];
  rowsOf(d.feedback, "feedback", c).forEach((r, i) => {
    const k = c.at(`feedback #${i + 1}: `);
    const rowId = id(r, "id", k);
    if (r.verdict !== "not_job" && r.verdict !== "job") k.fail("verdict must be not_job or job.");
    const applicationId = id(r, "applicationId", k, true);
    if (rowId && (r.verdict === "not_job" || r.verdict === "job")) {
      feedback.push({
        id: rowId, createdAt: time(r, "createdAt", k) ?? "", verdict: r.verdict, senderEmail: str(r, "senderEmail", k, { optional: true, max: 320 }),
        senderDomain: str(r, "senderDomain", k, { optional: true, max: 320 }), subject: str(r, "subject", k, { optional: true, max: 2000 }),
        reason: str(r, "reason", k, { optional: true, max: 1000 }), applicationId: applicationId && appIds.has(applicationId) ? applicationId : null,
      });
    }
  });

  const ignoredMail: IgnoredMailRow[] = [];
  rowsOf(d.ignoredMail, "ignoredMail", c).forEach((r, i) => {
    const k = c.at(`ignoredMail #${i + 1}: `);
    const rowId = id(r, "id", k);
    const accountId = id(r, "accountId", k);
    if (accountId && !accountIds.has(accountId)) k.fail(`accountId ${accountId} is not in accounts.`);
    if (rowId && accountId) {
      ignoredMail.push({
        id: rowId, accountId, providerMsgId: str(r, "providerMsgId", k, { max: 500 }), threadId: nullableStr(r, "threadId", k, 500),
        receivedAt: time(r, "receivedAt", k) ?? "", sender: str(r, "sender", k, { optional: true, max: 1000 }),
        subject: str(r, "subject", k, { optional: true, max: 2000 }), body: truncate(str(r, "body", k, { optional: true, max: 1_000_000 }), BODY_LIMIT),
        webLink: nullableStr(r, "webLink", k, 2000), reason: str(r, "reason", k, { optional: true, max: 1000 }),
        createdAt: time(r, "createdAt", k) ?? "", bulk: flag(r, "bulk", k),
      });
    }
  });

  const learnedRules: LearnedRuleRow[] = [];
  rowsOf(d.learnedRules, "learnedRules", c).forEach((r, i) => {
    const k = c.at(`learnedRules #${i + 1}: `);
    const rowId = id(r, "id", k);
    if (!RULE_KINDS.includes(r.kind as RuleKind)) k.fail("kind is not a known rule kind.");
    const evidence = r.evidence;
    if (typeof evidence !== "number" || !Number.isInteger(evidence) || evidence < 0) k.fail("evidence must be a whole number.");
    if (rowId && RULE_KINDS.includes(r.kind as RuleKind) && typeof evidence === "number") {
      learnedRules.push({
        id: rowId, kind: r.kind as RuleKind, value: str(r, "value", k, { max: 1000 }), evidence, active: flag(r, "active", k),
        createdAt: time(r, "createdAt", k) ?? "",
      });
    }
  });

  const contactEdits: ContactEditRow[] = [];
  rowsOf(d.contactEdits, "contactEdits", c).forEach((r, i) => {
    const k = c.at(`contactEdits #${i + 1}: `);
    const key = str(r, "key", k, { max: 500 });
    if (key && !/^\d+\|\S+$/.test(key)) k.fail("key is not a person key.");
    contactEdits.push({ key, name: nullableStr(r, "name", k, 80), title: nullableStr(r, "title", k, 100), hidden: flag(r, "hidden", k) });
  });

  uniqueIds(accounts, "accounts", c);
  uniqueIds(applications, "applications", c);
  uniqueIds(emails, "emails", c);
  uniqueIds(activity, "activity", c);
  uniqueIds(feedback, "feedback", c);
  uniqueIds(ignoredMail, "ignoredMail", c);
  uniqueIds(learnedRules, "learnedRules", c);
  const unique = <T>(rows: T[], keyOf: (r: T) => string, name: string) => {
    const seen = new Set<string>();
    for (const r of rows) {
      const k = keyOf(r);
      if (seen.has(k)) c.fail(`${name} has a duplicate entry (${k.replace(/\u0000/g, " / ")}).`);
      seen.add(k);
    }
  };
  unique(accounts, (a) => `${a.provider}\u0000${a.address}`, "accounts");
  unique(emails, (e) => `${e.accountId}\u0000${e.providerMsgId}`, "emails");
  unique(ignoredMail, (e) => `${e.accountId}\u0000${e.providerMsgId}`, "ignoredMail");
  unique(learnedRules, (r) => `${r.kind}\u0000${r.value}`, "learnedRules");
  unique(contactEdits, (e) => e.key, "contactEdits");

  const settings: Record<string, unknown> = {};
  if (d.settings !== undefined && !isRec(d.settings)) c.fail('"settings" must be an object.');
  else if (isRec(d.settings)) {
    if (isRec(d.settings.appearance)) settings.appearance = sanitizeAppearance(d.settings.appearance);
    if (isRec(d.settings.sync)) settings.sync = sanitizeSync(d.settings.sync);
  }

  if (c.problems.length) throw new ImportError(c.problems);
  return { accounts, applications, emails, activity, feedback, ignoredMail, learnedRules, contactEdits, settings };
}

/** Checks the envelope (format and version) and the data inside it. */
export function parseEnvelope(raw: unknown): { exportedAt: string; source: string; data: ExportData } {
  if (!isRec(raw) || raw.format !== EXPORT_FORMAT) throw new ImportError(["The file is not a Job Tracker export."]);
  if (typeof raw.version !== "number" || raw.version > EXPORT_VERSION || raw.version < 1) {
    throw new ImportError([`The file is version ${String(raw.version)}, and this app reads version ${EXPORT_VERSION}. Update the app, or export again.`]);
  }
  return {
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
    source: typeof raw.source === "string" ? raw.source : "web",
    data: parseExportData(raw.data),
  };
}

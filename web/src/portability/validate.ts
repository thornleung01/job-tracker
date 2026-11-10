// Checks an export before anything is written, so a bad or hostile file can never half-replace your data.
// One small parser per table (each is a list of the fields it reads, in the order problems are reported), then checks across
// tables: ids are unique, every reference points at a row that is there.
import { BODY_LIMIT } from "../types";
import type { ActivityRow, ApplicationRow, ContactEditRow, DocumentRow, EmailRow, FeedbackRow, IgnoredMailRow, LearnedRuleRow, AccountRow } from "../db/schema";
import { isRecord } from "../db/isRecord";
import { isRuleKind } from "../db/schema";
import { isContactKey } from "../db/contactKey";
import { normalizeSections } from "../db/documentShape";
import { MAX_COMPANY_CHARS, MAX_DOC_TITLE_CHARS, MAX_NAME_CHARS, MAX_POSTING_CHARS, MAX_ROLE_CHARS, MAX_ROUNDS, MAX_TITLE_CHARS } from "../db/limits";
import { safeWebLink } from "../db/mailLink";
import { safeOfferDeadline, safeOfferSalary } from "../db/offer";
import { safePostingUrl } from "../db/postingUrl";
import { isConfidence, isEvent, isStage } from "../db/stages";
import { iso } from "../db/time";
import { isTailored } from "../sync/documents";
import { sanitizeGoal } from "../sync/goal";
import { sanitizeSavedViews } from "../sync/savedViews";
import { sanitizeAppearance, sanitizeSync } from "../sync/settings";
import { truncate } from "../sync/text";
import { EXPORT_FORMAT, EXPORT_VERSION, ImportError, type ExportData } from "./format";

type Rec = Record<string, unknown>;

/** Most rows in one table. A real job search is a few thousand; a file claiming more is hostile or broken, and would be held in memory whole. */
export const MAX_ROWS = 50_000;

/**
 * The longest text each field may hold. What you can type is capped at the same lengths as saving (db/limits.ts: company,
 * role, person name and title); the rest are generous caps so a hostile file can't fill your storage. Longer text is cut,
 * never an error.
 */
const MAX = {
  company: MAX_COMPANY_CHARS, role: MAX_ROLE_CHARS, personName: MAX_NAME_CHARS, personTitle: MAX_TITLE_CHARS,
  address: 320, providerMsgId: 500, threadId: 500, sender: 1000, subject: 2000, reason: 1000, lastError: 1000,
  stepLabel: 200, stepBody: 10_000, ruleValue: 1000, personKey: 500, emailBody: 1_000_000,
} as const;

/** Collects what is wrong, each problem starting with where it is ("emails #3: "). */
class Check {
  constructor(readonly problems: string[] = [], private readonly label = "") {}
  fail(message: string): void {
    this.problems.push(`${this.label}${message}`);
  }
  at(label: string): Check {
    return new Check(this.problems, label);
  }
}

function rowsOf(raw: unknown, name: string, check: Check): Rec[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    check.fail(`"${name}" must be a list.`);
    return [];
  }
  if (raw.length > MAX_ROWS) {
    check.fail(`"${name}" has too many rows.`);
    return [];
  }
  const out: Rec[] = [];
  raw.forEach((r, i) => (isRecord(r) ? out.push(r) : check.fail(`${name} #${i + 1} is not an object.`)));
  return out;
}

function str(r: Rec, key: string, check: Check, opts: { optional?: boolean; max?: number } = {}): string {
  const v = r[key];
  if (v === undefined || v === null) {
    if (!opts.optional) check.fail(`${key} is missing.`);
    return "";
  }
  if (typeof v !== "string") {
    check.fail(`${key} must be text.`);
    return "";
  }
  return opts.max ? v.slice(0, opts.max) : v;
}

function nullableStr(r: Rec, key: string, check: Check, max = 100_000): string | null {
  const v = r[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") {
    check.fail(`${key} must be text or empty.`);
    return null;
  }
  return v.slice(0, max);
}

function time(r: Rec, key: string, check: Check, optional = false): string | null {
  const v = r[key];
  if (v === undefined || v === null) {
    if (!optional) check.fail(`${key} is missing.`);
    return null;
  }
  if (typeof v !== "string" || Number.isNaN(new Date(v).getTime())) {
    check.fail(`${key} is not a date.`);
    return null;
  }
  return iso(v);
}

function flag(r: Rec, key: string, check: Check): boolean {
  const v = r[key];
  if (v === undefined || v === null) return false;
  if (typeof v !== "boolean") {
    check.fail(`${key} must be true or false.`);
    return false;
  }
  return v;
}

function readId(r: Rec, key: string, check: Check, optional = false): number | null {
  const v = r[key];
  if (v === undefined || v === null) {
    if (!optional) check.fail(`${key} is missing.`);
    return null;
  }
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) {
    check.fail(`${key} must be a whole number.`);
    return null;
  }
  return v;
}

/** The ids other tables may point at. */
interface Known {
  accountIds: ReadonlySet<number>;
  appIds: ReadonlySet<number>;
}

/** Reads one row. Returns null when the row can't be kept (the reason is already in `check`). */
type RowParser<T> = (r: Rec, check: Check, known: Known) => T | null;

function parseTable<T>(raw: unknown, name: string, check: Check, known: Known, parseRow: RowParser<T>): T[] {
  const out: T[] = [];
  rowsOf(raw, name, check).forEach((r, i) => {
    const row = parseRow(r, check.at(`${name} #${i + 1}: `), known);
    if (row) out.push(row);
  });
  return out;
}

/** An application id that must be there: a row pointing at a missing one is refused. */
function mustPointAtApplication(applicationId: number | null, known: Known, check: Check): void {
  if (applicationId && !known.appIds.has(applicationId)) check.fail(`applicationId ${applicationId} is not in applications.`);
}

function mustPointAtAccount(accountId: number | null, known: Known, check: Check): void {
  if (accountId && !known.accountIds.has(accountId)) check.fail(`accountId ${accountId} is not in accounts.`);
}

const parseAccount: RowParser<AccountRow> = (r, k) => {
  const provider = r.provider;
  if (provider !== "gmail" && provider !== "outlook") k.fail("provider must be gmail or outlook.");
  const id = readId(r, "id", k);
  const address = str(r, "address", k, { max: MAX.address });
  if (!id || (provider !== "gmail" && provider !== "outlook") || !address) return null;
  return {
    id, provider, address, lastSync: time(r, "lastSync", k, true), lastError: nullableStr(r, "lastError", k, MAX.lastError),
    active: r.active === undefined ? true : flag(r, "active", k),
  };
};

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const parseApplication: RowParser<ApplicationRow> = (r, k) => {
  const id = readId(r, "id", k);
  const stage = r.stage;
  if (!isStage(stage)) k.fail("stage is not one of the six stages.");
  const company = str(r, "company", k, { max: MAX.company });
  const postingUrl = safePostingUrl(r.postingUrl);
  // A rounds count outside 0 to MAX_ROUNDS, or not a whole number, is dropped: the app then works the count out itself.
  const rounds = typeof r.interviewRounds === "number" && Number.isInteger(r.interviewRounds) && r.interviewRounds >= 0 && r.interviewRounds <= MAX_ROUNDS ? r.interviewRounds : undefined;
  // Offer details that aren't plain text of 60 characters or a real day are dropped, never an error.
  const offerSalary = safeOfferSalary(r.offerSalary);
  const offerDeadline = safeOfferDeadline(r.offerDeadline);
  // When it was deleted: a real ISO time keeps it in Recently deleted, anything else is dropped (the application is then live), never an error.
  const deletedAt = typeof r.deletedAt === "string" && ISO_TIME.test(r.deletedAt) && !Number.isNaN(new Date(r.deletedAt).getTime()) ? iso(r.deletedAt) : undefined;
  // The posting text is cut to the limit, and an empty one dropped. A resume id is checked against the documents once those are read.
  const postingText = typeof r.postingText === "string" && r.postingText.trim() ? r.postingText.trim().slice(0, MAX_POSTING_CHARS) : undefined;
  const resumeId = typeof r.resumeId === "number" && Number.isInteger(r.resumeId) && r.resumeId > 0 ? r.resumeId : undefined;
  if (!id || !isStage(stage)) return null;
  return {
    id, company, companyKey: str(r, "companyKey", k, { max: MAX.company }), role: str(r, "role", k, { max: MAX.role }),
    roleKey: str(r, "roleKey", k, { max: MAX.role }), stage, stageAt: time(r, "stageAt", k, true), appliedAt: time(r, "appliedAt", k, true),
    lastActivity: time(r, "lastActivity", k, true), locked: flag(r, "locked", k), manual: flag(r, "manual", k),
    // A link that is not a plain http(s) address is dropped, never an error and never kept.
    ...(postingUrl ? { postingUrl } : {}),
    ...(rounds !== undefined ? { interviewRounds: rounds } : {}),
    ...(offerSalary ? { offerSalary } : {}),
    ...(offerDeadline ? { offerDeadline } : {}),
    ...(deletedAt ? { deletedAt } : {}),
    ...(postingText ? { postingText } : {}),
    ...(resumeId !== undefined ? { resumeId } : {}),
  };
};

const parseEmail: RowParser<EmailRow> = (r, k, known) => {
  const id = readId(r, "id", k);
  const accountId = readId(r, "accountId", k);
  mustPointAtAccount(accountId, known, k);
  const applicationId = readId(r, "applicationId", k, true);
  mustPointAtApplication(applicationId, known, k);
  const event = r.event ?? null;
  if (event !== null && !isEvent(event)) k.fail("event is not a known event.");
  const confidence = r.confidence ?? null;
  if (confidence !== null && !isConfidence(confidence)) k.fail("confidence must be high, medium or low.");
  const body = nullableStr(r, "body", k, MAX.emailBody);
  if (!id || !accountId) return null;
  return {
    id, accountId, providerMsgId: str(r, "providerMsgId", k, { max: MAX.providerMsgId }), threadId: nullableStr(r, "threadId", k, MAX.threadId),
    receivedAt: time(r, "receivedAt", k) ?? "", sender: nullableStr(r, "sender", k, MAX.sender), subject: nullableStr(r, "subject", k, MAX.subject),
    body: body === null ? null : truncate(body, BODY_LIMIT), related: flag(r, "related", k),
    // the checks above left only a known event and confidence, or a problem that refuses the whole file
    event: isEvent(event) ? event : null, confidence: isConfidence(confidence) ? confidence : null, applicationId,
    needsReview: flag(r, "needsReview", k),
    // An "open in Outlook" link on any other host is dropped: the button says Outlook, so it must lead there.
    webLink: safeWebLink(r.webLink), bulk: flag(r, "bulk", k), hold: flag(r, "hold", k),
    reason: nullableStr(r, "reason", k, MAX.reason),
  };
};

const parseActivity: RowParser<ActivityRow> = (r, k, known) => {
  const id = readId(r, "id", k);
  const applicationId = readId(r, "applicationId", k);
  mustPointAtApplication(applicationId, known, k);
  if (r.kind !== "note" && r.kind !== "step") k.fail("kind must be note or step.");
  if (!id || !applicationId || (r.kind !== "note" && r.kind !== "step")) return null;
  return {
    id, applicationId, kind: r.kind, label: nullableStr(r, "label", k, MAX.stepLabel), body: str(r, "body", k, { optional: true, max: MAX.stepBody }),
    occurredAt: time(r, "occurredAt", k) ?? "", createdAt: time(r, "createdAt", k) ?? "",
  };
};

const parseFeedback: RowParser<FeedbackRow> = (r, k, known) => {
  const id = readId(r, "id", k);
  if (r.verdict !== "not_job" && r.verdict !== "job") k.fail("verdict must be not_job or job.");
  const applicationId = readId(r, "applicationId", k, true);
  if (!id || (r.verdict !== "not_job" && r.verdict !== "job")) return null;
  return {
    id, createdAt: time(r, "createdAt", k) ?? "", verdict: r.verdict, senderEmail: str(r, "senderEmail", k, { optional: true, max: MAX.address }),
    senderDomain: str(r, "senderDomain", k, { optional: true, max: MAX.address }), subject: str(r, "subject", k, { optional: true, max: MAX.subject }),
    reason: str(r, "reason", k, { optional: true, max: MAX.reason }),
    // Feedback is kept for what it teaches (who sent it), even when its application is gone, so a missing one is cleared rather than refused.
    applicationId: applicationId && known.appIds.has(applicationId) ? applicationId : null,
  };
};

const parseIgnoredMail: RowParser<IgnoredMailRow> = (r, k, known) => {
  const id = readId(r, "id", k);
  const accountId = readId(r, "accountId", k);
  mustPointAtAccount(accountId, known, k);
  if (!id || !accountId) return null;
  return {
    id, accountId, providerMsgId: str(r, "providerMsgId", k, { max: MAX.providerMsgId }), threadId: nullableStr(r, "threadId", k, MAX.threadId),
    receivedAt: time(r, "receivedAt", k) ?? "", sender: str(r, "sender", k, { optional: true, max: MAX.sender }),
    subject: str(r, "subject", k, { optional: true, max: MAX.subject }), body: truncate(str(r, "body", k, { optional: true, max: MAX.emailBody }), BODY_LIMIT),
    webLink: safeWebLink(r.webLink), reason: str(r, "reason", k, { optional: true, max: MAX.reason }),
    createdAt: time(r, "createdAt", k) ?? "", bulk: flag(r, "bulk", k),
  };
};

const parseLearnedRule: RowParser<LearnedRuleRow> = (r, k) => {
  const id = readId(r, "id", k);
  if (!isRuleKind(r.kind)) k.fail("kind is not a known rule kind.");
  const evidence = r.evidence;
  if (typeof evidence !== "number" || !Number.isInteger(evidence) || evidence < 0) k.fail("evidence must be a whole number.");
  if (!id || !isRuleKind(r.kind) || typeof evidence !== "number") return null;
  return {
    id, kind: r.kind, value: str(r, "value", k, { max: MAX.ruleValue }), evidence, active: flag(r, "active", k), createdAt: time(r, "createdAt", k) ?? "",
  };
};

const parseContactEdit: RowParser<ContactEditRow> = (r, k) => {
  const key = str(r, "key", k, { max: MAX.personKey });
  if (!isContactKey(key)) k.fail("key is not a person key.");
  return { key, name: nullableStr(r, "name", k, MAX.personName), title: nullableStr(r, "title", k, MAX.personTitle), hidden: flag(r, "hidden", k) };
};

const parseDocument: RowParser<DocumentRow> = (r, k, known) => {
  const id = readId(r, "id", k);
  if (r.kind !== "resume" && r.kind !== "cover") k.fail("kind must be resume or cover.");
  const applicationId = readId(r, "applicationId", k, true);
  mustPointAtApplication(applicationId, known, k);
  const sections = normalizeSections(r.sections);
  const kind = r.kind;
  if (kind === "cover" && applicationId === null) k.fail("a cover letter needs an application.");
  if (!id || (kind !== "resume" && kind !== "cover")) return null;
  const source = r.source === "upload" || r.source === "paste" || r.source === "copy" || r.source === "ai" || r.source === "template" ? r.source : undefined;
  const basedOn = typeof r.basedOn === "number" && Number.isInteger(r.basedOn) && r.basedOn > 0 ? r.basedOn : undefined;
  const deletedAt = typeof r.deletedAt === "string" && ISO_TIME.test(r.deletedAt) && !Number.isNaN(new Date(r.deletedAt).getTime()) ? iso(r.deletedAt) : undefined;
  return {
    id, kind, master: kind === "resume" && r.master === true, applicationId: kind === "cover" || r.master !== true ? applicationId : null,
    title: str(r, "title", k, { max: MAX_DOC_TITLE_CHARS }) || (kind === "cover" ? "Cover letter" : "Resume"), sections,
    ...(basedOn !== undefined ? { basedOn } : {}), ...(source ? { source } : {}),
    createdAt: time(r, "createdAt", k) ?? "", updatedAt: time(r, "updatedAt", k) ?? "",
    ...(deletedAt ? { deletedAt } : {}),
  };
};

function checkIdsAreUnique(rows: { id: number }[], name: string, check: Check): void {
  const seen = new Set<number>();
  for (const r of rows) {
    if (seen.has(r.id)) check.fail(`${name} has the id ${r.id} twice.`);
    seen.add(r.id);
  }
}

/** Two rows that mean the same thing (a mailbox, a message, a rule) can't both be kept. */
function checkNoDuplicates<T>(rows: T[], keyOf: (r: T) => string, name: string, check: Check): void {
  const seen = new Set<string>();
  for (const r of rows) {
    const k = keyOf(r);
    if (seen.has(k)) check.fail(`${name} has a duplicate entry (${k.replace(/\u0000/g, " / ")}).`);
    seen.add(k);
  }
}

/** Turns an unknown value into export data, or throws an ImportError listing what is wrong. */
export function parseExportData(raw: unknown): ExportData {
  const check = new Check();
  if (!isRecord(raw)) throw new ImportError(["The file isn't a Job Tracker export."]);
  const d = raw;

  const accounts = parseTable(d.accounts, "accounts", check, { accountIds: new Set(), appIds: new Set() }, parseAccount);
  const applications = parseTable(d.applications, "applications", check, { accountIds: new Set(), appIds: new Set() }, parseApplication);
  const known: Known = { accountIds: new Set(accounts.map((a) => a.id)), appIds: new Set(applications.map((a) => a.id)) };
  const emails = parseTable(d.emails, "emails", check, known, parseEmail);
  const activity = parseTable(d.activity, "activity", check, known, parseActivity);
  const feedback = parseTable(d.feedback, "feedback", check, known, parseFeedback);
  const ignoredMail = parseTable(d.ignoredMail, "ignoredMail", check, known, parseIgnoredMail);
  const learnedRules = parseTable(d.learnedRules, "learnedRules", check, known, parseLearnedRule);
  const contactEdits = parseTable(d.contactEdits, "contactEdits", check, known, parseContactEdit);
  const documents = parseTable(d.documents, "documents", check, known, parseDocument);
  // An application can only point at a resume that is in the file; a pointer to anything else is dropped.
  const resumeIds = new Set(documents.filter((x) => x.kind === "resume").map((x) => x.id));
  for (let i = 0; i < applications.length; i++) {
    const { resumeId, ...rest } = applications[i];
    if (resumeId !== undefined && !resumeIds.has(resumeId)) applications[i] = rest;
  }

  for (const [name, rows] of [
    ["accounts", accounts], ["applications", applications], ["emails", emails], ["activity", activity], ["feedback", feedback],
    ["ignoredMail", ignoredMail], ["learnedRules", learnedRules], ["documents", documents],
  ] as const) checkIdsAreUnique(rows, name, check);
  checkNoDuplicates(accounts, (a) => `${a.provider}\u0000${a.address}`, "accounts", check);
  checkNoDuplicates(emails, (e) => `${e.accountId}\u0000${e.providerMsgId}`, "emails", check);
  checkNoDuplicates(ignoredMail, (e) => `${e.accountId}\u0000${e.providerMsgId}`, "ignoredMail", check);
  checkNoDuplicates(learnedRules, (r) => `${r.kind}\u0000${r.value}`, "learnedRules", check);
  checkNoDuplicates(contactEdits, (e) => e.key, "contactEdits", check);
  if (documents.filter((x) => x.master && !x.deletedAt).length > 1) check.fail("documents has more than one master resume.");
  // One tailored resume per application, like one cover letter: a second live one is refused.
  const tailoredFor = new Set<number>();
  for (const x of documents) {
    if (!isTailored(x) || x.deletedAt) continue;
    if (tailoredFor.has(x.applicationId!)) check.fail(`documents has more than one tailored resume for application ${x.applicationId}.`);
    tailoredFor.add(x.applicationId!);
  }

  const settings: Record<string, unknown> = {};
  if (d.settings !== undefined && !isRecord(d.settings)) check.fail('"settings" must be an object.');
  else if (isRecord(d.settings)) {
    if (isRecord(d.settings.appearance)) settings.appearance = sanitizeAppearance(d.settings.appearance);
    if (isRecord(d.settings.sync)) settings.sync = sanitizeSync(d.settings.sync);
    // Saved views and the weekly goal (sync/savedViews.ts, sync/goal.ts): kept as checked values, or not at all.
    if (d.settings.savedViews !== undefined) settings.savedViews = { views: sanitizeSavedViews(d.settings.savedViews) };
    if (sanitizeGoal(d.settings.weeklyGoal) !== null) settings.weeklyGoal = { perWeek: sanitizeGoal(d.settings.weeklyGoal) };
  }

  if (check.problems.length) throw new ImportError(check.problems);
  return { accounts, applications, emails, activity, feedback, ignoredMail, learnedRules, contactEdits, documents, settings };
}

/** Checks the envelope (format and version) and the data inside it. */
export function parseEnvelope(raw: unknown): { exportedAt: string; source: string; data: ExportData } {
  if (!isRecord(raw) || raw.format !== EXPORT_FORMAT) throw new ImportError(["The file isn't a Job Tracker export."]);
  if (typeof raw.version !== "number" || raw.version > EXPORT_VERSION || raw.version < 1) {
    throw new ImportError([`The file is version ${String(raw.version)}, and this app reads version ${EXPORT_VERSION}. Update the app, or export again.`]);
  }
  return {
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
    source: typeof raw.source === "string" ? raw.source : "web",
    data: parseExportData(raw.data),
  };
}

// Port of jobtracker/classify.py. Same rules, same order, same reason strings.
import type { Message } from "../types";
import { py, pattern, sub, test } from "./pyre";
import { loadRules, type Rules } from "./rules";

/** Checked in this order; the first event with a match wins. */
export const PRIORITY = ["offer", "rejected", "interview", "assessment", "applied"] as const;
export type StageEvent = (typeof PRIORITY)[number] | "heard_back";
export type Confidence = "high" | "medium" | "low";

export interface Classification {
  related: boolean;
  event: StageEvent | null;
  confidence: Confidence;
  reason: string;
}

/** What the app has learned from your corrections (see learn.py). `null`/`undefined` means nothing learned. */
export interface Learned {
  blocks(sender: string, domain: string): boolean;
  allowSenders: ReadonlySet<string>;
  distrust: ReadonlySet<string>;
}

/** The sets the blocking rule reads. An allowed sender is never blocked; otherwise a blocked sender or a blocked domain (or a subdomain of one) is. */
export interface BlockRules {
  allowSenders: ReadonlySet<string>;
  blockSenders: ReadonlySet<string>;
  blockDomains: Iterable<string>;
}

/** The one blocking rule: learn.Learned in the app and makeLearned in tests both call it. */
export function isBlocked(rules: BlockRules, sender: string, domain: string): boolean {
  if (rules.allowSenders.has(sender)) return false;
  if (rules.blockSenders.has(sender)) return true;
  for (const d of rules.blockDomains) if (domain === d || domain.endsWith("." + d)) return true;
  return false;
}

/** A Learned built from plain lists, with the same blocking logic as learn.Learned. */
export function makeLearned(
  parts: { blockSenders?: Iterable<string>; blockDomains?: Iterable<string>; allowSenders?: Iterable<string>; distrust?: Iterable<string> } = {},
): Learned {
  const rules: BlockRules = {
    blockSenders: new Set(parts.blockSenders ?? []),
    blockDomains: [...(parts.blockDomains ?? [])],
    allowSenders: new Set(parts.allowSenders ?? []),
  };
  return {
    allowSenders: rules.allowSenders,
    distrust: new Set(parts.distrust ?? []),
    blocks: (sender, domain) => isBlocked(rules, sender, domain),
  };
}

const SENTENCE_SPLIT = py(String.raw`(?<=[.!?])\s+|\n+`);
const QUOTES = /[\u{2019}\u{2018}\u{201c}\u{201d}\u{00a0}]/gu;
const QUOTE_MAP: Record<string, string> = {
  "\u{2019}": "'",
  "\u{2018}": "'",
  "\u{201c}": '"',
  "\u{201d}": '"',
  "\u{00a0}": " ",
};

/** Message.sender_domain */
export const senderDomain = (msg: Pick<Message, "senderEmail">): string => {
  const at = msg.senderEmail.lastIndexOf("@");
  return msg.senderEmail.slice(at + 1).toLowerCase();
};

export function isAtsDomain(domain: string, rules: Rules = loadRules()): boolean {
  const d = domain.toLowerCase();
  return rules.atsDomains.some((a) => d === a || d.endsWith("." + a));
}

function dropSentences(text: string, patterns: readonly RegExp[]): string {
  SENTENCE_SPLIT.lastIndex = 0;
  const kept = text.split(SENTENCE_SPLIT).filter((s) => s && !patterns.some((p) => test(p, s)));
  return kept.join("\n");
}

/** Drop boilerplate conditional sentences ("we'll contact you if selected...") and boilerplate clauses ("we can't give feedback"). */
export const stripConditionals = (text: string, rules: Rules = loadRules()): string =>
  dropSentences(rules.conditionalClauses.reduce((t, p) => sub(p, " ", t), text), rules.conditionals);

/** Drop sentences like "we are unable to extend an offer" so they can't count as an offer. */
export const stripNegatedOffers = (text: string, rules: Rules = loadRules()): string => dropSentences(text, rules.negatedOffers);

const straighten = (s: string): string => s.replace(QUOTES, (c) => QUOTE_MAP[c]);

export function classify(msg: Message, learned?: Learned | null): Classification {
  const result = classifyInner(msg, learned);
  if (learned && result.related && learned.distrust.has(result.reason) && !isAtsDomain(senderDomain(msg))) {
    // This wording has been wrong too often to act on alone: you decide in Needs review.
    return { related: true, event: result.event, confidence: "low", reason: result.reason };
  }
  return result;
}

function classifyInner(original: Message, learned?: Learned | null): Classification {
  const rules = loadRules();
  // Mail software writes curly quotes, and the phrases are written with straight ones.
  const msg: Message = { ...original, subject: straighten(original.subject), body: straighten(original.body) };

  const sender = msg.senderEmail.toLowerCase();
  const domain = senderDomain(msg);
  if (rules.excludeSender.some((p) => test(p, sender))) return { related: false, event: null, confidence: "high", reason: "excluded sender" };
  if (rules.excludeSubject.some((p) => test(p, msg.subject))) return { related: false, event: null, confidence: "high", reason: "excluded subject" };

  if (learned && learned.blocks(sender, domain)) {
    // A learned block is built from a few clicks, so it must never hide mail that says, in its subject, that it is
    // about an application. That goes to Needs review instead, where you decide.
    for (const event of PRIORITY) {
      const text = event === "offer" ? stripNegatedOffers(msg.subject, rules) : msg.subject;
      if (rules.strong[event].some((p) => test(p, text))) {
        return { related: true, event, confidence: "low", reason: `learned block overridden by the subject: ${event}` };
      }
    }
    return { related: false, event: null, confidence: "high", reason: `learned: ignoring ${sender}` };
  }

  // A sender you confirmed is treated like a hiring system: its mail is job mail by definition.
  const ats = isAtsDomain(domain, rules) || Boolean(learned && learned.allowSenders.has(sender));
  const subject = stripConditionals(msg.subject, rules);
  const body = stripConditionals(msg.body, rules);

  if (!ats && (msg.bulk || test(rules.bulk, msg.body))) {
    // A newsletter or marketing mail. Only its subject can say it is about your application.
    for (const event of PRIORITY) {
      const text = event === "offer" ? stripNegatedOffers(subject, rules) : subject;
      if (rules.strong[event].some((p) => test(p, text))) {
        return { related: true, event, confidence: "medium", reason: `subject of a bulk mail: ${event}` };
      }
    }
    return { related: false, event: null, confidence: "high", reason: "newsletter or marketing mail" };
  }

  if (!ats && !test(rules.jobContext, `${subject}\n${body}`)) {
    return { related: false, event: null, confidence: "high", reason: "no job context" };
  }

  for (const event of PRIORITY) {
    // A negated offer is a rejection, not an offer.
    const evSubject = event === "offer" ? stripNegatedOffers(subject, rules) : subject;
    const evBody = event === "offer" ? stripNegatedOffers(body, rules) : body;
    for (const p of rules.strong[event]) {
      if (test(p, evSubject)) return { related: true, event, confidence: "high", reason: `subject: ${pattern(p)}` };
      if (test(p, evBody)) return { related: true, event, confidence: ats ? "high" : "medium", reason: `body: ${pattern(p)}` };
    }
    for (const p of rules.weak[event]) {
      if (test(p, evSubject) || test(p, evBody)) return { related: true, event, confidence: ats ? "medium" : "low", reason: `weak: ${pattern(p)}` };
    }
  }

  if (ats) return { related: true, event: "heard_back", confidence: "medium", reason: "hiring-system mail, no stage phrase" };
  if (test(rules.replyContext, `${subject}\n${body}`)) {
    return { related: true, event: "heard_back", confidence: "low", reason: "job wording, no stage phrase" };
  }
  return { related: false, event: null, confidence: "high", reason: "no job reply" };
}

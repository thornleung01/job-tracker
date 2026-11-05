// Learning from your corrections, with plain rules and no AI (jobtracker/learn.py).
//
// Every time you say "this isn't a job email" (or confirm that something is), the email's fingerprint is saved: who sent
// it, its subject, and which rule made the app think it mattered. From those fingerprints a few explainable rules are
// rebuilt and used by the classifier from then on. You can see and undo every rule; an undone rule stays undone until you
// give it new evidence.
import { iso } from "../db/time";
import { tx, type JobTrackerDB, type LearnedRuleRow, type RuleKind } from "../db/schema";
import type { LearnedView } from "./pipelineTypes";
import { pipeline } from "./pipeline";
import { plural } from "./text";

/** Addresses at these never block a whole domain. The free-mail list the extractor uses, plus MSN (as in learn.py). */
export const PERSONAL_DOMAINS: ReadonlySet<string> = new Set([...pipeline().FREE_MAIL, "msn.com"]);
export const DISTRUST_MIN_FLAGS = 3;
export const DISTRUST_MIN_SHARE = 0.75;
export const DOMAIN_MIN_ADDRESSES = 2;
/** one employer's own address at a hiring system, flagged this many times */
export const ATS_SENDER_MIN_FLAGS = 2;

export class Learned implements LearnedView {
  constructor(
    readonly blockSenders: ReadonlySet<string> = new Set(),
    readonly blockDomains: ReadonlySet<string> = new Set(),
    readonly allowSenders: ReadonlySet<string> = new Set(),
    readonly distrust: ReadonlySet<string> = new Set(),
  ) {}

  blocks(sender: string, domain: string): boolean {
    return pipeline().isBlocked(this, sender, domain);
  }
}

export async function loadLearned(db: JobTrackerDB): Promise<Learned> {
  const byKind = new Map<RuleKind, Set<string>>();
  for (const r of await db.learnedRules.orderBy("id").toArray()) {
    if (!r.active) continue;
    if (!byKind.has(r.kind)) byKind.set(r.kind, new Set());
    byKind.get(r.kind)!.add(r.value);
  }
  return new Learned(byKind.get("block_sender"), byKind.get("block_domain"), byKind.get("allow_sender"), byKind.get("distrust_pattern"));
}

export function describe(kind: RuleKind, value: string, evidence: number): string {
  const times = plural(evidence, "time");
  switch (kind) {
    case "block_sender":
      return `Ignoring emails from ${value} (you flagged it ${times})`;
    case "block_domain":
      return `Ignoring all emails from ${value} (you flagged ${evidence} of its addresses)`;
    case "allow_sender":
      return `Trusting emails from ${value} (you confirmed it ${times})`;
    case "distrust_pattern":
      return `Not trusting the wording "${value}" on its own (it was wrong ${times}, so matches go to Needs review)`;
  }
}

interface Candidate {
  kind: RuleKind;
  value: string;
  evidence: number;
}

const ruleKey = (kind: string, value: string) => `${kind}\u0000${value}`;

/** The rules the current feedback supports, with how many flags back each one. Insertion order is the order they are reported in. */
async function candidates(db: JobTrackerDB): Promise<Map<string, Candidate>> {
  const senders = new Map<string, [number, number]>(); // address -> [not_job, job]
  const reasons = new Map<string, [number, number]>();
  for (const r of await db.feedback.orderBy("id").toArray()) {
    const idx = r.verdict === "not_job" ? 0 : 1;
    if (r.senderEmail) {
      if (!senders.has(r.senderEmail)) senders.set(r.senderEmail, [0, 0]);
      senders.get(r.senderEmail)![idx]++;
    }
    if (r.reason && !r.reason.startsWith("learned")) {
      if (!reasons.has(r.reason)) reasons.set(r.reason, [0, 0]);
      reasons.get(r.reason)![idx]++;
    }
  }

  const isAts = pipeline().isAtsDomain;
  const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1);
  const out = new Map<string, Candidate>();
  const domains = new Map<string, string[]>();
  const confirmedDomains = new Set<string>();
  for (const [address, [, j]] of senders) if (j) confirmedDomains.add(domainOf(address));

  for (const [address, [nj, j]] of senders) {
    const domain = domainOf(address);
    if (!domain || !address.includes("@")) continue;
    if (j && !nj) {
      out.set(ruleKey("allow_sender", address), { kind: "allow_sender", value: address, evidence: j });
    } else if (nj && !j && (!isAts(domain) || nj >= ATS_SENDER_MIN_FLAGS)) {
      // A hiring-system address is blocked only on firmer evidence, and never as a whole domain.
      out.set(ruleKey("block_sender", address), { kind: "block_sender", value: address, evidence: nj });
      if (!PERSONAL_DOMAINS.has(domain) && !isAts(domain)) {
        if (!domains.has(domain)) domains.set(domain, []);
        domains.get(domain)!.push(address);
      }
    }
  }
  for (const [domain, addresses] of domains) {
    if (addresses.length >= DOMAIN_MIN_ADDRESSES && !confirmedDomains.has(domain)) {
      out.set(ruleKey("block_domain", domain), { kind: "block_domain", value: domain, evidence: addresses.length });
    }
  }
  for (const [reason, [nj, j]] of reasons) {
    if (nj >= DISTRUST_MIN_FLAGS && nj / (nj + j) >= DISTRUST_MIN_SHARE) {
      out.set(ruleKey("distrust_pattern", reason), { kind: "distrust_pattern", value: reason, evidence: nj });
    }
  }
  return out;
}

/** Brings the saved rules in line with all feedback. Returns plain-words descriptions of rules that are new. */
export async function rebuild(db: JobTrackerDB, now: Date = new Date()): Promise<string[]> {
  return tx(db, async () => {
    const wanted = await candidates(db);
    const existing = new Map<string, LearnedRuleRow>();
    for (const r of await db.learnedRules.orderBy("id").toArray()) existing.set(ruleKey(r.kind, r.value), r);
    const fresh: string[] = [];
    for (const [key, c] of wanted) {
      const row = existing.get(key);
      if (!row) {
        await db.learnedRules.add({ kind: c.kind, value: c.value, evidence: c.evidence, active: true, createdAt: iso(now) });
        fresh.push(describe(c.kind, c.value, c.evidence));
      } else if (!row.active && c.evidence > row.evidence) {
        // undone, but you gave it new evidence
        await db.learnedRules.update(row.id, { active: true, evidence: c.evidence });
        fresh.push(describe(c.kind, c.value, c.evidence));
      } else if (row.active && c.evidence !== row.evidence) {
        await db.learnedRules.update(row.id, { evidence: c.evidence });
      }
    }
    for (const [key, row] of existing) {
      // no longer supported, e.g. you later confirmed that sender
      if (row.active && !wanted.has(key)) await db.learnedRules.update(row.id, { active: false });
    }
    return fresh;
  });
}

export interface RuleView {
  id: number;
  kind: RuleKind;
  text: string;
}

export async function activeRules(db: JobTrackerDB): Promise<RuleView[]> {
  const order: Record<RuleKind, number> = { block_domain: 0, block_sender: 1, allow_sender: 2, distrust_pattern: 3 };
  let rows = (await db.learnedRules.toArray()).filter((r) => r.active);
  const blocked = rows.filter((r) => r.kind === "block_domain").map((r) => r.value);
  // A sender already covered by a domain rule is not listed twice (it still has its own rule underneath).
  rows = rows.filter((r) => !(r.kind === "block_sender" && blocked.some((d) => r.value.endsWith("@" + d))));
  rows.sort((a, b) => order[a.kind] - order[b.kind] || b.id - a.id);
  return rows.map((r) => ({ id: r.id, kind: r.kind, text: describe(r.kind, r.value, r.evidence) }));
}

/** Switches a rule off. Returns false when there was no such active rule. */
export async function undo(db: JobTrackerDB, ruleId: number): Promise<boolean> {
  return tx(db, async () => {
    const row = await db.learnedRules.get(ruleId);
    if (!row || !row.active) return false;
    await db.learnedRules.update(ruleId, { active: false });
    return true;
  });
}

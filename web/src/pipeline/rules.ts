// The classifier's data (rules.json, generated from jobtracker/rules.yaml by scripts/build_rules_json.py), compiled once.
import raw from "./rules.json";
import { py } from "./pyre";

export interface RawRules {
  ats_domains: string[];
  exclude_sender: string[];
  exclude_subject: string[];
  bulk_markers: string;
  job_context: string;
  reply_context: string;
  negated_offer_sentences: string[];
  conditional_sentences: string[];
  events: Record<string, { strong?: string[]; weak?: string[] }>;
}

export interface Rules {
  atsDomains: readonly string[];
  excludeSender: readonly RegExp[];
  excludeSubject: readonly RegExp[];
  bulk: RegExp;
  jobContext: RegExp;
  replyContext: RegExp;
  negatedOffers: readonly RegExp[];
  conditionals: readonly RegExp[];
  strong: Readonly<Record<string, readonly RegExp[]>>;
  weak: Readonly<Record<string, readonly RegExp[]>>;
}

const compile = (patterns: readonly string[] | undefined): RegExp[] => (patterns ?? []).map((p) => py(p, "i"));

export function compileRules(data: RawRules): Rules {
  const strong: Record<string, RegExp[]> = {};
  const weak: Record<string, RegExp[]> = {};
  for (const [event, v] of Object.entries(data.events)) {
    strong[event] = compile(v.strong);
    weak[event] = compile(v.weak);
  }
  return {
    atsDomains: data.ats_domains.map((d) => d.toLowerCase()),
    excludeSender: compile(data.exclude_sender),
    excludeSubject: compile(data.exclude_subject),
    bulk: py(data.bulk_markers, "i"),
    jobContext: py(data.job_context, "i"),
    replyContext: py(data.reply_context, "i"),
    negatedOffers: compile(data.negated_offer_sentences),
    conditionals: compile(data.conditional_sentences),
    strong,
    weak,
  };
}

let cached: Rules | undefined;

export function loadRules(): Rules {
  return (cached ??= compileRules(raw as RawRules));
}

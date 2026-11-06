// Funnel (Sankey) data and the sentence summary (jobtracker/stats.py, plus the lede in templates/statistics.html).
import type { JobTrackerDB } from "../db/schema";
import { STAGE_FOR_EVENT, STAGES, TERMINAL, type Stage } from "../db/stages";
import { addDays, iso, roundHalfEven } from "../db/time";
import { liveApplications } from "./live";

export type FlowNodeId = "Applied" | "Heard back" | "No response yet" | "Assessment" | "Interview" | "Offer" | "Rejected" | "Still open";

/** Sankey columns, in vertical order within each column. */
export const COLUMN: Readonly<Record<FlowNodeId, number>> = {
  Applied: 0,
  "Heard back": 1,
  "No response yet": 1,
  Assessment: 2,
  Interview: 3,
  Offer: 4,
  Rejected: 4,
  "Still open": 4,
};
const ORDER = Object.keys(COLUMN) as FlowNodeId[];

/**
 * The stages one application passed through, ending at its outcome. Built from every stage an email showed plus the
 * current stage, so a manual correction and a review-queue decision both count. Any reply at all implies "Heard back";
 * Assessment and Interview are only included if actually reached.
 */
export function applicationPath(currentStage: Stage, eventStages: Iterable<string>): FlowNodeId[] {
  const reached = new Set<string>(eventStages);
  reached.add(currentStage);
  const responded = [...reached].some((s) => s !== "Applied");
  const path: FlowNodeId[] = ["Applied"];
  if (responded) path.push("Heard back");
  for (const s of ["Assessment", "Interview"] as const) if (reached.has(s)) path.push(s);
  if (TERMINAL.has(currentStage)) path.push(currentStage as "Offer" | "Rejected");
  else path.push(responded ? "Still open" : "No response yet");
  return path;
}

export interface FlowNode {
  id: FlowNodeId;
  col: number;
  value: number;
  pct: number;
}
export interface FlowLink {
  source: FlowNodeId;
  target: FlowNodeId;
  value: number;
  pct: number;
}
export interface FlowData {
  total: number;
  nodes: FlowNode[];
  links: FlowLink[];
  heardBack: number;
  interviews: number;
  offers: number;
  rejected: number;
  /** where every application ended: an offer, a rejection, or neither yet */
  outcomes: { offer: number; rejected: number; noOutcomeYet: number };
}

export interface FlowFilter {
  /** only applications with an email in this account (0 or omitted: all) */
  account?: number;
  /** only applications from the last N days (0 or omitted: all time) */
  days?: number;
  now?: Date;
}

export async function sankey(db: JobTrackerDB, filter: FlowFilter = {}): Promise<FlowData> {
  const account = filter.account ?? 0;
  const days = filter.days ?? 0;
  const emails = await db.emails.toArray();
  let apps = await liveApplications(db);

  if (account) {
    const inAccount = new Set<number>();
    for (const e of emails) if (e.accountId === account && e.applicationId != null) inAccount.add(e.applicationId);
    apps = apps.filter((a) => inAccount.has(a.id));
  }
  if (days) {
    const cutoff = iso(addDays(filter.now ?? new Date(), -days));
    apps = apps.filter((a) => {
      const when = a.appliedAt ?? a.lastActivity;
      return when != null && when >= cutoff;
    });
  }

  const seen = new Map<number, Set<string>>();
  const mark = (id: number, stage: string) => {
    if (!seen.has(id)) seen.set(id, new Set());
    seen.get(id)!.add(stage);
  };
  for (const e of emails) if (e.applicationId != null && !e.needsReview && e.event != null) mark(e.applicationId, STAGE_FOR_EVENT[e.event]);
  // Steps you logged that name a stage count too. Custom labels (e.g. "Phone screen") don't.
  for (const r of await db.activity.toArray()) if (r.kind === "step" && r.label && (STAGES as readonly string[]).includes(r.label)) mark(r.applicationId, r.label);

  const nodeCounts = new Map<FlowNodeId, number>();
  const linkCounts = new Map<string, number>();
  for (const a of apps) {
    const path = applicationPath(a.stage, seen.get(a.id) ?? []);
    for (const n of path) nodeCounts.set(n, (nodeCounts.get(n) ?? 0) + 1);
    for (let i = 0; i + 1 < path.length; i++) {
      const key = `${path[i]}\u0000${path[i + 1]}`;
      linkCounts.set(key, (linkCounts.get(key) ?? 0) + 1);
    }
  }

  const total = apps.length;
  const pct = (n: number) => (total ? roundHalfEven((100 * n) / total) : 0);
  const count = (n: FlowNodeId) => nodeCounts.get(n) ?? 0;
  const nodes: FlowNode[] = ORDER.filter((id) => count(id)).map((id) => ({ id, col: COLUMN[id], value: count(id), pct: pct(count(id)) }));
  const links: FlowLink[] = [...linkCounts.entries()]
    .map(([key, value]) => {
      const [source, target] = key.split("\u0000") as [FlowNodeId, FlowNodeId];
      return { source, target, value, pct: pct(value) };
    })
    .sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source) || ORDER.indexOf(a.target) - ORDER.indexOf(b.target));

  return {
    total,
    nodes,
    links,
    heardBack: count("Heard back"),
    interviews: count("Interview"),
    offers: count("Offer"),
    rejected: count("Rejected"),
    outcomes: { offer: count("Offer"), rejected: count("Rejected"), noOutcomeYet: count("Still open") + count("No response yet") },
  };
}

export interface FlowSummary {
  total: number;
  heardBack: number;
  heardBackPct: number;
  interviews: number;
  offers: number;
  rejected: number;
  /** the pieces of the sentence, so the UI can bold the numbers */
  parts: { text: string; strong: boolean }[];
  text: string;
}

/** "Of 3 applications, 2 heard back (67%), 1 reached an interview, 1 led to an offer and 1 was rejected." */
export function flowSummary(data: FlowData): FlowSummary | null {
  if (!data.total) return null;
  const { total, heardBack, interviews, offers, rejected } = data;
  const heardBackPct = roundHalfEven((100 * heardBack) / total);
  const parts = [
    { text: "Of ", strong: false },
    { text: String(total), strong: true },
    { text: ` ${total === 1 ? "application" : "applications"}, `, strong: false },
    { text: String(heardBack), strong: true },
    { text: ` heard back (${heardBackPct}%), `, strong: false },
    { text: String(interviews), strong: true },
    { text: " reached an interview, ", strong: false },
    { text: String(offers), strong: true },
    { text: ` ${offers === 1 ? "led to an offer" : "led to offers"} and `, strong: false },
    { text: String(rejected), strong: true },
    { text: ` ${rejected === 1 ? "was" : "were"} rejected.`, strong: false },
  ];
  return { total, heardBack, heardBackPct, interviews, offers, rejected, parts, text: parts.map((p) => p.text).join("") };
}

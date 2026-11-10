// The Resume page's work in progress: the pasted job, the draft and its ticks, the letter and where it will be saved. A reducer, so every change is
// one plain step, and a copy in session storage per database, so a reload keeps it. Nothing here reaches the database: Save does (ActionBar).
// There is nothing to move between: what the page shows is derived from what exists (deriveStep). `?step=job` in the address is a legacy deep-link
// param (it scrolls to Job), not state.
import { useEffect, useReducer } from "react";
import { clearFlow, flowKey } from "../../app/resumeFlowStorage";
import { applyTick } from "../../components/documents/tailorTicks";
import { normalizeSections } from "../../db/documentShape";
import type { DocSection } from "../../db/schema";
import type { TailorDraft } from "../../sync/tailor";

/** What the page is showing: the way in (no master), the job (no draft yet), the split (a draft) or the split once it is saved. */
export type FlowStep = "resume" | "job" | "split" | "saved";

/** Derived, never stored: there is a master, there is a draft, it is saved (and not edited since). */
export function deriveStep(s: FlowState, hasMaster: boolean): FlowStep {
  if (!hasMaster) return "resume";
  if (!s.draft) return "job";
  return s.saved && !s.dirty ? "saved" : "split";
}

export interface LetterDraft {
  text: string;
  /** the draft's own letter sections, so the saved letter keeps their ids */
  base: DocSection[];
  flags: string[];
}

/** What Save made, for the saved bar. */
export interface SavedJob {
  appId: number;
  /** the tailored resume, for the Print resume link */
  resumeId: number;
  company: string;
  /** the letter as saved, for the Gmail or Outlook draft */
  letter: string;
}

/** Where Save goes: the default (the application from ?app, else the first match), one application, or a new one. */
export type Target = "default" | "new" | number;

export interface FlowState {
  /** the resume to tailor from; null is the master */
  baselineId: number | null;
  posting: string;
  url: string;
  company: string;
  role: string;
  /** filled in from the posting or the link and not yet touched, so the page says to check them */
  guessed: { company: boolean; role: boolean };
  draft: TailorDraft | null;
  /** the draft is a copy of the baseline (Start by hand), not written with AI */
  byHand: boolean;
  /** the tailored copy as it is being edited */
  resume: DocSection[] | null;
  ticks: Record<string, boolean>;
  letter: LetterDraft | null;
  /** the person changed the copy or the letter by hand since it was written, so Try again asks first */
  edited: boolean;
  /** which document the split shows on a phone, where there is room for one */
  view: "resume" | "cover";
  target: Target;
  /** the application the flow was opened for (#/resume?app=<id>) */
  fromApp: number | null;
  /** what the last Save made; the draft stays on the page beside it */
  saved: SavedJob | null;
  /** the copy or the letter was changed since that Save, so Save is on again */
  dirty: boolean;
}

export const emptyFlow = (baselineId: number | null = null): FlowState => ({
  baselineId, posting: "", url: "", company: "", role: "", guessed: { company: false, role: false },
  draft: null, byHand: false, resume: null, ticks: {}, letter: null, edited: false, view: "resume", target: "default", fromApp: null, saved: null, dirty: false,
});

/** Something is in progress that Start over would clear. */
export const hasWork = (s: FlowState): boolean => Boolean(s.posting.trim() || s.company.trim() || s.role.trim() || s.url.trim() || s.draft);

export type FlowAction =
  | { type: "field"; name: "company" | "role" | "url"; value: string }
  /** the posting box changed; `found` is what was read from it, which fills the company and role you haven't typed */
  | { type: "posting"; value: string; found?: { company: string; role: string } }
  /** a read of the posting or the link: fills only what is empty or still a guess, and marks it to check */
  | { type: "fill"; company?: string; role?: string; posting?: string }
  | { type: "baseline"; id: number | null }
  | { type: "drafted"; draft: TailorDraft; resume: DocSection[]; ticks: Record<string, boolean>; byHand: boolean }
  | { type: "edit"; resume: DocSection[] }
  | { type: "tick"; id: string; on: boolean; baseline: readonly DocSection[] }
  | { type: "letter"; text: string }
  | { type: "view"; view: FlowState["view"] }
  | { type: "target"; target: Target }
  | { type: "prefill"; appId: number; company: string; role: string; posting: string; url: string }
  | { type: "saved"; saved: SavedJob }
  /** the application Save made is gone (deleted since, found on reload): the draft counts as unsaved again */
  | { type: "savedGone" }
  | { type: "reset" };

const letterOf = (draft: TailorDraft): LetterDraft => ({
  text: draft.cover.flatMap((s) => [s.heading, ...s.items.map((i) => i.text)]).filter(Boolean).join("\n\n"), base: draft.cover, flags: draft.coverFlags,
});

export function flowReducer(s: FlowState, a: FlowAction): FlowState {
  switch (a.type) {
    case "field":
      return a.name === "url" ? { ...s, url: a.value } : { ...s, [a.name]: a.value, guessed: { ...s.guessed, [a.name]: false } };
    case "posting": {
      const next = { ...s, posting: a.value };
      if (!a.found) return next;
      return flowReducer(next, { type: "fill", company: a.found.company, role: a.found.role });
    }
    case "fill": {
      const take = (name: "company" | "role", value: string | undefined) => Boolean(value) && (!s[name].trim() || s.guessed[name]);
      const company = take("company", a.company);
      const role = take("role", a.role);
      return {
        ...s,
        company: company ? a.company! : s.company,
        role: role ? a.role! : s.role,
        posting: a.posting && !s.posting.trim() ? a.posting : s.posting,
        guessed: { company: company || s.guessed.company, role: role || s.guessed.role },
      };
    }
    case "baseline":
      return { ...s, baselineId: a.id };
    case "drafted":
      return { ...s, draft: a.draft, byHand: a.byHand, resume: a.resume, ticks: a.ticks, letter: letterOf(a.draft), edited: false, view: "resume", saved: null, dirty: false };
    case "edit":
      return { ...s, resume: a.resume, edited: true, dirty: s.saved !== null };
    case "tick":
      if (!s.draft || !s.resume) return s;
      return { ...s, ticks: { ...s.ticks, [a.id]: a.on }, resume: applyTick(s.resume, s.draft, a.baseline, a.id, a.on), dirty: s.saved !== null };
    case "letter":
      return s.letter ? { ...s, letter: { ...s.letter, text: a.text }, edited: true, dirty: s.saved !== null } : s;
    case "view":
      return { ...s, view: a.view };
    case "target":
      return { ...s, target: a.target };
    case "prefill":
      return {
        ...emptyFlow(s.baselineId), company: a.company, role: a.role, posting: a.posting, url: a.url, fromApp: a.appId, target: a.appId,
      };
    case "saved":
      // the draft stays on the page and later Saves go to the same application
      return { ...s, saved: a.saved, dirty: false, target: a.saved.appId };
    case "savedGone":
      return s.saved === null ? s : { ...s, saved: null, dirty: false, target: s.target === s.saved.appId ? "default" : s.target };
    case "reset":
      return emptyFlow(s.baselineId);
  }
}

// -- session storage --------------------------------------------------------------------------------------------------

export { clearFlow, flowKey };

/** The shape of what is stored. An item without this number, or with another, is dropped. */
const STORED_VERSION = 1;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

const id = (x: unknown) => (typeof x === "number" && Number.isSafeInteger(x) && x > 0 ? x : null);
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((f): f is string => typeof f === "string") : []);

/** The stored draft, rebuilt from what is there, or null when any part of it is the wrong type. */
function readDraft(v: unknown): TailorDraft | null {
  if (!isObj(v) || id(v.baselineId) === null) return null;
  if (!Array.isArray(v.resume) || !Array.isArray(v.cover) || !Array.isArray(v.lines)) return null;
  const lines: TailorDraft["lines"] = [];
  for (const l of v.lines) {
    if (!isObj(l) || typeof l.id !== "string" || typeof l.sourceId !== "string" || typeof l.changed !== "boolean") return null;
    lines.push({ id: l.id, sourceId: l.sourceId, ...(Array.isArray(l.sourceIds) ? { sourceIds: strings(l.sourceIds) } : {}), changed: l.changed, flags: strings(l.flags) });
  }
  return { baselineId: v.baselineId as number, resume: normalizeSections(v.resume), lines, cover: normalizeSections(v.cover), coverFlags: strings(v.coverFlags), unused: strings(v.unused) };
}

/** What Save made, read back, or null when any part is the wrong type. */
function readSaved(v: unknown): SavedJob | null {
  if (!isObj(v) || id(v.appId) === null || id(v.resumeId) === null || typeof v.company !== "string" || typeof v.letter !== "string") return null;
  return { appId: v.appId as number, resumeId: v.resumeId as number, company: v.company, letter: v.letter };
}

/** The flow saved for this database, or a fresh one when there is none, storage is off, or what is there isn't this version's shape. Never throws. */
export function loadFlow(dbName: string): FlowState {
  try {
    const raw = sessionStorage.getItem(flowKey(dbName));
    if (!raw) return emptyFlow();
    const v: unknown = JSON.parse(raw);
    if (!isObj(v) || v.v !== STORED_VERSION) return emptyFlow();
    const draft = v.draft === null || v.draft === undefined ? null : readDraft(v.draft);
    if (v.draft != null && !draft) return emptyFlow();
    if (draft && !Array.isArray(v.resume)) return emptyFlow();
    let letter: LetterDraft | null = null;
    if (v.letter != null) {
      if (!isObj(v.letter) || typeof v.letter.text !== "string" || !Array.isArray(v.letter.base)) return emptyFlow();
      letter = { text: v.letter.text, base: normalizeSections(v.letter.base), flags: strings(v.letter.flags) };
    }
    const resume = draft ? normalizeSections(v.resume) : null;
    const guessed = isObj(v.guessed) ? { company: v.guessed.company === true, role: v.guessed.role === true } : { company: false, role: false };
    const target: Target = v.target === "new" ? "new" : id(v.target) ?? "default";
    return {
      ...emptyFlow(id(v.baselineId)),
      posting: str(v.posting), url: str(v.url), company: str(v.company), role: str(v.role), guessed,
      draft, byHand: draft !== null && v.byHand === true, resume,
      ticks: isObj(v.ticks) ? Object.fromEntries(Object.entries(v.ticks).filter(([, on]) => typeof on === "boolean")) as Record<string, boolean> : {},
      letter: draft ? letter : null, edited: v.edited === true, view: v.view === "cover" ? "cover" : "resume", target, fromApp: id(v.fromApp),
      saved: draft ? readSaved(v.saved) : null, dirty: draft !== null && v.saved != null && v.dirty === true,
    };
  } catch {
    return emptyFlow();
  }
}

/** Keeps the flow for a reload. A finished or empty flow leaves nothing behind. */
export function storeFlow(dbName: string, s: FlowState): void {
  try {
    if (!hasWork(s)) {
      if (s.baselineId === null) sessionStorage.removeItem(flowKey(dbName));
      else sessionStorage.setItem(flowKey(dbName), JSON.stringify({ v: STORED_VERSION, baselineId: s.baselineId }));
      return;
    }
    const keep = s;
    sessionStorage.setItem(flowKey(dbName), JSON.stringify({ v: STORED_VERSION, ...keep }));
  } catch {
    // no storage, or it is full: the flow lasts until the page is left
  }
}

/** The flow for this database: read once from session storage, written back on every change. */
export function useFlow(dbName: string) {
  const [state, dispatch] = useReducer(flowReducer, dbName, loadFlow);
  useEffect(() => storeFlow(dbName, state), [dbName, state]);
  return [state, dispatch] as const;
}

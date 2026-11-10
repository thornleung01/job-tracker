// Ticking or unticking one line of an AI draft, applied to the copy that is being edited instead of rebuilding it from the draft, so the
// person's own edits to other lines stay. Pure: the review's other rules (which lines start ticked, the line's sources) are in tailorReview.ts.
import type { DocItem, DocSection } from "../../db/schema";
import type { TailorDraft } from "../../sync/tailor";
import { sourcesOf } from "./tailorReview";

const clone = (sections: readonly DocSection[]): DocSection[] => sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i })) }));

/**
 * Unticked: the draft's line goes back to the baseline line or lines it came from (the ones not already in the copy). A line with no baseline
 * match stays. Ticked: the baseline lines it replaced give way to the draft's line, where the first of them was. A line the person already
 * took out of the copy is not put back by a tick.
 */
export function applyTick(
  working: readonly DocSection[], draft: Pick<TailorDraft, "resume" | "lines">, baseline: readonly DocSection[], lineId: string, on: boolean,
): DocSection[] {
  const line = draft.lines.find((l) => l.id === lineId);
  const drafted = draft.resume.flatMap((s) => s.items).find((i) => i.id === lineId);
  const next = clone(working);
  if (!line || !drafted) return next;
  const sources = sourcesOf(line);
  const originals = new Map(baseline.flatMap((s) => s.items).map((i) => [i.id, i]));
  const where = (ids: readonly string[]) => {
    for (const [si, s] of next.entries()) {
      const k = s.items.findIndex((i) => ids.includes(i.id));
      if (k >= 0) return { si, k };
    }
    return null;
  };

  if (!on) {
    const at = where([lineId]);
    const back = sources.flatMap((id): DocItem[] => { const o = originals.get(id); return o ? [o] : []; });
    if (!at || !back.length) return next;
    const present = new Set(next.flatMap((s) => s.items.map((i) => i.id)));
    present.delete(lineId);
    next[at.si].items.splice(at.k, 1, ...back.filter((b) => !present.has(b.id)).map((b) => ({ ...b })));
    return next;
  }
  const at = where([lineId, ...sources]);
  if (!at) return next;
  next[at.si].items[at.k] = { ...drafted };
  for (const s of next) s.items = s.items.filter((i) => i.id === lineId || !sources.includes(i.id));
  return next;
}

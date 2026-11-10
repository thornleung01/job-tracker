// The logic of the tailor review, as plain functions: which lines start ticked, which words changed, and the resume that is saved from the ticks.
// No React here, so it is tested on its own.
import type { DocItem, DocSection, DocumentRow } from "../../db/schema";
import type { TailorDraft, TailorLine } from "../../sync/tailor";

// The word diff lives in documents/compare.ts (pure); it is re-exported here for the callers that already import it from this file.
export { diffWords, type WordPart } from "../../documents/compare";

/** A line as one string: "Label: text" when it has a label. */
export const lineText = (item: Pick<DocItem, "label" | "text">): string => (item.label ? `${item.label}: ${item.text}` : item.text);

/** Which lines start ticked: all of them except the flagged ones, which the person should look at first. Keyed by the line's id in the draft. */
export function initialTicks(lines: readonly TailorLine[]): Record<string, boolean> {
  return Object.fromEntries(lines.map((l) => [l.id, l.flags.length === 0]));
}

/** Every master line a draft line came from: usually one, all of a multi-line summary's lines for the summary. */
export const sourcesOf = (line: Pick<TailorLine, "sourceId" | "sourceIds">): string[] => line.sourceIds?.length ? line.sourceIds : [line.sourceId];

/**
 * The resume to save: the draft, where each unticked line goes back to the master's line it came from. A line the master has no match for
 * stays as it is, and a master line is never placed twice (when a ticked line already came from it, the unticked one is dropped).
 */
export function composeResume(
  draft: Pick<TailorDraft, "resume" | "lines">, master: readonly DocSection[], ticks: Readonly<Record<string, boolean>>,
): DocSection[] {
  const lines = new Map(draft.lines.map((l) => [l.id, l]));
  const original = new Map(master.flatMap((s) => s.items).map((i) => [i.id, i]));
  const placed = new Set(draft.lines.filter((l) => ticks[l.id] !== false).flatMap(sourcesOf));
  return draft.resume.map((section) => ({
    ...section,
    items: section.items.flatMap((item): DocItem[] => {
      const line = lines.get(item.id);
      if (!line || ticks[line.id] !== false) return [item];
      const back = sourcesOf(line).flatMap((id) => original.get(id) ?? []);
      if (!back.length) return [item];
      const restored = back.filter((b) => !placed.has(b.id));
      for (const b of restored) placed.add(b.id);
      return restored.map((b) => ({ ...b }));
    }),
  }));
}

/** The title the person sees for a resume: a tailored one says so even when its title doesn't. */
export const resumeLabel = (doc: Pick<DocumentRow, "kind" | "master" | "applicationId" | "title">): string =>
  doc.kind === "resume" && !doc.master && doc.applicationId !== null && !/tailored/i.test(doc.title) ? `${doc.title} (tailored)` : doc.title;

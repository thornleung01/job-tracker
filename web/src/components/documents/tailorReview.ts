// The logic of the tailor review, as plain functions: which lines start ticked, which words changed, and the resume that is saved from the ticks.
// No React here, so it is tested on its own.
import type { DocItem, DocSection, DocumentRow } from "../../db/schema";
import type { TailorDraft, TailorLine } from "../../sync/tailor";

/** A word from a line, `changed` when the other line doesn't have it in that place. */
export interface WordPart {
  text: string;
  changed: boolean;
}

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** The words of `before` and of `after`, each marked where the two differ (the longest run of words they share is left unmarked). */
export function diffWords(before: string, after: string): { before: WordPart[]; after: WordPart[] } {
  const a = words(before);
  const b = words(after);
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const left: WordPart[] = [];
  const right: WordPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      left.push({ text: a[i++], changed: false });
      right.push({ text: b[j++], changed: false });
    } else if (j >= b.length || (i < a.length && table[i + 1][j] >= table[i][j + 1])) left.push({ text: a[i++], changed: true });
    else right.push({ text: b[j++], changed: true });
  }
  return { before: left, after: right };
}

/** A line as one string: "Label: text" when it has a label. */
export const lineText = (item: Pick<DocItem, "label" | "text">): string => (item.label ? `${item.label}: ${item.text}` : item.text);

/** Which lines start ticked: all of them except the flagged ones, which the person should look at first. Keyed by the line's id in the draft. */
export function initialTicks(lines: readonly TailorLine[]): Record<string, boolean> {
  return Object.fromEntries(lines.map((l) => [l.id, l.flags.length === 0]));
}

/**
 * The resume to save: the draft, where each unticked line goes back to the master's line it came from. A line the master has no match for
 * stays as it is, and a master line is never placed twice (when a ticked line already came from it, the unticked one is dropped).
 */
export function composeResume(
  draft: Pick<TailorDraft, "resume" | "lines">, master: readonly DocSection[], ticks: Readonly<Record<string, boolean>>,
): DocSection[] {
  const lines = new Map(draft.lines.map((l) => [l.id, l]));
  const original = new Map(master.flatMap((s) => s.items).map((i) => [i.id, i]));
  const placed = new Set(draft.lines.filter((l) => ticks[l.id] !== false).map((l) => l.sourceId));
  return draft.resume.map((section) => ({
    ...section,
    items: section.items.flatMap((item): DocItem[] => {
      const line = lines.get(item.id);
      if (!line || ticks[line.id] !== false) return [item];
      const back = original.get(line.sourceId);
      if (!back) return [item];
      if (placed.has(back.id)) return [];
      placed.add(back.id);
      return [{ ...back }];
    }),
  }));
}

/** The title the person sees for a resume: a tailored one says so even when its title doesn't. */
export const resumeLabel = (doc: Pick<DocumentRow, "kind" | "master" | "applicationId" | "title">): string =>
  doc.kind === "resume" && !doc.master && doc.applicationId !== null && !/tailored/i.test(doc.title) ? `${doc.title} (tailored)` : doc.title;

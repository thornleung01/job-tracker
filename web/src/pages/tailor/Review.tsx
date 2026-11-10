// The lists under the tailored copy: what changed against the baseline (with Reset to baseline), what was left out (with Add back), and the AI's
// lines to tick. Each is plain markup over data the workspace holds.
import { useId } from "react";
import type { DocSection } from "../../db/schema";
import type { BaselineCompare, WordPart } from "../../documents/compare";
import { lineText } from "../../components/documents/tailorReview";
import type { TailorDraft } from "../../sync/tailor";
import { plural } from "../../sync/text";

/** How much of a line is in a control's accessible name. */
const NAME_CHARS = 60;
const short = (text: string) => (text.length > NAME_CHARS ? `${text.slice(0, NAME_CHARS).trimEnd()}...` : text);

function Words({ parts }: { parts: WordPart[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>{p.changed ? <mark className="tailor-changed">{p.text}</mark> : p.text}{" "}</span>
      ))}
    </>
  );
}

interface ChangesProps {
  compare: BaselineCompare;
  sections: readonly DocSection[];
  /** the line the person's cursor is in, so its entry stands out */
  activeId: string | null;
  disabled: boolean;
  onReset(id: string): void;
}

/** "Changes from the baseline": one entry per changed or new line, the words that differ marked. A changed line can be put back. */
export function Changes({ compare, sections, activeId, disabled, onReset }: ChangesProps) {
  const entries = sections.flatMap((s) => [
    ...(compare.lines[s.id]?.status === "changed" || compare.lines[s.id]?.status === "new" ? [{ id: s.id, item: null as null, where: s.heading || "Header", section: true }] : []),
    ...s.items.flatMap((item) => (compare.lines[item.id] && compare.lines[item.id].status !== "same" ? [{ id: item.id, item, where: s.heading || "Header", section: false }] : [])),
  ]);
  const changed = entries.filter((e) => compare.lines[e.id].status === "changed").length;
  const added = entries.length - changed;
  // The live region is always in the page and the sentence is put into it, so a change that empties the list is announced.
  const none = (
    <div role="status">{entries.length ? null : <p className="small muted tailor-none">No changes from the baseline.</p>}</div>
  );
  // Both returns are a fragment of the same shape, so the region is kept between them rather than replaced.
  if (!entries.length) return <>{none}{null}</>;
  return (
    <>
    {none}
    <section className="tailor-list" aria-labelledby="tailor-changes-h">
      <h3 id="tailor-changes-h" className="doc-h">Changes from your baseline</h3>
      <p className="small muted" role="status">{[changed ? `${changed} changed` : "", added ? `${added} new` : ""].filter(Boolean).join(", ")}</p>
      <ul>
        {entries.map((e) => {
          const line = compare.lines[e.id];
          const now = e.item ? lineText(e.item) : "";
          return (
            <li key={e.id} className={`tailor-entry${e.id === activeId ? " active" : ""}`} data-line={e.id} data-status={line.status}>
              <p className="small muted tailor-entry-h">{e.where}, {line.status === "changed" ? "changed" : "new"}</p>
              {line.status === "changed" && line.diff ? (
                <>
                  <p className="tailor-text"><span className="small muted">Baseline: </span><Words parts={line.diff.before} /></p>
                  <p className="tailor-text"><span className="small muted">Now: </span><Words parts={line.diff.after} /></p>
                </>
              ) : (
                <p className="tailor-text">{e.item ? now : "A new section"}</p>
              )}
              {line.status === "changed" && !e.section ? (
                <button type="button" onClick={() => onReset(e.id)} disabled={disabled} aria-label={`Reset to baseline: ${short(now)}`}>Reset to baseline</button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
    </>
  );
}

interface LeftOutProps {
  compare: BaselineCompare;
  disabled: boolean;
  onAddBack(id: string): void;
}

/** "Left out from your baseline": the baseline's lines the copy doesn't have, each with Add back. */
export function LeftOut({ compare, disabled, onAddBack }: LeftOutProps) {
  if (!compare.leftOut.length) return null;
  return (
    <section className="tailor-list" aria-labelledby="tailor-left-h">
      <h3 id="tailor-left-h" className="doc-h">Left out from your baseline</h3>
      <ul>
        {compare.leftOut.map((l) => (
          <li key={l.id} className="tailor-entry">
            <p className="small muted tailor-entry-h">{l.heading || "Header"}</p>
            <p className="tailor-text">{lineText(l.item)}</p>
            <button type="button" onClick={() => onAddBack(l.id)} disabled={disabled} aria-label={`Add back: ${short(lineText(l.item))}`}>Add back</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface TicksProps {
  draft: Pick<TailorDraft, "resume" | "lines" | "unused">;
  ticks: Readonly<Record<string, boolean>>;
  onTick(id: string, on: boolean): void;
}

function Tick({ id, text, flags, ticked, onTick }: { id: string; text: string; flags: string[]; ticked: boolean; onTick(on: boolean): void }) {
  const base = useId();
  return (
    <li className="tailor-entry" data-line={id}>
      <p className="tailor-text">{text}</p>
      {flags.map((f, i) => <p key={f} id={`${base}-flag-${i}`} className="small tailor-flag">{f}</p>)}
      <div className="tailor-use">
        <input
          id={base} type="checkbox" checked={ticked} onChange={(e) => onTick(e.target.checked)} aria-label={`Use: ${short(text)}`}
          aria-describedby={flags.length ? flags.map((_, i) => `${base}-flag-${i}`).join(" ") : undefined}
        />
        <label htmlFor={base} aria-hidden="true">Use</label>
      </div>
    </li>
  );
}

/** The AI's lines, each with a Use tick. A flagged line starts unticked, and an unticked line keeps the baseline's text. */
export function Ticks({ draft, ticks, onTick }: TicksProps) {
  const items = new Map(draft.resume.flatMap((s) => s.items).map((i) => [i.id, i]));
  const flagged = draft.lines.filter((l) => l.flags.length > 0).length;
  return (
    <section className="tailor-list" aria-labelledby="tailor-ticks-h">
      <h3 id="tailor-ticks-h" className="doc-h">Lines from the AI</h3>
      <p className="small muted tailor-count">
        {flagged ? `${plural(flagged, "line")} to check. ${flagged === 1 ? "It starts" : "They start"} unticked, so your baseline's words are used unless you tick ${flagged === 1 ? "it" : "them"}.` : "Untick a line to keep your baseline's words for it."}
      </p>
      <ul>
        {draft.lines.flatMap((l) => {
          const item = items.get(l.id);
          return item ? [<Tick key={l.id} id={l.id} text={lineText(item)} flags={l.flags} ticked={ticks[l.id] !== false} onTick={(on) => onTick(l.id, on)} />] : [];
        })}
      </ul>
      {draft.unused.length ? (
        <div className="tailor-unused">
          <h4 className="tailor-sh">Lines the AI left out</h4>
          <ul>{draft.unused.map((u, i) => <li key={i} className="small">{u}</li>)}</ul>
        </div>
      ) : null}
    </section>
  );
}

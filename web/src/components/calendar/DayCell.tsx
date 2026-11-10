import { memo } from "react";
import type { CalendarEvent } from "../../sync/calendar";
import { KIND_ICON, cellLabel } from "./eventMeta";

/** How many events a cell draws before it says how many more there are: the panel under the grid lists them all. */
const MAX_CHIPS = 3;

interface Props {
  day: string;
  /** false for the leading and trailing days of the neighbouring months */
  inMonth: boolean;
  isToday: boolean;
  selected: boolean;
  /** the cell the Tab key lands on: one in the whole grid */
  tabbable: boolean;
  /** the same array for the same day from one render to the next, so a cell only redraws when its own day changes */
  events: readonly CalendarEvent[];
  /** must be stable */
  onSelect(day: string): void;
}

/**
 * One day of the grid. It is the focusable cell: its label says the date and what is on it, and the chips inside are for
 * sighted readers only (the label already says it), so they're hidden from screen readers.
 */
export const DayCell = memo(function DayCell({ day, inMonth, isToday, selected, tabbable, events, onSelect }: Props) {
  const shown = events.slice(0, MAX_CHIPS);
  return (
    <div role="gridcell" className="cal-cell" data-day={day} data-outside={inMonth ? undefined : "true"} tabIndex={tabbable ? 0 : -1}
         aria-label={cellLabel(day, events)} aria-selected={selected} aria-current={isToday ? "date" : undefined} onClick={() => onSelect(day)}>
      <span className="cal-num" aria-hidden="true">{Number(day.slice(8))}</span>
      {events.length ? (
        <span className="cal-chips" aria-hidden="true">
          {shown.map((e) => {
            const Icon = KIND_ICON[e.kind];
            return <span key={e.key} className="cal-chip" data-kind={e.kind}><Icon size={16} strokeWidth={3} aria-hidden="true" focusable="false" /><span className="cal-chip-name">{e.company}</span></span>;
          })}
          {events.length > shown.length ? <span className="cal-more">+{events.length - shown.length} more</span> : null}
        </span>
      ) : null}
    </div>
  );
});

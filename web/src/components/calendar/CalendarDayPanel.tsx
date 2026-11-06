import type { KeyboardEvent, RefObject } from "react";
import type { CalendarEvent } from "../../sync/calendar";
import { CalendarExport } from "./CalendarExport";
import { longDay } from "./eventMeta";
import { EventRow } from "./EventRow";

interface Props {
  day: string;
  events: readonly CalendarEvent[];
  /** the heading takes focus when a day is chosen with the keyboard */
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** Escape: focus goes back to the day's cell */
  onEscape(): void;
}

/** What is on the chosen day, under the grid: one link per event to its application. */
export function CalendarDayPanel({ day, events, headingRef, onEscape }: Props) {
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    onEscape();
  };
  return (
    <section className="card cal-panel" aria-labelledby="cal-panel-title" onKeyDown={onKeyDown}>
      <h3 className="cal-panel-title" id="cal-panel-title" tabIndex={-1} ref={headingRef}>{longDay(day)}</h3>
      {events.length ? (
        <ul className="cal-events">
          {events.map((e) => <li key={e.key}><EventRow event={e} /></li>)}
        </ul>
      ) : <p className="muted cal-empty">Nothing on this day.</p>}
      <CalendarExport events={events} period={day} label="Download interviews (.ics)" />
    </section>
  );
}

import { useEffect, useId, useMemo, useRef } from "react";
import type { CalendarEvent } from "../../sync/calendar";
import { monthTitle, shiftMonth } from "../../sync/calendarGrid";
import { CalendarAgenda } from "./CalendarAgenda";
import { CalendarDayPanel } from "./CalendarDayPanel";
import { CalendarExport } from "./CalendarExport";
import { CalendarGrid } from "./CalendarGrid";
import { useMediaQuery } from "./useMediaQuery";
import "./calendar.css";

/** At this width or less a seven-column grid doesn't fit, so the month is a list. */
export const PHONE_QUERY = "(max-width: 720px)";

interface Props {
  /** YYYY-MM */
  month: string;
  today: string;
  /** the chosen day, or "" */
  day: string;
  events: ReadonlyMap<string, readonly CalendarEvent[]>;
  /** the viewer moved to another month (a button, Page Up or Page Down, or an arrow past the edge) */
  onMonth(month: string): void;
  onSelectDay(day: string): void;
}

const NO_EVENTS: readonly CalendarEvent[] = [];

/** The month heading with its buttons, then the grid and the chosen day's panel, or on a phone the agenda. */
export function CalendarView({ month, today, day, events, onMonth, onSelectDay }: Props) {
  const phone = useMediaQuery(PHONE_QUERY);
  const titleId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** the day whose panel should take focus as soon as it shows (the address may update a moment after the key press) */
  const focusPanelFor = useRef("");
  const select = (d: string) => {
    // The day already showing has no address change to wait for: its panel is there, so it takes focus now.
    if (d === day && headingRef.current) {
      headingRef.current.focus();
      return;
    }
    focusPanelFor.current = d;
    onSelectDay(d);
  };
  useEffect(() => {
    if (focusPanelFor.current && focusPanelFor.current === day && headingRef.current) {
      focusPanelFor.current = "";
      headingRef.current.focus();
    }
  });

  // In day order, so the month's calendar file lists the days as they come.
  const monthEvents = useMemo(() => [...events.keys()].filter((d) => d.startsWith(`${month}-`)).sort().flatMap((d) => events.get(d) ?? []), [events, month]);
  return (
    <section className="cal" aria-label="Calendar">
      <div className="cal-head">
        <h2 className="cal-title" id={titleId} aria-live="polite">{monthTitle(month)}</h2>
        <div className="cal-nav">
          <button type="button" onClick={() => onMonth(shiftMonth(month, -1))}>Previous month</button>
          <button type="button" onClick={() => onMonth(today.slice(0, 7))}>Today</button>
          <button type="button" onClick={() => onMonth(shiftMonth(month, 1))}>Next month</button>
        </div>
        <CalendarExport events={monthEvents} period={month} label="Download this month's interviews" />
      </div>
      {phone ? (
        <CalendarAgenda month={month} today={today} events={events} />
      ) : (
        <>
          <CalendarGrid month={month} today={today} selected={day} events={events} labelledBy={titleId} onSelect={select} onMonth={onMonth} gridRef={gridRef} />
          {day ? (
            <CalendarDayPanel day={day} events={events.get(day) ?? NO_EVENTS} headingRef={headingRef}
                              onEscape={() => gridRef.current?.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus()} />
          ) : null}
        </>
      )}
    </section>
  );
}

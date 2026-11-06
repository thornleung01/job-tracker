import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { WEEKDAY_NAMES } from "../../db/dayText";
import { daysInMonth, shiftDay, weekdayOf } from "../../db/time";
import type { CalendarEvent } from "../../sync/calendar";
import { monthGrid, shiftMonth } from "../../sync/calendarGrid";
import { WEEKDAYS } from "../../sync/upcoming";
import { DayCell } from "./DayCell";

const NONE: readonly CalendarEvent[] = [];

interface Props {
  /** YYYY-MM */
  month: string;
  /** YYYY-MM-DD of today */
  today: string;
  /** the chosen day, or "" */
  selected: string;
  events: ReadonlyMap<string, readonly CalendarEvent[]>;
  /** id of the heading that names the month */
  labelledBy: string;
  /** Enter, Space or a click on a day */
  onSelect(day: string): void;
  /** a move past the month's edge, or Page Up and Page Down */
  onMonth(month: string): void;
  /** the grid's own element, so a caller can find a cell */
  gridRef: RefObject<HTMLDivElement | null>;
}

/**
 * The month as a grid. One cell has the tab stop and the arrow keys move it: a day or a week at a time, Home and End to the
 * ends of the week, Page Up and Page Down to the month before and after. Enter and Space choose the day.
 */
export function CalendarGrid({ month, today, selected, events, labelledBy, onSelect, onMonth, gridRef }: Props) {
  const weeks = useMemo(() => monthGrid(month), [month]);
  const [focusDay, setFocusDay] = useState("");
  /** a day to focus once the month it belongs to is showing */
  const pending = useRef("");

  // The cell with the tab stop: where focus was if it is in this month, else the chosen day, today, or the first.
  const inThisMonth = (d: string) => d.startsWith(`${month}-`);
  const rover = [focusDay, selected, today].find((d) => d && inThisMonth(d)) ?? `${month}-01`;

  const select = useRef(onSelect);
  useLayoutEffect(() => {
    select.current = onSelect;
  });
  const onCell = useRef((day: string) => select.current(day)).current;

  const focusCell = (day: string) => {
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus();
  };
  useEffect(() => {
    if (pending.current && inThisMonth(pending.current)) {
      const day = pending.current;
      pending.current = "";
      focusCell(day);
    }
  });

  const moveTo = (day: string) => {
    setFocusDay(day);
    if (inThisMonth(day)) focusCell(day);
    else {
      pending.current = day;
      onMonth(day.slice(0, 7));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const day = (e.target as Element).closest<HTMLElement>("[data-day]")?.dataset.day;
    if (!day) return;
    const week = weeks.find((w) => w.includes(day));
    const inMonth = (w: string[]) => w.filter(inThisMonth);
    let next: string | null = null;
    switch (e.key) {
      case "ArrowLeft": next = shiftDay(day, -1); break;
      case "ArrowRight": next = shiftDay(day, 1); break;
      case "ArrowUp": next = shiftDay(day, -7); break;
      case "ArrowDown": next = shiftDay(day, 7); break;
      case "Home": next = week ? inMonth(week)[0] ?? day : day; break;
      case "End": next = week ? inMonth(week).at(-1) ?? day : day; break;
      case "PageUp":
      case "PageDown": {
        const target = shiftMonth(month, e.key === "PageUp" ? -1 : 1);
        const [y, m] = target.split("-").map(Number);
        next = `${target}-${String(Math.min(Number(day.slice(8)), daysInMonth(y, m))).padStart(2, "0")}`;
        break;
      }
      case "Enter":
      case " ":
        e.preventDefault();
        onSelect(day);
        return;
      default:
        return;
    }
    e.preventDefault();
    moveTo(next);
  };

  return (
    <div className="cal-grid" role="grid" aria-labelledby={labelledBy} ref={gridRef} onKeyDown={onKeyDown} onFocus={(e) => {
      const d = (e.target as Element).closest<HTMLElement>("[data-day]")?.dataset.day;
      if (d && inThisMonth(d)) setFocusDay(d);
    }}>
      <div className="cal-row cal-weekdays" role="row">
        {/* named from the first week's own days, so a column's name can never disagree with the days under it */}
        {weeks[0].map((d) => {
          const wd = weekdayOf(d);
          return <div key={wd} role="columnheader" className="cal-weekday" aria-label={WEEKDAY_NAMES[wd]}><span aria-hidden="true">{WEEKDAYS[wd]}</span></div>;
        })}
      </div>
      {weeks.map((w) => (
        <div key={w[0]} className="cal-row" role="row">
          {w.map((d) => (
            <DayCell key={d} day={d} inMonth={inThisMonth(d)} isToday={d === today} selected={d === selected} tabbable={d === rover}
                     events={events.get(d) ?? NONE} onSelect={onCell} />
          ))}
        </div>
      ))}
    </div>
  );
}

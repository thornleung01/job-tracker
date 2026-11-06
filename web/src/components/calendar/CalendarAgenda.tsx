import type { CalendarEvent } from "../../sync/calendar";
import { dayHeading } from "./eventMeta";
import { EventRow } from "./EventRow";

interface Props {
  /** YYYY-MM */
  month: string;
  today: string;
  events: ReadonlyMap<string, readonly CalendarEvent[]>;
}

/** The phone's calendar: the month's days that have events, one list per day, today first when it is in this month. Links go straight to the application. */
export function CalendarAgenda({ month, today, events }: Props) {
  const days = [...events.keys()].filter((d) => d.startsWith(`${month}-`) && d !== today).sort();
  const showToday = today.startsWith(`${month}-`);
  if (showToday) days.unshift(today);
  if (!days.length) return <p className="muted cal-empty">Nothing this month.</p>;
  return (
    <div className="cal-agenda">
      {days.map((d) => {
        const list = events.get(d) ?? [];
        return (
          <section key={d} className="cal-agenda-day" aria-labelledby={`cal-agenda-${d}`} data-day={d}>
            <h3 className="cal-agenda-heading" id={`cal-agenda-${d}`}>{d === today ? "Today, " : ""}{dayHeading(d)}</h3>
            {list.length ? (
              <ol className="cal-events">
                {list.map((e) => <li key={e.key}><EventRow event={e} /></li>)}
              </ol>
            ) : <p className="muted cal-empty">Nothing today.</p>}
          </section>
        );
      })}
    </div>
  );
}

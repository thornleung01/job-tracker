import { isStage } from "../../db/stages";
import type { CalendarEvent } from "../../sync/calendar";
import { StageBadge } from "../StageBadge";
import { KIND_ICON } from "./eventMeta";

/** One event as a link to its application: icon and the kind in words, company, role, stage, "Sent: <resume>" on an interview, and "Past" when the day has gone. */
export function EventRow({ event: e }: { event: CalendarEvent }) {
  const Icon = KIND_ICON[e.kind];
  return (
    <a className="cal-event" href={`#/app/${e.appId}`}>
      <span className="cal-event-kind"><Icon size={16} strokeWidth={3} aria-hidden="true" focusable="false" />{e.label}</span>
      <strong className="cal-event-company">{e.company}</strong>
      {e.role ? <span className="cal-event-role muted">{e.role}</span> : null}
      {isStage(e.stage) ? <StageBadge stage={e.stage} /> : null}
      {e.resumeTitle ? <span className="cal-event-sent small muted">Sent: {e.resumeTitle}</span> : null}
      {e.past ? <span className="cal-event-past small muted">Past</span> : null}
    </a>
  );
}

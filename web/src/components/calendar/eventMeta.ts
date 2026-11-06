import { Bell, Clock, ListChecks, Send, Users, type LucideIcon } from "lucide-react";
import { MONTHS, WEEKDAY_NAMES } from "../../db/dayText";
import { weekdayOf } from "../../db/time";
import type { CalendarEvent, CalendarKind } from "../../sync/calendar";

/** One icon per kind of event. The words always show next to it, so the shape is never the only signal. */
export const KIND_ICON: Readonly<Record<CalendarKind, LucideIcon>> = {
  interview: Users,
  applied: Send,
  offer: Clock,
  followUp: Bell,
  step: ListChecks,
};

const parts = (day: string): [number, number, number] => {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
};

/** "Thursday, October 15, 2026". Plain calendar maths in UTC, so the viewer's time zone can't move the weekday. */
export function longDay(day: string): string {
  const [y, m, d] = parts(day);
  return `${WEEKDAY_NAMES[weekdayOf(day)]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "Thursday, October 15", for the agenda, where the month is already in the heading. */
export function dayHeading(day: string): string {
  const [, m, d] = parts(day);
  return `${WEEKDAY_NAMES[weekdayOf(day)]}, ${MONTHS[m - 1]} ${d}`;
}

/** The kind in words for a cell's label: "interview", "follow up due". A step is only "step", since its name could be anything. */
const kindWord = (e: CalendarEvent): string => (e.kind === "step" ? "step" : e.label.toLowerCase());

/** The label a screen reader gets for a day: "Thursday, October 15, 2026. 2 events: interview, follow up due", or "... No events". */
export function cellLabel(day: string, events: readonly CalendarEvent[]): string {
  const head = longDay(day);
  if (!events.length) return `${head}. No events`;
  const words = [...new Set(events.map(kindWord))];
  return `${head}. ${events.length} event${events.length === 1 ? "" : "s"}: ${words.join(", ")}`;
}

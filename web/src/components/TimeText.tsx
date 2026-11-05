// Times are stored in UTC. Show them in the viewer's own time zone, with how long ago.
import { dayOf } from "../db/time";
import { dayText } from "../db/dayText";

export { dayText };

/** "5 minutes ago", "3 hours ago", "yesterday", "9 days ago"; "" when the time is in the future. */
export function relativeTime(then: Date, now: Date = new Date()): string {
  const s = (now.getTime() - then.getTime()) / 1000;
  if (s < 0) return "";
  if (s < 3600) {
    const minutes = Math.max(1, Math.round(s / 60));
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  if (s < 86400) {
    const hours = Math.round(s / 3600);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const days = Math.floor(s / 86400);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** The last-activity wording: Today, 1 day ago, N days ago, or Unknown. */
export function daysAgoText(idleDays: number | null): string {
  if (idleDays === null) return "Unknown";
  if (idleDays <= 0) return "Today";
  return idleDays === 1 ? "1 day ago" : `${idleDays} days ago`;
}

const FORMATS = {
  short: { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  medium: { dateStyle: "medium", timeStyle: "short" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

/** Wealthsimple writes times as "9:05 am": lowercase, with a space. Intl gives "9:05 AM", "9:05 a.m." in en-CA, sometimes with a narrow no-break space.
 *  The digit is matched and written back (no lookbehind: older Safari can't parse one, and the whole page would fail to load). */
export const lowerMeridiem = (text: string): string => text.replace(/(\d)[\s\u202f]*([ap])\.?m\.?(?![a-z])/gi, (_, digit: string, ap: string) => `${digit} ${ap.toLowerCase()}m`);

interface TimeTextProps {
  /** an ISO-8601 time, usually UTC */
  iso: string;
  /** short is "Oct 21, 9:05 am"; medium adds the year */
  format?: keyof typeof FORMATS;
  /** add " · 5 minutes ago" */
  relative?: boolean;
  /** for tests; defaults to the current time */
  now?: Date;
}

/** A `<time>` element in the viewer's time zone. The full date and zone are in the title. */
export function TimeText({ iso, format = "medium", relative = false, now }: TimeTextProps) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return <time dateTime={iso}>{iso.slice(0, 10)}</time>;
  const ago = relative ? relativeTime(when, now) : "";
  return (
    <time dateTime={iso} title={lowerMeridiem(when.toLocaleString([], { dateStyle: "full", timeStyle: "long" }))}>
      {lowerMeridiem(when.toLocaleString([], FORMATS[format])) + (ago ? ` · ${ago}` : "")}
    </time>
  );
}

/** The list's last-activity cell: the days, with the exact date in the title. */
export function LastActivity({ iso, idleDays }: { iso: string | null; idleDays: number | null }) {
  if (idleDays === null || !iso) return <>Unknown</>;
  return (
    <time dateTime={dayOf(iso)} title={dayText(iso)}>
      {daysAgoText(idleDays)}
    </time>
  );
}

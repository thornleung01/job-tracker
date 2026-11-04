// Times are stored in UTC. Show them in the viewer's own time zone, with how long ago.

/** "5 min ago", "3 h ago", "yesterday", "9 days ago"; "" when the time is in the future. */
export function relativeTime(then: Date, now: Date = new Date()): string {
  const s = (now.getTime() - then.getTime()) / 1000;
  if (s < 0) return "";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
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

interface TimeTextProps {
  /** an ISO-8601 time, usually UTC */
  iso: string;
  /** short is "Oct 21, 9:05 AM"; medium adds the year */
  format?: keyof typeof FORMATS;
  /** add " · 5 min ago" */
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
    <time dateTime={iso} title={when.toLocaleString([], { dateStyle: "full", timeStyle: "long" })}>
      {when.toLocaleString([], FORMATS[format]) + (ago ? ` · ${ago}` : "")}
    </time>
  );
}

/** The list's last-activity cell: the days, with the exact date in the title. */
export function LastActivity({ iso, idleDays }: { iso: string | null; idleDays: number | null }) {
  if (idleDays === null || !iso) return <>Unknown</>;
  return (
    <time dateTime={iso.slice(0, 10)} title={iso.slice(0, 10)}>
      {daysAgoText(idleDays)}
    </time>
  );
}

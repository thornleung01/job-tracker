// Times are ISO-8601 UTC strings without milliseconds, like jobtracker/db.py's iso(), so string comparison orders them.

const DAY_MS = 86_400_000;

export function iso(when: Date | string | number): string {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Not a date: ${String(when)}`);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function parseIso(value: string): Date {
  return new Date(value);
}

export function addDays(when: Date, days: number): Date {
  return new Date(when.getTime() + days * DAY_MS);
}

/** Whole days between an ISO time and now (rounded down), or null when unknown. Mirrors web.py's _days_since. */
export function daysSince(value: string | null | undefined, now: Date = new Date()): number | null {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / DAY_MS);
}

/** Your calendar day (local time) as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isDayString(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** Python's round(): halves go to the even neighbour, so percentages match stats.py exactly. */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

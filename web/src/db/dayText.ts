// A calendar day written for people. Plain TypeScript (no React) so the logic layer can use it; TimeText re-exports it.
import { dayOf } from "./time";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * A stored time or day (see dayOf in time.ts for which day a time stands for) written for people: "October 21, 2026" when
 * there is room ("long"), "Oct 21" when it is tight ("short", with the year added when it is not this year), and "Oct 21"
 * always, never with a year, when the reader knows the year already ("plain"). "Unknown" when missing.
 * `timeZone` is for tests.
 */
export function dayText(
  value: string | null | undefined, style: "long" | "short" | "plain" = "long", now: Date = new Date(), timeZone?: string,
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayOf(value, timeZone));
  if (!m) return "Unknown";
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const name = MONTHS[month - 1];
  if (!name || day < 1 || day > 31) return "Unknown";
  if (style === "long") return `${name} ${day}, ${year}`;
  return `${name.slice(0, 3)} ${day}${style === "plain" || year === now.getFullYear() ? "" : `, ${year}`}`;
}

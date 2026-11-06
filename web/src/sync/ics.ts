// A calendar file (RFC 5545) for interview days. Made on this device and saved to it: nothing is sent anywhere.
// Company, role and stage come from emails and links, so they are untrusted: each is cut to one short line and escaped,
// and nothing in them can start another line (an extra property) in the file.
import { config } from "../config";
import { MAX_COMPANY_CHARS, MAX_LINK_CHARS, MAX_ROLE_CHARS, MAX_STAGE_CHARS } from "../db/limits";
import { isDayString, iso, shiftDay } from "../db/time";
import { pipeline } from "./pipeline";
import { oneLine } from "./safeText";

export interface IcsEvent {
  appId: number;
  company: string;
  role: string;
  /** the application's stage, named in the entry's description; may be empty */
  stage: string;
  /** the interview day, YYYY-MM-DD */
  day: string;
}

/** RFC 5545 section 3.1: a line is at most 75 octets before its CRLF. */
const FOLD_AT = 75;
const PRODID = "-//Job Tracker//Interviews//EN";

/** "20261105" for a YYYY-MM-DD. */
const compact = (day: string) => day.replaceAll("-", "");

/** TEXT values (RFC 5545 section 3.3.11): backslash, semicolon and comma are escaped, a line break becomes \n. */
function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

const octets = (cp: number) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/** Folds a line so no physical line passes 75 octets (the leading space of a continuation counts), never inside a character. */
function fold(line: string): string {
  const lines: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = octets(ch.codePointAt(0)!);
    if (size + n > FOLD_AT) {
      lines.push(current);
      current = " ";
      size = 1;
    }
    current += ch;
    size += n;
  }
  lines.push(current);
  return lines.join("\r\n");
}

/** The role to name, or "" when it isn't known. */
const knownRole = (role: string): string => {
  const r = oneLine(role, MAX_ROLE_CHARS);
  return r === pipeline().UNKNOWN_ROLE ? "" : r;
};

/** The file name for one interview day. */
export const icsFilename = (day: string): string => `job-tracker-interview-${day}.ics`;

/**
 * An iCalendar file with one all-day entry per interview day. `events` that name the same application and day make one entry
 * (its UID is the same on every download, so importing again updates the entry instead of adding a copy). Entries with a
 * day that isn't a real date are left out. `now` stamps the file; `baseUrl` is the address of this site, for the link back.
 * With no events the file has no entries.
 */
export function icsForInterviews(events: readonly IcsEvent[], now: Date, baseUrl: string = config.redirectUri): string {
  const stamp = iso(now).replace(/[-:]/g, "");
  const site = oneLine(baseUrl, MAX_LINK_CHARS);
  const unique = new Map<string, IcsEvent>();
  for (const e of events) {
    if (!Number.isSafeInteger(e.appId) || e.appId < 0 || !isDayString(e.day)) continue;
    const uid = `jobtracker-${e.appId}-${compact(e.day)}@job-tracker`;
    if (!unique.has(uid)) unique.set(uid, e);
  }
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${PRODID}`, "CALSCALE:GREGORIAN"];
  for (const [uid, e] of [...unique].sort(([, a], [, b]) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.appId - b.appId))) {
    const company = oneLine(e.company, MAX_COMPANY_CHARS);
    const role = knownRole(e.role);
    const stage = oneLine(e.stage, MAX_STAGE_CHARS);
    const summary = `Interview${company ? `: ${company}` : ""}${role ? ` - ${role}` : ""}`;
    const description = [...(stage ? [`Stage: ${stage}`] : []), `Open in Job Tracker: ${site}#/app/${e.appId}`].join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.day)}`,
      `DTEND;VALUE=DATE:${compact(shiftDay(e.day, 1))}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(description)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

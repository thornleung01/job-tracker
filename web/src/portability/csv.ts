// The applications as a spreadsheet file (CSV): one row per application, for Excel, Numbers and Google Sheets.
// Company and role text comes from emails and links, so every field is made safe against spreadsheet formula injection.
import type { ApplicationRow } from "../db/schema";
import { dayOf, localToday } from "../db/time";

export const CSV_HEADERS = [
  "Company", "Role", "Stage", "Applied", "Last activity", "Emails", "Interview rounds", "Posting link", "Offer salary", "Offer deadline",
] as const;

/** What one row needs: an application list row (see listApplications) has all of it. */
export type CsvRow = Pick<ApplicationRow, "company" | "role" | "stage" | "appliedAt" | "lastActivity" | "postingUrl" | "offerSalary" | "offerDeadline"> & {
  nEmails: number;
  rounds: number | null;
};

/** Lets Excel know the file is UTF-8, so accents survive. */
const BOM = "﻿";
const EOL = "\r\n";

/** A field that starts with one of these would be run as a formula by a spreadsheet. */
const FORMULA_START = /^\s*[=+\-@]|^[\t\r]/;

/** One field, safe to write: a leading ' defuses a formula, then RFC 4180 quoting when it holds a comma, quote or line break. */
export function csvField(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The whole file as text: BOM, a header row, then one row per application, all with CRLF line ends. */
export function applicationsToCsv(rows: readonly CsvRow[]): string {
  const lines = [CSV_HEADERS.map(csvField).join(",")];
  for (const r of rows) {
    lines.push([
      r.company, r.role, r.stage, dayOf(r.appliedAt), dayOf(r.lastActivity), r.nEmails, r.rounds, r.postingUrl, r.offerSalary, r.offerDeadline,
    ].map(csvField).join(","));
  }
  return BOM + lines.join(EOL) + EOL;
}

/** Dated with your own day, so an evening export isn't named for tomorrow. */
export const csvFilename = (now: Date = new Date()) => `job-tracker-applications-${localToday(now)}.csv`;

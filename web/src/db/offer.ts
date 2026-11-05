// Offer details: a free-text salary and a decision deadline. One rule, used when they are saved and when they are imported:
// saving refuses a bad value (ActionError), importing drops it.
import { ActionError } from "./errors";
import { isDayString } from "./time";

export const OFFER_SALARY_MAX = 60;
export const OFFER_SALARY_MESSAGE = `Keep the salary to ${OFFER_SALARY_MAX} characters or fewer.`;
export const OFFER_DEADLINE_MESSAGE = "Enter the deadline as year-month-day, for example 2026-10-15.";

const CONTROL = /[\u0000-\u001f\u007f]/;

/** The salary text with the spaces tidied, or null when it can't be kept. "" means none. */
function parseSalary(raw: unknown): string | null {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > OFFER_SALARY_MAX ? null : text;
}

/** Checks salary text before it is saved. "" means none. Throws ActionError for text that is too long. */
export function cleanOfferSalary(raw: string): string {
  const clean = parseSalary(raw);
  if (clean === null) throw new ActionError(OFFER_SALARY_MESSAGE);
  return clean;
}

/** Checks a deadline before it is saved. "" means none. A day in the past is fine. Throws ActionError for anything else. */
export function cleanOfferDeadline(raw: string): string {
  const day = (raw ?? "").trim();
  if (day && !isDayString(day)) throw new ActionError(OFFER_DEADLINE_MESSAGE);
  return day;
}

/** For importing and showing: the salary, or undefined when it is missing, not text, has control characters other than spaces or is too long. */
export function safeOfferSalary(raw: unknown): string | undefined {
  if (typeof raw === "string" && CONTROL.test(raw.replace(/\s/g, " "))) return undefined;
  return parseSalary(raw) || undefined;
}

/** For importing and showing: the deadline, or undefined when it is not a real YYYY-MM-DD day. */
export function safeOfferDeadline(raw: unknown): string | undefined {
  return typeof raw === "string" && isDayString(raw) ? raw : undefined;
}

// Offer details: a free-text salary and a decision deadline. One rule, used when they are saved and when they are imported:
// saving refuses a bad value (ActionError), importing drops it.
import { ActionError } from "./errors";
import { isDayString } from "./time";

export const OFFER_SALARY_MAX = 60;
const OFFER_SALARY_MESSAGE = `Keep the salary to ${OFFER_SALARY_MAX} characters or fewer.`;
const OFFER_SALARY_TEXT_MESSAGE = "The salary has characters that can't be saved. Use plain text.";
const OFFER_DEADLINE_MESSAGE = "Enter the deadline as year-month-day, for example 2026-10-15.";

/** Control characters (tab and line breaks are already spaces by now) and the invisible bidi controls that can flip how text reads. */
const UNSAFE = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;

type Salary = { text: string } | { error: string };

/** The one salary rule: the text with its spaces tidied, or why it can't be kept. "" means none. */
function parseSalary(raw: unknown): Salary {
  if (raw === undefined || raw === null) return { text: "" };
  if (typeof raw !== "string") return { error: OFFER_SALARY_TEXT_MESSAGE };
  const text = raw.replace(/\s+/g, " ").trim();
  if (UNSAFE.test(text)) return { error: OFFER_SALARY_TEXT_MESSAGE };
  return text.length > OFFER_SALARY_MAX ? { error: OFFER_SALARY_MESSAGE } : { text };
}

/** Checks salary text before it is saved. "" means none. Throws ActionError for text that is too long or has unsafe characters. */
export function cleanOfferSalary(raw: string): string {
  const salary = parseSalary(raw);
  if ("error" in salary) throw new ActionError(salary.error);
  return salary.text;
}

/** Checks a deadline before it is saved. "" means none. A day in the past is fine. Throws ActionError for anything else. */
export function cleanOfferDeadline(raw: string): string {
  const day = raw.trim();
  if (day && !isDayString(day)) throw new ActionError(OFFER_DEADLINE_MESSAGE);
  return day;
}

/**
 * For importing and showing: the salary, or undefined when it is missing or breaks the salary rule. It is the same rule
 * saving uses, so a value that saves also imports.
 */
export function safeOfferSalary(raw: unknown): string | undefined {
  const salary = parseSalary(raw);
  return "text" in salary ? salary.text || undefined : undefined;
}

/** For importing and showing: the deadline, or undefined when it is not a real YYYY-MM-DD day. */
export function safeOfferDeadline(raw: unknown): string | undefined {
  return typeof raw === "string" && isDayString(raw) ? raw : undefined;
}

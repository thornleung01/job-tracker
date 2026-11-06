// A follow-up email or a cover letter to write in the person's own mail service. The app only reads mail: this builds the text
// and a link that opens a new, unsent message in Gmail or Outlook, and the person sends it themselves. The text goes to Gmail
// or Outlook only when they open the link.
import { MAX_ADDRESS_CHARS, MAX_COMPANY_CHARS, MAX_NAME_CHARS, MAX_ROLE_CHARS, MAX_SUBJECT_CHARS } from "../db/limits";
import { dayOf } from "../db/time";
import { dayText } from "../db/dayText";
import type { MailLink } from "./links";
import { pipeline } from "./pipeline";
import { oneLine } from "./safeText";

export interface DraftApp {
  company: string;
  role: string;
  /** when the application was made (a stored time or day), or null */
  appliedAt: string | null;
}

export interface DraftContact {
  name: string;
  email: string;
}

export interface FollowUpDraft {
  /** one address, or "" when there is nobody to write to */
  to: string;
  subject: string;
  body: string;
}

/** A first name is letters, with the hyphen, apostrophe and full stop of "Jean-Luc", "O'Brien" and "Dr.". Anything else is not greeted by. */
const NAME_WORD = /^[\p{L}\p{M}][\p{L}\p{M}'\u2019.-]*$/u;

/** The first name to greet, or "" when there is no name that looks like one. */
export function firstName(name: string): string {
  const first = oneLine(name, MAX_NAME_CHARS).replace(/,/g, " ").trim().split(" ")[0] ?? "";
  return NAME_WORD.test(first) ? first : "";
}

/** `oneLine` for text that goes into the message: no angle brackets either, so a name or company from an email can't carry a tag into a mail service that shows it as markup. */
const plain = (text: string, max: number): string => oneLine(String(text).replace(/[<>]/g, " "), max);

/** "October 14" for a day in the current year, "October 14, 2025" for another year, or "" when it isn't a known day up to today. */
function appliedOn(appliedAt: string | null, today: string): string {
  const day = dayOf(appliedAt);
  if (!day || day > today) return "";
  const long = dayText(day, "long");
  return day.slice(0, 4) === today.slice(0, 4) ? long.replace(/, \d{4}$/, "") : long;
}

/**
 * An address that is safe to put in a compose link, or "": line breaks are removed, then it must be one plain address that
 * passes the same check a reply uses (and takes replies), not a "Name <address>" or a list of addresses.
 */
function safeAddress(email: string): string {
  if (typeof email !== "string") return "";
  const plain = email.replace(/[\r\n]/g, "").trim();
  const to = pipeline().recipient(plain) ?? "";
  return to === plain && to.length <= MAX_ADDRESS_CHARS && !/[,;<>\s]/.test(to) ? to : "";
}

/** Percent-encodes everything but letters, digits and _ . ~ - (so a space, a newline, & and # can't end a value early). Safe for any text. */
function encode(text: string): string {
  return Array.from(new TextEncoder().encode(text), (b) => {
    const ch = String.fromCharCode(b);
    return /[A-Za-z0-9_.~-]/.test(ch) ? ch : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");
}

/**
 * The follow-up to send for an application, written for `contact` (null when nobody is known). `today` is the viewer's day
 * (YYYY-MM-DD): it decides whether the apply date needs a year. Every name is cut to the limits the app saves and made one
 * line, so nothing in them can add a header (a second recipient, a Bcc) to the message. There is no signature: the app
 * doesn't know the sender's name.
 */
export function followUpDraft(app: DraftApp, contact: DraftContact | null, today: string): FollowUpDraft {
  const company = plain(app.company, MAX_COMPANY_CHARS);
  const role = plain(app.role, MAX_ROLE_CHARS);
  const knownRole = role && role !== pipeline().UNKNOWN_ROLE ? role : "";
  const at = company ? ` at ${company}` : "";
  const subject = oneLine(`Following up on my application${knownRole ? ` for ${knownRole}` : ""}${at}`, MAX_SUBJECT_CHARS);
  const date = appliedOn(app.appliedAt, today);
  const what = knownRole ? `for the ${knownRole} role${at}` : company ? `to ${company}` : "";
  const applied = ["I applied", what, date ? `on ${date}` : ""].filter(Boolean).join(" ");
  const name = contact ? firstName(contact.name) : "";
  const body = [
    name ? `Hi ${name},` : "Hello,",
    "",
    `${applied} and wanted to follow up. Is there any update on my application?`,
    "",
    "Thank you for your time.",
  ].join("\n");
  return { to: contact ? safeAddress(contact.email) : "", subject, body };
}

/**
 * The mail for a cover letter: "Application for <role>" (or "Application to <company>" when the role isn't known) with the letter
 * as the text, written for `contact` like a follow-up. The recipient and the line breaks are checked in draftLink, which also
 * cuts the text to MAX_DRAFT_BODY_CHARS.
 */
export function coverLetterDraft(app: Pick<DraftApp, "company" | "role">, contact: DraftContact | null, letter: string): FollowUpDraft {
  const company = plain(app.company, MAX_COMPANY_CHARS);
  const role = plain(app.role, MAX_ROLE_CHARS);
  const knownRole = role && role !== pipeline().UNKNOWN_ROLE ? role : "";
  const subject = oneLine(knownRole ? `Application for ${knownRole}` : company ? `Application to ${company}` : "Application", MAX_SUBJECT_CHARS);
  return { to: contact ? safeAddress(contact.email) : "", subject, body: String(letter) };
}

/** The most characters of the text that go into a compose link. Longer text is cut, because mail services refuse very long links. */
export const MAX_DRAFT_BODY_CHARS = 3000;

// The mail services a draft may be opened in, and the only hosts a link to them may have.
const HOSTS: ReadonlySet<string> = new Set(["mail.google.com", "outlook.office.com", "outlook.live.com"]);
// Same split as pipeline/links.ts replyLink: personal Outlook addresses use outlook.live.com, work and school ones outlook.office.com.
const CONSUMER_OUTLOOK = ["outlook.com", "hotmail.com", "live.com", "msn.com"];

/**
 * (button label, https URL) that opens `draft` as a new message in the account's own mail service, or null when the service
 * is unknown. The label is "Draft <what> in Gmail" ("Draft in Gmail" when `what` is empty). Built like replyLink in pipeline/links.ts (same hosts, same account rules), with the body filled in and no "Re:".
 * Only an https link to Gmail or Outlook is ever returned.
 */
export function draftLink(
  provider: string, account: string | null | undefined, draft: FollowUpDraft, webLink: string | null | undefined = null, what = "follow-up",
): MailLink | null {
  const to = safeAddress(draft.to);
  const subject = oneLine(draft.subject, MAX_SUBJECT_CHARS);
  const text = String(draft.body).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ");
  const body = Array.from(text).slice(0, MAX_DRAFT_BODY_CHARS).join(""); // by character, so a cut never splits an emoji
  const named = (service: string) => (what ? `Draft ${what} in ${service}` : `Draft in ${service}`);
  const query = (...pairs: [string, string][]) => pairs.filter(([, v]) => v !== "").map(([k, v]) => `${k}=${encode(v)}`).join("&");
  let label: string;
  let url: string;
  if (provider === "gmail" && account) {
    label = named("Gmail");
    url = `https://mail.google.com/mail/?authuser=${encode(account)}&view=cm&fs=1&${query(["to", to], ["su", subject], ["body", body])}`;
  } else if (provider === "outlook") {
    const acct = account || "";
    const work =
      Boolean(webLink && webLink.startsWith("https://outlook.office")) ||
      (acct.includes("@") && !CONSUMER_OUTLOOK.some((d) => acct.toLowerCase().endsWith(d)));
    const host = work ? "outlook.office.com/mail" : "outlook.live.com/mail/0";
    label = named("Outlook");
    url = `https://${host}/deeplink/compose?${query(["to", to], ["subject", subject], ["body", body])}`;
  } else {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !HOSTS.has(parsed.hostname)) return null;
  } catch {
    return null;
  }
  return { label, url };
}

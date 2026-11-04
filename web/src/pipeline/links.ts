// Port of jobtracker/links.py: links from a stored email to the original message in the user's web mail.
import { py, pyFull, match, test } from "./pyre";
import { splitSender } from "./mailtext";
import { quote, strip } from "./pystr";

export type MailLink = readonly [label: string, url: string];

/**
 * (button label, https URL), or null when the original can't be linked to.
 *
 * Gmail has no per-message link in its API, but a thread id opens the conversation for a given account. Outlook gives a
 * ready-made webLink, which is stored when the mail is synced.
 */
export function mailboxLink(
  provider: string,
  address: string | null | undefined,
  threadId: string | null | undefined,
  webLink: string | null | undefined,
): MailLink | null {
  if (provider === "gmail" && address && threadId) {
    return ["Open in Gmail", `https://mail.google.com/mail/?authuser=${quote(address)}#all/${quote(threadId)}`];
  }
  if (provider === "outlook" && webLink && webLink.startsWith("https://")) {
    return ["Open in Outlook", webLink]; // only ever link to https, never anything stored that could be a script URL
  }
  return null;
}

export const NO_REPLY = py(String.raw`(?:^|[._-])(?:no-?reply|do-?not-?reply|donotreply|mailer-daemon|bounces?|notifications?)(?:[._-]|$)`, "i");
export const ADDRESS_FULL = pyFull(String.raw`[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+`);
const CONSUMER_OUTLOOK = ["outlook.com", "hotmail.com", "live.com", "msn.com"];
const RE_PREFIX = py("re:", "iy");

/** Is `to` a plausible address (the Python `_ADDRESS.fullmatch`)? */
export const isAddress = (to: string): boolean => match(ADDRESS_FULL, to) !== null;

/**
 * (button label, https URL) that opens a reply to this sender in the account's own web mail, or null.
 *
 * The app never sends mail (it only has permission to read), so a reply is written in Gmail or Outlook itself: the link
 * opens a new message there, already addressed, with "Re:" and the subject filled in. Senders that say they don't take
 * replies ("no-reply@...") get none.
 */
export function replyLink(
  provider: string,
  account: string | null | undefined,
  sender: string,
  subject: string | null | undefined,
  webLink: string | null | undefined = null,
): MailLink | null {
  const [, to] = splitSender(sender);
  if (!isAddress(to || "") || test(NO_REPLY, to.split("@")[0])) return null;
  let subj = strip(subject || "");
  if (!match(RE_PREFIX, subj)) subj = strip(`Re: ${subj}`);
  if (provider === "gmail" && account) {
    return ["Reply in Gmail", `https://mail.google.com/mail/?authuser=${quote(account)}&view=cm&fs=1&to=${quote(to)}&su=${quote(subj)}`];
  }
  if (provider === "outlook") {
    const acct = account || "";
    const work =
      Boolean(webLink && webLink.startsWith("https://outlook.office")) ||
      (acct.includes("@") && !CONSUMER_OUTLOOK.some((d) => acct.toLowerCase().endsWith(d)));
    const host = work ? "outlook.office.com/mail" : "outlook.live.com/mail/0";
    return ["Reply in Outlook", `https://${host}/deeplink/compose?to=${quote(to)}&subject=${quote(subj)}`];
  }
  return null;
}

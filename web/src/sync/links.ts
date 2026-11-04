// Links from a stored email to the original message in the user's web mail. The rules live in the pipeline port of
// jobtracker/links.py; these wrappers hand the UI { label, url } objects. The hosted edition never sends mail, so a
// reply is written in Gmail or Outlook itself.
import { pipeline } from "./pipeline";
import type { MailLink } from "./pipelineTypes";

export type { MailLink };

export const mailboxLink = (provider: string, address: string | null, threadId: string | null, webLink: string | null): MailLink | null =>
  pipeline().mailboxLink(provider, address, threadId, webLink);

export const replyLink = (provider: string, account: string | null, sender: string, subject: string | null, webLink: string | null = null): MailLink | null =>
  pipeline().replyLink(provider, account, sender, subject, webLink);

/** Where a reply to this sender would go, or null when they don't take replies. */
export const recipient = (sender: string): string | null => pipeline().recipient(sender);

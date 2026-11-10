import { DraftNeedsMailbox } from "./DraftNeedsMailbox";
import type { MailLink } from "../../sync/links";
import "./followup.css";

interface Props {
  /** null when there is no mailbox to open the draft in */
  link: MailLink | null;
  /** who the message is addressed to, or "" */
  to: string;
  /** the application has gone quiet, so this is its main action */
  primary?: boolean;
}

/**
 * Opens a new message in the account's own mail service with the follow-up already written. The app never sends it: the
 * person reads it, changes it and sends it themselves. Only an https link is ever shown; with no mailbox there is one muted line instead.
 */
export function DraftFollowUp({ link, to, primary }: Props) {
  if (!link) return <DraftNeedsMailbox />;
  if (!link.url.startsWith("https://")) return null;
  const service = link.label.replace("Draft follow-up in ", "");
  return (
    <a className={`btn small${primary ? " primary" : ""}`} href={link.url} target="_blank" rel="noopener noreferrer"
       aria-label={`Draft follow-up in ${service} (opens in a new tab)`}
       title={to ? `Opens a new message to ${to} in ${service}` : `Opens a new message in ${service}`}>Draft follow-up</a>
  );
}

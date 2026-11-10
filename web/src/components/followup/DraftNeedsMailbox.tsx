import { DRAFT_NEEDS_MAILBOX, GATES } from "../../app/gates";
import { isLocalMode } from "../../config";

/**
 * The muted line where a Draft in Gmail or Outlook button would be, when there is no mailbox to open it in. It links to the Mail
 * tab like every other mailbox gate. The demo build can't connect mail at all, so it says nothing there.
 */
export function DraftNeedsMailbox() {
  if (isLocalMode()) return null;
  const { href } = GATES.mailbox;
  return <span className="small muted">{href ? <a href={href}>{DRAFT_NEEDS_MAILBOX}</a> : DRAFT_NEEDS_MAILBOX}</span>;
}

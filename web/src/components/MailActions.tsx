import type { MailLink } from "../sync/links";

const safe = (link: MailLink | null | undefined): link is MailLink => Boolean(link && link.url.startsWith("https://"));

/**
 * Reply and Open links for one email. They are written in Gmail or Outlook itself, in a new tab, because the hosted edition
 * only ever reads mail. `quiet` drops the reply link to a plain button, for pages that have their own main action.
 */
export function MailActions({ open, reply, quiet }: { open: MailLink | null | undefined; reply: MailLink | null | undefined; quiet?: boolean }) {
  return (
    <div className="mail-actions">
      {safe(reply) ? <a className={quiet ? "btn" : "btn primary"} href={reply.url} target="_blank" rel="noopener noreferrer" aria-label={`${reply.label} (opens in a new tab)`}>{reply.label}</a> : null}
      {safe(open) ? <a className="btn" href={open.url} target="_blank" rel="noopener noreferrer" aria-label={`${open.label} (opens in a new tab)`}>{open.label}</a> : null}
      {!safe(reply) ? <span className="small muted">This sender doesn't take replies.</span> : null}
    </div>
  );
}

import type { MailLink } from "../sync/links";

const safe = (link: MailLink | null | undefined): link is MailLink => Boolean(link && link.url.startsWith("https://"));

/**
 * Reply and Open links for one email. They are written in Gmail or Outlook itself, in a new tab, because the hosted edition
 * only ever reads mail.
 */
export function MailActions({ open, reply }: { open: MailLink | null | undefined; reply: MailLink | null | undefined }) {
  return (
    <div className="mail-actions">
      {safe(reply) ? <a className="btn primary" href={reply.url} target="_blank" rel="noopener noreferrer">{reply.label}</a> : null}
      {safe(open) ? <a className="btn" href={open.url} target="_blank" rel="noopener noreferrer">{open.label}</a> : null}
      {!safe(reply) ? <span className="small muted">This sender doesn't take replies.</span> : null}
    </div>
  );
}

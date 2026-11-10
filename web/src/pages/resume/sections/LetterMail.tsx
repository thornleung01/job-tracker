// "Draft letter in Gmail" (or Outlook): a new message with the saved letter, in the same mailbox the application's mail comes from. It needs an
// application to address it from, so it only exists once Save has made one. In the action bar it is the whole answer (with one muted line when
// there is no mailbox to open it in, nothing in the demo); beside Copy text it is only the link, shown when there is one.
import { useQuery } from "../../../app/useQuery";
import { isLocalMode } from "../../../config";
import { DraftNeedsMailbox } from "../../../components/followup/DraftNeedsMailbox";
import type { JobTrackerDB } from "../../../db/schema";
import { coverLetterMail } from "../../../sync/applicationActions";

interface Props {
  db: JobTrackerDB;
  appId: number;
  /** the letter as saved */
  letter: string;
  /** the action bar's version: wrapped as a note, and says so when no mailbox is connected */
  hint?: boolean;
}

export function LetterMail({ db, appId, letter, hint = false }: Props) {
  const mail = useQuery(() => coverLetterMail(db, appId, letter), [db, appId, letter]);
  const link = mail?.link;
  if (mail && !link) return hint && !isLocalMode() ? <p className="rs-note"><DraftNeedsMailbox /></p> : null;
  if (!link || !link.url.startsWith("https://")) return null;
  const label = `Draft letter in ${link.label.replace("Draft in ", "")}`;
  const a = <a className="btn" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${label} (opens in a new tab)`}>{label}</a>;
  return hint ? <p className="rs-note">{a}</p> : a;
}

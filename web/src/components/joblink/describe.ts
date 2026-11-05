import type { JobDraft } from "../../jobs/types";

/** Which of the form's fields currently hold what the draft says. */
export interface Held {
  company: boolean;
  role: boolean;
}

/** Hint under a field whose value is a guess. */
export function guessedHint(source: JobDraft["source"]): string {
  if (source === "paste") return "Guessed from the text";
  if (source === "bookmarklet") return "Guessed from the page";
  return "Guessed from the link";
}

/** "Greenhouse" for a posting on a board we can ask, else a generic phrase. Only the host is read. */
export function boardName(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "the job board";
  }
  const is = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (is("greenhouse.io")) return "Greenhouse";
  if (is("lever.co")) return "Lever";
  if (is("ashbyhq.com")) return "Ashby";
  if (is("smartrecruiters.com")) return "SmartRecruiters";
  return "the job board";
}

const withPlace = (text: string, draft: JobDraft) => (draft.location.trim() ? `${text} Location: ${draft.location.trim()}.` : text);

export const NOTHING_FROM_LINK = "We couldn't read details from this link. Add them below.";
export const NOTHING_FROM_TEXT = "We couldn't read details from that text. Add them below.";
export const KEPT_TYPED = "Kept what you typed. Check the company and role.";
export const FROM_PAGE = "Filled in from the page you were viewing. Check it, then save.";

/**
 * One plain sentence about what a draft did to the form. `held` says which fields now hold the draft's values, so a field
 * the person had already typed in is never claimed as filled. Everything in `draft` is untrusted text: callers render it as text.
 */
export function describeDraft(draft: JobDraft, held: Held): string {
  if (draft.source === "bookmarklet") return withPlace(FROM_PAGE, draft);
  const hasValues = Boolean(draft.company.trim() || draft.role.trim());
  const parts = [held.company ? draft.company.trim() : "", held.role ? draft.role.trim() : ""].filter(Boolean);
  if (!hasValues) return draft.source === "paste" ? NOTHING_FROM_TEXT : NOTHING_FROM_LINK;
  if (!parts.length) return KEPT_TYPED;
  const guessed = (held.company && draft.guessed.company) || (held.role && draft.guessed.role);
  const origin = draft.source === "paste" ? "the text" : "the link";
  if (guessed) return withPlace(`Guessed from ${origin}: check the company and role.`, draft);
  const from = draft.source === "api" ? boardName(draft.url) : origin;
  const names = parts.join(", ");
  return withPlace(`Filled in from ${from}: ${names}${names.endsWith(".") ? "" : "."}`, draft);
}

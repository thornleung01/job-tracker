import { GUESS_COMPANY_CHARS, GUESS_LOCATION_CHARS, GUESS_ROLE_CHARS } from "../../db/limits";
import { safePostingUrl } from "../../db/postingUrl";
import { EMPTY_DRAFT, type JobDraft } from "../types";

// The hash a bookmarklet sends is UNTRUSTED: any web page can link to this app with a crafted hash. Everything is
// validated and capped again here, and callers must render the result as text only.

/** Strip control and bidi characters, collapse whitespace, cap the length. */
export function cleanField(value: string | null | undefined, max: number): string {
  return (value ?? "")
    .replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * The posting link, by the same rule as saving one (db/postingUrl.ts). A link over the limit first loses its query string,
 * which a hash can carry in full. "" when it still isn't an acceptable link.
 */
export function safeUrl(raw: string | null | undefined): string {
  const text = cleanField(raw, 2000);
  if (!text) return "";
  const link = safePostingUrl(text);
  if (link) return link;
  try {
    const parsed = new URL(text);
    parsed.search = "";
    return safePostingUrl(parsed.href);
  } catch {
    return "";
  }
}

/** What the bookmarklet sent, from the app's hash query (#/?add=1&c=..). null unless add=1. Unknown parameters are ignored. */
export function draftFromHash(query: URLSearchParams): JobDraft | null {
  if (query.get("add") !== "1") return null;
  const company = cleanField(query.get("c"), GUESS_COMPANY_CHARS);
  const role = cleanField(query.get("r"), GUESS_ROLE_CHARS);
  const flags = /^[0-3]$/.test(query.get("g") ?? "") ? Number(query.get("g")) : 0;
  return {
    ...EMPTY_DRAFT,
    company,
    role,
    location: cleanField(query.get("l"), GUESS_LOCATION_CHARS),
    url: safeUrl(query.get("u")),
    source: "bookmarklet",
    guessed: { company: company !== "" && (flags & 1) === 1, role: role !== "" && (flags & 2) === 2 },
  };
}

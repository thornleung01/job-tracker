import { EMPTY_DRAFT, type JobDraft } from "../types";

// The hash a bookmarklet sends is UNTRUSTED: any web page can link to this app with a crafted hash. Everything is
// validated and capped again here, and callers must render the result as text only.

export const LIMITS = { company: 60, role: 90, location: 80, url: 500 } as const;

/** Strip control and bidi characters, collapse whitespace, cap the length. */
export function cleanField(value: string | null | undefined, max: number): string {
  return (value ?? "")
    .replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** An http(s) URL with no credentials, at most 500 characters (a longer one loses its query string, then is dropped). "" otherwise. */
export function safeUrl(raw: string | null | undefined): string {
  const text = cleanField(raw, 2000);
  if (!text) return "";
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return "";
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password || !parsed.hostname) return "";
  let out = parsed.href;
  if (out.length > LIMITS.url) {
    parsed.search = "";
    out = parsed.href;
  }
  return out.length > LIMITS.url ? "" : out;
}

/** What the bookmarklet sent, from the app's hash query (#/?add=1&c=..). null unless add=1. Unknown parameters are ignored. */
export function draftFromHash(query: URLSearchParams): JobDraft | null {
  if (query.get("add") !== "1") return null;
  const company = cleanField(query.get("c"), LIMITS.company);
  const role = cleanField(query.get("r"), LIMITS.role);
  const flags = /^[0-3]$/.test(query.get("g") ?? "") ? Number(query.get("g")) : 0;
  return {
    ...EMPTY_DRAFT,
    company,
    role,
    location: cleanField(query.get("l"), LIMITS.location),
    url: safeUrl(query.get("u")),
    source: "bookmarklet",
    guessed: { company: company !== "" && (flags & 1) === 1, role: role !== "" && (flags & 2) === 2 },
  };
}

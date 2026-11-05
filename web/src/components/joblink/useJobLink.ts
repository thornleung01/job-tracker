import { useCallback, useEffect, useRef, useState } from "react";
import type { JobDraft } from "../../jobs/types";
import { describeDraft, guessedHint, type Held } from "./describe";
import { realJobLinkDeps, type JobLinkDeps } from "./deps";

export type FormField = "company" | "role" | "url";
type Values = Record<FormField, string>;
type Setters = Record<FormField, (value: string) => void>;

/** The posting text a person may paste: 200 KB of characters is far more than any job ad. */
export const MAX_PASTE_CHARS = 200_000;
/** How long after a paste the link is read, so a paste that arrives in pieces is read once. */
export const PASTE_DEBOUNCE_MS = 300;

export interface JobLinkFill {
  linkText: string;
  onLinkChange(value: string): void;
  /** Call from the field's paste event: reads the link shortly after, not on every keystroke. */
  onLinkPaste(): void;
  /** The "Fill in" button and Enter in the field. */
  fillFromLink(): void;
  pasteOpen: boolean;
  setPasteOpen(open: boolean): void;
  pasteText: string;
  setPasteText(text: string): void;
  readPastedText(): void;
  /** The plain-language line under the field, or "" before anything has run. */
  result: string;
  /** True while the job board is being asked. The form stays usable. */
  checking: boolean;
  /** "Guessed from the link" for a field whose value is a guess, else null. */
  hints: { company: string | null; role: string | null };
  /** True after a link was read and nothing useful came of it. */
  unreadable: boolean;
  /** Call from every form field's change handler: a field the person edits is theirs from then on. */
  edited(field: FormField): void;
  /** Fill a fresh form from a draft (bookmarklet arrival). Overwrites, and marks everything as filled for you. */
  adopt(draft: JobDraft): void;
  /** Abort anything in flight and forget the link, hints and result. */
  reset(): void;
}

/**
 * Fills the add form from a job link or pasted text. The form's own state stays with the page: this hook is handed the
 * current values and setters, and fills a field only if it is empty or still holds a value this hook put there.
 */
export function useJobLink(values: Values, set: Setters, deps: Partial<JobLinkDeps> = {}): JobLinkFill {
  const lib: JobLinkDeps = { ...realJobLinkDeps, ...deps };
  const libRef = useRef(lib);
  libRef.current = lib;
  const setRef = useRef(set);
  setRef.current = set;
  // What the fields hold right now, kept current when this hook sets one (a render may not have happened yet).
  const live = useRef<Values>(values);
  live.current = values;
  // The value this hook last put in each field. A field that differs from it was typed by a person.
  const auto = useRef<Record<FormField, string | null>>({ company: null, role: null, url: null });

  const [linkText, setLinkText] = useState("");
  const linkRef = useRef("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [result, setResult] = useState("");
  const [checking, setChecking] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [hints, setHints] = useState<{ company: string | null; role: string | null }>({ company: null, role: null });
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setChecking(false);
  }, []);
  useEffect(() => stop, [stop]);

  const writable = (field: FormField) => live.current[field] === "" || live.current[field] === auto.current[field];

  /** Puts a draft's values in the fields that are still free. Returns which fields now hold the draft's values. */
  const fill = (draft: JobDraft, overwrite = false): Held => {
    const hint = guessedHint(draft.source);
    for (const field of ["company", "role", "url"] as const) {
      const value = draft[field].trim();
      if (!value || !(overwrite || writable(field))) continue;
      setRef.current[field](value);
      live.current = { ...live.current, [field]: value };
      auto.current[field] = value;
      if (field !== "url") setHints((h) => ({ ...h, [field]: draft.guessed[field] ? hint : null }));
    }
    return { company: Boolean(draft.company.trim()) && live.current.company === draft.company.trim(), role: Boolean(draft.role.trim()) && live.current.role === draft.role.trim() };
  };

  const show = (draft: JobDraft, held: Held) => {
    setResult(describeDraft(draft, held));
    setUnreadable(!draft.company.trim() && !draft.role.trim());
  };

  const fillFromLink = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    controller.current?.abort();
    const raw = linkRef.current.trim();
    if (!raw) {
      controller.current = null;
      setChecking(false);
      setUnreadable(false);
      setResult("Paste a link first.");
      return;
    }
    const draft = libRef.current.parseJobUrl(raw);
    if (!draft) {
      controller.current = null;
      setChecking(false);
      setUnreadable(true);
      setResult("We couldn't read details from this link. Add them below.");
      return;
    }
    show(draft, fill(draft));
    const ask = new AbortController();
    controller.current = ask;
    setChecking(true);
    libRef.current.enrichJobDraft(draft, { signal: ask.signal }).then(
      (enriched) => {
        if (ask.signal.aborted) return;
        controller.current = null;
        setChecking(false);
        if (enriched && enriched !== draft) show(enriched, fill(enriched));
      },
      () => {
        if (ask.signal.aborted) return;
        controller.current = null;
        setChecking(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fillRef = useRef(fillFromLink);
  fillRef.current = fillFromLink;

  const onLinkChange = useCallback((value: string) => {
    linkRef.current = value;
    setLinkText(value);
    // A new link makes the answer for the old one stale. A paste in flight keeps its timer: the paste event comes first.
    controller.current?.abort();
    controller.current = null;
    setChecking(false);
  }, []);

  const onLinkPaste = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      fillRef.current();
    }, PASTE_DEBOUNCE_MS);
  }, []);

  const readPastedText = () => {
    const text = pasteText.slice(0, MAX_PASTE_CHARS);
    controller.current?.abort();
    controller.current = null;
    setChecking(false);
    const draft = text.trim() ? libRef.current.parsePastedText(text, linkRef.current.trim() || undefined) : null;
    if (!draft) {
      setUnreadable(false);
      setResult(text.trim() ? "We couldn't read details from that text. Add them below." : "Paste the posting text first.");
      return;
    }
    show(draft, fill(draft));
  };

  const edited = useCallback((field: FormField) => {
    auto.current[field] = null;
    if (field !== "url") setHints((h) => (h[field] ? { ...h, [field]: null } : h));
  }, []);

  const adopt = (draft: JobDraft) => {
    stop();
    auto.current = { company: null, role: null, url: null };
    live.current = { company: "", role: "", url: "" };
    for (const field of ["company", "role", "url"] as const) setRef.current[field]("");
    setHints({ company: null, role: null });
    fill(draft, true);
    setLinkText("");
    linkRef.current = "";
    setPasteText("");
    setPasteOpen(false);
    setUnreadable(false);
    setResult(describeDraft(draft, { company: true, role: true }));
  };

  const reset = useCallback(() => {
    stop();
    auto.current = { company: null, role: null, url: null };
    linkRef.current = "";
    setLinkText("");
    setPasteText("");
    setPasteOpen(false);
    setResult("");
    setUnreadable(false);
    setHints({ company: null, role: null });
  }, [stop]);

  return { linkText, onLinkChange, onLinkPaste, fillFromLink, pasteOpen, setPasteOpen, pasteText, setPasteText, readPastedText, result, checking, hints, unreadable, edited, adopt, reset };
}

// The result message at the top of the Settings page, and how a section reports into it. SettingsPage owns the
// message; each section is handed `say` and `clear` and never sees the state itself.

export type NoticeState = { kind: "ok" | "err"; lines: string[] } | null;

/** Shows a message at the top of the page and moves focus to it. */
export type Say = (kind: "ok" | "err", ...lines: string[]) => void;

/** What a section gets for talking to the page. */
export interface Reporter {
  say: Say;
  /** Removes the current message, for a section that is about to start something new. */
  clear(): void;
  /** Announces a quiet confirmation to screen readers only, like "Appearance saved". */
  announce(text: string): void;
}

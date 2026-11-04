// A one-shot message carried across a page change, for example "Removed Acme." after a delete sends you to Needs review.
// It lives in memory only, so a reload drops it.
let pending: string | null = null;

export function setFlash(message: string): void {
  pending = message;
}

/** Reads the message without clearing it, so a strict-mode double render still sees it. Pair with clearFlash in an effect. */
export function peekFlash(): string | null {
  return pending;
}

export function clearFlash(): void {
  pending = null;
}

// The Applications page's keyboard shortcuts as plain logic: which key (or two keys in a row) means what, and when a key is
// to be ignored. No React and no page here, so the table and the rules are tested on their own (tests/components/shortcuts).

export type ShortcutAction = "focusSearch" | "next" | "prev" | "toggleOpen" | "add" | "select" | "goSettings" | "clear" | "help";

export interface Shortcut {
  action: ShortcutAction;
  /** what it does, for the help dialog */
  label: string;
  /** the ways to do it: each is one key, or two keys pressed one after the other */
  sequences: readonly (readonly string[])[];
}

/** After `g`, the next key must come within this time. */
export const SEQUENCE_TIMEOUT_MS = 1000;

export const SHORTCUTS: readonly Shortcut[] = [
  { action: "focusSearch", label: "Search", sequences: [["/"]] },
  { action: "next", label: "Next application", sequences: [["j"]] },
  { action: "prev", label: "Previous application", sequences: [["k"]] },
  { action: "toggleOpen", label: "Open or close the application", sequences: [["Enter"], ["o"]] },
  { action: "select", label: "Tick or untick the application", sequences: [["x"]] },
  { action: "add", label: "Add an application", sequences: [["n"]] },
  { action: "goSettings", label: "Go to Settings", sequences: [["g", "s"]] },
  { action: "clear", label: "Clear the current application, or close this", sequences: [["Escape"]] },
  { action: "help", label: "Show this list", sequences: [["?"]] },
];

/** How a key is shown in the help: Enter, Esc, or the character. */
export const keyName = (key: string): string => (key === "Escape" ? "Esc" : key);

/** The parts of a keydown event the rules read. A real KeyboardEvent fits. */
export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** told apart from Caps Lock: a capital letter without Shift is Caps Lock, and still means the lower-case key */
  shiftKey?: boolean;
  target: EventTarget | null;
  isComposing?: boolean;
}

/** Inputs that take no typing: a key pressed while one has focus is not text being entered. */
const NOT_TEXT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "file", "image", "color"]);

/** True when the person is typing: a text field, a select, a textarea or editable text. Shortcuts stay out of the way there. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NOT_TEXT.has((target as HTMLInputElement).type);
  const editable = target.closest("[contenteditable]")?.getAttribute("contenteditable");
  return editable !== null && editable !== undefined && editable !== "false";
}

/** True for something that already answers Enter by itself (a link, a button, a summary): the shortcut leaves Enter to it, so nothing happens twice. */
export function answersEnter(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("a[href], button, summary, [role=button], [role=link], [role=menuitem]") !== null;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]);

/**
 * Turns key presses into actions. It remembers a pending `g` for SEQUENCE_TIMEOUT_MS, so `g` then `s` is "go to Settings" and `g`
 * then anything else (or a pause) is nothing, and that other key does nothing either. Keys are ignored while typing and when Ctrl, Meta or Alt is down. A modifier key
 * pressed on its own (the Shift before `?`) neither counts nor cancels a pending `g`.
 */
export class KeyMachine {
  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly timeoutMs: number = SEQUENCE_TIMEOUT_MS) {}

  /** The action this key press means, or null. */
  handle(e: KeyInput): ShortcutAction | null {
    // With Caps Lock on, `J` arrives without Shift: it is the j key. (Shift+J, a real capital, is not.)
    const key = !e.shiftKey && e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (MODIFIER_KEYS.has(key)) return null;
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || isTypingTarget(e.target)) {
      this.reset();
      return null;
    }
    const first = this.pending;
    this.reset();
    // The key after a `g` is the second half of a sequence or nothing: `g` then `j` doesn't move a row.
    if (first !== null) return lookup([first, key]);
    if (SEQUENCE_STARTS.has(key)) {
      this.pending = key;
      this.timer = setTimeout(() => this.reset(), this.timeoutMs);
      return null;
    }
    // Enter belongs to a focused link or button.
    if (key === "Enter" && answersEnter(e.target)) return null;
    return lookup([key]);
  }

  reset(): void {
    this.pending = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

const sameKeys = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

function lookup(keys: readonly string[]): ShortcutAction | null {
  return SHORTCUTS.find((s) => s.sequences.some((seq) => sameKeys(seq, keys)))?.action ?? null;
}

/** The first key of every two-key sequence. */
const SEQUENCE_STARTS: ReadonlySet<string> = new Set(SHORTCUTS.flatMap((s) => s.sequences.filter((q) => q.length > 1).map((q) => q[0])));

import { afterEach, describe, expect, it, vi } from "vitest";
import { SEQUENCE_TIMEOUT_MS, SHORTCUTS, KeyMachine, answersEnter, isTypingTarget, type KeyInput, type ShortcutAction } from "../../../src/components/shortcuts/keys";

afterEach(() => vi.useRealTimers());

const press = (m: KeyMachine, key: string, o: Partial<KeyInput> = {}) => m.handle({ key, ctrlKey: false, metaKey: false, altKey: false, target: document.body, ...o });
const el = (html: string): HTMLElement => {
  const box = document.createElement("div");
  box.innerHTML = html;
  document.body.append(box);
  return box.firstElementChild as HTMLElement;
};

describe("the key table", () => {
  const cases: [string[], ShortcutAction | null][] = [
    [["/"], "focusSearch"], [["j"], "next"], [["k"], "prev"], [["Enter"], "toggleOpen"], [["o"], "toggleOpen"], [["n"], "add"],
    [["x"], "select"], [["g", "s"], "goSettings"], [["Escape"], "clear"], [["?"], "help"],
    [["g"], null], [["g", "x"], null], [["s"], null], [["z"], null], [["Z"], null], [["Tab"], null], [[" "], null], [["ArrowDown"], null],
  ];
  it.each(cases)("%j means %s", (keys, action) => {
    const m = new KeyMachine();
    const seen = keys.map((k) => press(m, k));
    expect(seen.at(-1)).toBe(action);
    // only the last key of a sequence does anything
    expect(seen.slice(0, -1).every((a) => a === null)).toBe(true);
  });

  it("lists every action once in the table the help shows, each with at least one key", () => {
    const actions = SHORTCUTS.map((s) => s.action);
    expect(new Set(actions).size).toBe(actions.length);
    expect(actions.sort()).toEqual(["add", "clear", "focusSearch", "goSettings", "help", "next", "prev", "select", "toggleOpen"]);
    expect(SHORTCUTS.every((s) => s.sequences.length > 0 && s.label)).toBe(true);
  });
});

describe("the typing guard", () => {
  it.each([
    ['<input type="text">', true], ['<input>', true], ['<input type="search">', true], ['<textarea></textarea>', true], ['<select><option>a</option></select>', true],
    ['<div contenteditable="true"><span id="in">x</span></div>', true], ['<div contenteditable="">x</div>', true],
    ['<input type="checkbox">', false], ['<input type="radio">', false], ['<button>b</button>', false], ['<a href="#/">a</a>', false],
    ['<div contenteditable="false">x</div>', false], ['<div>plain</div>', false],
  ])("%s -> typing is %s", (html, typing) => {
    expect(isTypingTarget(el(html))).toBe(typing);
  });
  it("sees a child of editable text, and a target that is not an element", () => {
    expect(isTypingTarget(el('<div contenteditable="true"><span id="in">x</span></div>').querySelector("#in"))).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(document)).toBe(false);
  });
  it("ignores every shortcut while typing, and forgets a pending g", () => {
    const m = new KeyMachine();
    const input = el("<input>");
    for (const k of ["/", "j", "k", "Enter", "o", "n", "x", "Escape", "?"]) expect(press(m, k, { target: input })).toBeNull();
    press(m, "g");
    expect(press(m, "s", { target: input })).toBeNull();
    expect(press(m, "s")).toBeNull();   // the g was dropped by the typing in between
  });
  it("ignores keys with Ctrl, Meta or Alt held", () => {
    const m = new KeyMachine();
    for (const mod of ["ctrlKey", "metaKey", "altKey"] as const) for (const k of ["/", "j", "n", "o", "?"]) expect(press(m, k, { [mod]: true })).toBeNull();
    press(m, "g");
    expect(press(m, "s", { metaKey: true })).toBeNull();
    expect(press(m, "s")).toBeNull();
  });
  it("works with Caps Lock on: a capital letter without Shift is the same key, and Shift+letter is not", () => {
    const m = new KeyMachine();
    expect(press(m, "J", { shiftKey: false })).toBe("next");
    expect(press(m, "K", { shiftKey: false })).toBe("prev");
    expect(press(m, "N", { shiftKey: false })).toBe("add");
    press(m, "G", { shiftKey: false });
    expect(press(m, "S", { shiftKey: false })).toBe("goSettings");
    // a real capital typed with Shift is some other shortcut, so nothing happens
    expect(press(m, "J", { shiftKey: true })).toBeNull();
    expect(press(m, "N", { shiftKey: true })).toBeNull();
    // a key that isn't one letter is left as it is
    expect(press(m, "Escape", { shiftKey: false })).toBe("clear");
    expect(press(m, "ENTER", { shiftKey: false })).toBeNull();
  });
  it("lets Shift through, since ? needs it, and ignores a key typed through an input method", () => {
    const m = new KeyMachine();
    expect(press(m, "?", { shiftKey: true } as Partial<KeyInput>)).toBe("help");
    expect(press(m, "j", { isComposing: true })).toBeNull();
  });
  it("leaves Enter to a focused link or button, but not o", () => {
    const m = new KeyMachine();
    const link = el('<a href="#/">x</a>');
    const button = el("<button>x</button>");
    expect(answersEnter(link)).toBe(true);
    expect(answersEnter(el("<div>x</div>"))).toBe(false);
    expect(press(m, "Enter", { target: link })).toBeNull();
    expect(press(m, "Enter", { target: button })).toBeNull();
    expect(press(m, "o", { target: link })).toBe("toggleOpen");
    expect(press(m, "Enter")).toBe("toggleOpen");
  });
});

describe("two-key sequences", () => {
  it("g then s within a second goes to Settings", () => {
    vi.useFakeTimers();
    const m = new KeyMachine();
    expect(press(m, "g")).toBeNull();
    vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS - 1);
    expect(press(m, "s")).toBe("goSettings");
  });
  it("times out after a second: s alone does nothing", () => {
    vi.useFakeTimers();
    const m = new KeyMachine();
    press(m, "g");
    vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS);
    expect(press(m, "s")).toBeNull();
    expect(SEQUENCE_TIMEOUT_MS).toBe(1000);
  });
  it("is cancelled by another key, which does nothing itself", () => {
    const m = new KeyMachine();
    press(m, "g");
    expect(press(m, "j")).toBeNull();
    expect(press(m, "s")).toBeNull();
    expect(press(m, "j")).toBe("next");
  });
  it("a modifier pressed on its own neither counts nor cancels", () => {
    const m = new KeyMachine();
    press(m, "g");
    expect(press(m, "Shift")).toBeNull();
    expect(press(m, "s")).toBe("goSettings");
  });
  it("reset forgets a pending g", () => {
    const m = new KeyMachine();
    press(m, "g");
    m.reset();
    expect(press(m, "s")).toBeNull();
  });
  it("leaves no timer running after a sequence ends", () => {
    vi.useFakeTimers();
    const m = new KeyMachine();
    press(m, "g");
    press(m, "s");
    expect(vi.getTimerCount()).toBe(0);
  });
});

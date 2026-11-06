import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { SHORTCUTS, keyName } from "./keys";
import "./shortcuts.css";

/** What can be focused inside the dialog, for the Tab trap. */
const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * The shortcut list in a small dialog. Focus moves into it when it opens and can't leave it (Tab and Shift+Tab wrap, and focus that
 * lands anywhere outside, such as after a click on its text, is brought back), Escape or Close shuts it, and focus goes back to where it
 * was: the button or row that had it when `?` was pressed (`returnTo`), else the `fallback`, the footer button that opens it.
 */
export function ShortcutHelp({ onClose, returnTo, fallback }: { onClose(): void; returnTo?: HTMLElement | null; fallback?: HTMLElement | null }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const was = returnTo ?? document.activeElement;   // a click doesn't focus a button in every browser, so the opener is told to us
    close.current?.focus();
    // Focus that reaches the page behind (a Tab from the body after a click on the dialog's text) is pulled back in.
    const keepIn = (e: FocusEvent) => {
      if (box.current && e.target instanceof Node && !box.current.contains(e.target)) close.current?.focus();
    };
    document.addEventListener("focusin", keepIn);
    return () => {
      document.removeEventListener("focusin", keepIn);
      const back = [was, fallback].find((el): el is HTMLElement => el instanceof HTMLElement && el.isConnected && el !== document.body);
      back?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !box.current?.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !box.current?.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="shortcut-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="shortcut-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={box} onKeyDown={onKey}>
        <h2 className="section" id={titleId}>Keyboard shortcuts</h2>
        <dl className="shortcut-list">
          {SHORTCUTS.map((s) => (
            <div className="shortcut-item" key={s.action}>
              <dt>
                {s.sequences.map((seq, i) => (
                  <span key={seq.join(" ")}>
                    {i > 0 ? <span className="muted"> or </span> : null}
                    {seq.map((k, j) => (
                      <span key={k}>{j > 0 ? <span className="muted"> then </span> : null}<kbd>{keyName(k)}</kbd></span>
                    ))}
                  </span>
                ))}
              </dt>
              <dd>{s.label}</dd>
            </div>
          ))}
        </dl>
        <p className="help">Shortcuts don't work while you're typing in a field.</p>
        <div className="row">
          <button type="button" className="primary" ref={close} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

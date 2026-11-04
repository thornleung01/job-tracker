import { Ellipsis } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import "./moremenu.css";

export interface MoreMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
}

/**
 * A button that opens a small menu of actions. Enter, Space or the arrow keys open it with the first item focused; Up and
 * Down (and Home and End) move between items, Escape closes it and returns focus to the button, Tab and a click outside close it.
 * Choosing an item closes the menu and calls its `onSelect`.
 */
export function MoreMenu({ items, label = "More actions", disabled = false }: { items: MoreMenuItem[]; label?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const entries = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];

  useEffect(() => {
    if (open) entries()[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("mousedown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("mousedown", outside);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  // Enter and Space reach the button as a click, so only the arrow keys need handling here.
  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const all = entries();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => {
      e.preventDefault();
      all[(i + all.length) % all.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at < 0 ? all.length - 1 : at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div className="more-menu" ref={wrap}>
      <button
        type="button"
        ref={trigger}
        className="more-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
      >
        <Ellipsis size={24} strokeWidth={2} aria-hidden="true" />
      </button>
      {open ? (
        <div id={menuId} className="more-popup" role="menu" aria-label={label} ref={menu} onKeyDown={onMenuKey}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

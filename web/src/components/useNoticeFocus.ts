import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * For a page whose result notice should take focus after an action that removed the control that had it (a settled
 * review email, a removed person). Put `box` on a wrapper around the notice and call `focus()` when you set it.
 */
export function useNoticeFocus(): { box: RefObject<HTMLDivElement | null>; focus(): void } {
  const box = useRef<HTMLDivElement>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (asked) box.current?.querySelector<HTMLElement>(".notice")?.focus();
  }, [asked]);
  return { box, focus: () => setAsked((n) => n + 1) };
}

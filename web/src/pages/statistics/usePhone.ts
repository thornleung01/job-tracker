import { useEffect, useState } from "react";

const PHONE = "(max-width: 720px)";

/** Re-renders when the screen crosses the phone breakpoint. Absent matchMedia (tests) counts as a desktop. */
export function usePhone(): boolean {
  const query = typeof matchMedia === "function" ? matchMedia(PHONE) : null;
  const [phone, setPhone] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = () => setPhone(query.matches);
    query.addEventListener?.("change", on);
    return () => query.removeEventListener?.("change", on);
  }, [query]);
  return phone;
}

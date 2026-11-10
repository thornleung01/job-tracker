// The row of links at the top of Settings: one per section, the open one marked with aria-current. They are real links
// (hash routes), so middle-click, copy-link and the keyboard all work; a plain click goes through navigate() and asks the
// page to move focus to the new section's heading once it is shown (see SettingsPage).
import type { MouseEvent } from "react";
import { SECTIONS, sectionPath, type SectionId } from "./sections";

/** Set by a click on a link, read (and cleared) by the page when the section it shows changes. */
export const focusRequest = { pending: false };

export function SectionSwitcher({ current, navigate }: { current: SectionId; navigate(to: string): void }) {
  const go = (id: SectionId) => (e: MouseEvent) => {
    // Let the browser handle modified clicks (new tab, copy link).
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    // Choosing the section that is already open changes nothing, so no focus move is waiting for it.
    focusRequest.pending = id !== current;
    navigate(sectionPath(id));
  };
  return (
    <nav className="section-switcher" aria-label="Settings sections">
      {SECTIONS.map((s) => (
        <a key={s.id} href={`#${sectionPath(s.id)}`} aria-current={s.id === current ? "page" : undefined} onClick={go(s.id)}>{s.label}</a>
      ))}
    </nav>
  );
}

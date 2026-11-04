// Moves focus to the page heading after navigation, so keyboard and screen reader users land on the new page.

function focusEl(el: HTMLElement): void {
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus();
}

/**
 * Focuses the first h1 inside `main`. Pages load their data after they mount, so when the heading is not there yet
 * the main area takes focus and the heading takes over as soon as it appears (unless the person has moved on).
 * Returns a function that stops waiting.
 */
export function focusHeading(main: HTMLElement, waitMs = 3000): () => void {
  const heading = main.querySelector<HTMLElement>("h1");
  if (heading) {
    focusEl(heading);
    return () => undefined;
  }
  focusEl(main);
  const watch = new MutationObserver(() => {
    const h = main.querySelector<HTMLElement>("h1");
    if (!h) return;
    watch.disconnect();
    clearTimeout(timer);
    const active = document.activeElement;
    if (active === main || active === document.body || active === null) focusEl(h);
  });
  const timer = setTimeout(() => watch.disconnect(), waitMs);
  watch.observe(main, { childList: true, subtree: true });
  return () => {
    watch.disconnect();
    clearTimeout(timer);
  };
}

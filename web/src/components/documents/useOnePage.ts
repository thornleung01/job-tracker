import { useLayoutEffect, useState, type DependencyList, type RefObject } from "react";
import { CLASSIC_LINE_PX, PRINTABLE_HEIGHT_PX, measureSheetHeight, pageVerdict, type PageVerdict } from "./onepage";

/**
 * The advisory one-page verdict for the classic sheet in `sheetRef`, measured again whenever `deps` change and when fonts arrive.
 * It is null until a sheet is mounted (no ref, or nothing measured yet). The screen render approximates print, so the browser's own
 * print preview has the last word. `measure` is the page-height probe, a seam for tests (jsdom has no layout).
 */
export function useOnePage(
  sheetRef: RefObject<HTMLElement | null>,
  deps: DependencyList,
  measure: (sheet: HTMLElement) => number = measureSheetHeight,
): PageVerdict | null {
  const [verdict, setVerdict] = useState<PageVerdict | null>(null);
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const check = () => {
      const next = pageVerdict(measure(el), PRINTABLE_HEIGHT_PX, CLASSIC_LINE_PX);
      // the second measurement usually agrees with the first: keep the same state so nothing re-renders
      setVerdict((prev) => (prev && prev.fits === next.fits && prev.overByLines === next.overByLines ? prev : next));
    };
    check();
    let live = true;
    // fonts arriving late change the line breaks
    // (document.fonts is optional because jsdom has none)
    void document.fonts?.ready.then(() => live && check());
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller names what changes the sheet
  }, [sheetRef, measure, ...deps]);
  return verdict;
}

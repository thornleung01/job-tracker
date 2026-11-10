// The advisory one-page fit check for the classic resume template: it measures the sheet as it would print and says whether it fits.
import { plural } from "../../sync/text";

const PX_PER_INCH = 96;
/** US letter is 11in tall; the classic template's page margin is 0.5in on each side. At 96 px per inch that leaves 960px of page. Keep in sync with the `@page classic` margin in pages/resume/print.css. */
export const PRINTABLE_HEIGHT_PX = (11 - 2 * 0.5) * PX_PER_INCH;
/** The printed text column: 8.5in wide minus the same margins. Keep in sync with the `@page classic` margin in pages/resume/print.css (the classic sheet rules themselves are in resumesheet.css). */
export const PRINT_WIDTH_PX = (8.5 - 2 * 0.5) * PX_PER_INCH;
/** The classic template's body text: 10.5pt (14px) on a 1.25 line height. */
const CLASSIC_FONT_PX = 14;
/* The sheet height is measured from the DOM, so section spacing and bullet size need no constant here: CLASSIC_LINE_PX only turns the overflow into a number of lines. */
/** One body line. Keep in sync with resumesheet.css (.doc-sheet.classic: 10.5pt on a 1.25 line height). */
export const CLASSIC_LINE_PX = CLASSIC_FONT_PX * 1.25;

export interface PageVerdict {
  fits: boolean;
  /** how many body lines the content runs past the page, rounded up; 0 when it fits */
  overByLines: number;
}

/** Does content of this height fit the printable height? If not, by about how many lines does it overflow. */
export function pageVerdict(contentHeightPx: number, printableHeightPx: number, lineHeightPx: number): PageVerdict {
  const over = contentHeightPx - printableHeightPx;
  if (Number.isNaN(over) || over <= 0) return { fits: true, overByLines: 0 };
  return { fits: false, overByLines: Math.max(1, Math.ceil(over / lineHeightPx)) };
}

/** The quiet status line next to the print buttons. */
export function pageVerdictText(v: PageVerdict): string {
  return v.fits ? "Fits one page" : `About ${plural(v.overByLines, "line")} over one page`;
}

/**
 * The height the sheet would be when printed: a detached, invisible copy laid out at the print column width and font size. This is advisory,
 * because the screen render only approximates the browser's print layout (its fonts and line breaking can differ a little).
 */
export function measureSheetHeight(sheet: HTMLElement): number {
  const copy = sheet.cloneNode(true) as HTMLElement;
  Object.assign(copy.style, {
    position: "absolute", left: "-10000px", top: "0", visibility: "hidden", pointerEvents: "none",
    width: `${PRINT_WIDTH_PX}px`, maxWidth: "none", margin: "0", padding: "0", boxSizing: "content-box", fontSize: `${CLASSIC_FONT_PX}px`,
  });
  // On a narrow screen resumesheet.css shrinks the type with the viewport (--classic-fs), but the page prints at 10.5pt. A custom property
  // can't go through Object.assign.
  copy.style.setProperty("--classic-fs", "10.5pt");
  document.body.append(copy);
  try {
    return copy.offsetHeight;
  } finally {
    copy.remove();
  }
}

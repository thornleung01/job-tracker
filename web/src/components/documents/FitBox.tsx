import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { SHEET_WIDTH_PX } from "./onepage";
import "./fitbox.css";

const PHONE = "(max-width: 720px)";

interface Fit {
  scale: number;
  /** the scaled sheet's height: a transform leaves the layout box at full size, so the box is cut to what is seen */
  height: number | null;
}

/**
 * Keeps the classic sheet at its real 816px width and scales it down (CSS transform) to a column that is narrower, never up. Text wraps exactly
 * as it prints, so the one-page check agrees with print. On a phone the sheet is not scaled: it uses its own 16px editing type instead.
 * With `on` false it renders its children as they are.
 */
export function FitBox({ on, children }: { on: boolean; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>({ scale: 1, height: null });

  useLayoutEffect(() => {
    const box = outer.current;
    const sheet = inner.current;
    if (!on || !box || !sheet) return;
    const measure = () => {
      const phone = typeof matchMedia === "function" && matchMedia(PHONE).matches;
      const width = box.clientWidth;
      // no layout (a test) or a phone: leave the sheet alone
      const scale = phone || width <= 0 ? 1 : Math.min(1, width / SHEET_WIDTH_PX);
      const next: Fit = scale === 1 ? { scale: 1, height: null } : { scale, height: Math.ceil(sheet.offsetHeight * scale) };
      setFit((prev) => (prev.scale === next.scale && prev.height === next.height ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [on]);

  if (!on) return <>{children}</>;
  const scaled = fit.scale < 1;
  return (
    <div ref={outer} className="fit-box" style={scaled ? { height: fit.height ?? undefined } : undefined}>
      <div ref={inner} className={scaled ? "fit-inner is-scaled" : "fit-inner"} style={scaled ? { transform: `scale(${fit.scale})` } : undefined}>
        {children}
      </div>
    </div>
  );
}

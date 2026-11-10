// The Resume page's unsaved work: the master and version cards, the review of a new master, the template and the job in progress (the flow) each report
// whether they hold something typed and not saved. Leaving the page with any of it asks first, like the Tailor workspace does: closing or
// reloading the tab (not for the flow, which a reload keeps), and a move to another page in the app (app/leaveGuard.ts, one guard for the whole page).
import { useCallback, useEffect, useRef, useState } from "react";
import { registerLeaveGuard } from "../../app/leaveGuard";

/** The key the flow (the job in progress) reports under. */
export const FLOW_KEY = "flow";

/** Tells the page whether the part `key` has unsaved text. */
export type ReportUnsaved = (key: string, unsaved: boolean) => void;

/** Keeps the page told whether this part has unsaved text, and takes the report back when the part goes. */
export function useReportUnsaved(report: ReportUnsaved, key: string, unsaved: boolean) {
  useEffect(() => {
    report(key, unsaved);
    return () => report(key, false);
  }, [report, key, unsaved]);
}

/** `leaving` is where the person was headed, null when not asking. `onDiscard` runs before the move, to drop what isn't kept in memory alone. */
export function useLeaveWhenUnsaved(navigate: (to: string) => void, onDiscard?: () => void) {
  const unsaved = useRef(new Set<string>());
  const discarding = useRef(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [any, setAny] = useState(false);
  const report = useCallback<ReportUnsaved>((key, on) => {
    if (on) unsaved.current.add(key);
    else unsaved.current.delete(key);
    // The flow is kept in session storage, so closing or reloading the tab loses nothing and the browser needn't ask. Leaving the
    // page inside the app still asks (the leave guard below counts it).
    setAny([...unsaved.current].some((k) => k !== FLOW_KEY));
  }, []);
  useEffect(() => {
    if (!any) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [any]);
  useEffect(
    () => registerLeaveGuard({ isDirty: () => unsaved.current.size > 0 && !discarding.current, onBlocked: (to) => setLeaving(to.replace(/^#/, "")) }),
    [],
  );
  const discard = () => {
    discarding.current = true;
    onDiscard?.();
    if (leaving) navigate(leaving);
  };
  return { report, leaving, discard, stay: () => setLeaving(null) };
}

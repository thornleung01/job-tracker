import { useEffect, useId, useRef, useState } from "react";
import { BULK_ADD_MAX } from "../../db/limits";
import type { JobTrackerDB } from "../../db/schema";
import { bulkAdd, parseLinkLines, summarize, type BulkAddDeps, type LinkResult } from "../../sync/bulkAdd";
import { messageFor } from "../useAction";
import { Notice } from "../Notice";
import "./bulkadd.css";

/** The words after each link in the result list. Everything the job board sent is shown as text, never as markup. */
function lineStatus(r: LinkResult): string {
  const o = r.outcome;
  switch (o.status) {
    case "added": {
      const guess = [o.guessed.company ? "company" : "", o.guessed.role ? "role" : ""].filter(Boolean).join(" and ");
      return `Added ${o.company}${o.role ? `, ${o.role}` : ""}.${guess ? ` The ${guess} ${guess.includes(" and ") ? "are" : "is"} a guess from the link. Check ${guess.includes(" and ") ? "them" : "it"}.` : ""}`;
    }
    case "skipped": return `Skipped. Already saved as ${o.existing.company}${o.existing.role ? `, ${o.existing.role}` : ""}.`;
    case "unreadable": return `Couldn't be read. ${o.reason}`;
    case "failed": return `Couldn't be saved. ${o.reason}`;
    case "stopped": return "Not added. You stopped before this one.";
  }
}

/**
 * "Add several links" in the Add application form: a box for up to 10 job links, one per line, and a result for each. The page stays
 * usable while it works, and Stop ends it after the links already being read.
 */
export function BulkAdd({ db, deps }: { db: JobTrackerDB; deps: BulkAddDeps }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<LinkResult[]>([]);
  const [summary, setSummary] = useState("");
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const addButton = useRef<HTMLButtonElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const areaId = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  // The Add these button is disabled while it works, which drops focus to the page: Stop takes it, and when the run is over it goes
  // back to Add these. Only when nothing else has focus, so someone who moved on to another part of the page isn't pulled back.
  const working = running !== null;
  const wasWorking = useRef(false);
  useEffect(() => {
    const idle = document.activeElement === null || document.activeElement === document.body;
    if (working && !wasWorking.current && (idle || document.activeElement === addButton.current)) stopButton.current?.focus();
    else if (!working && wasWorking.current && idle) addButton.current?.focus();
    wasWorking.current = working;
  }, [working]);

  const start = () => {
    let links: string[];
    try {
      links = parseLinkLines(text);
    } catch (e) {
      setError(messageFor(e));
      return;
    }
    setError("");
    setSummary("");
    setResults([]);
    setRunning({ done: 0, total: links.length });
    const ask = new AbortController();
    controller.current = ask;
    bulkAdd(db, links, deps, {
      signal: ask.signal,
      onResult: (_r, done, total) => {
        if (mounted.current) setRunning({ done, total });
      },
    }).then(
      (all) => {
        if (!mounted.current) return;
        controller.current = null;
        setRunning(null);
        setResults(all);
        setSummary(summarize(all));
        // What was added is gone from the box: only the links that weren't added stay, to fix or try again.
        setText(all.filter((r) => r.outcome.status !== "added" && r.outcome.status !== "skipped").map((r) => r.link).join("\n"));
      },
      (e) => {
        if (!mounted.current) return;
        controller.current = null;
        setRunning(null);
        setError(messageFor(e));
      },
    );
  };
  const stop = () => controller.current?.abort();
  // While it works the box stays open, so Stop and the progress are always in reach.
  const shown = open || working;

  return (
    <div className="bulk-add">
      <button type="button" className="bulk-add-toggle" aria-expanded={shown} aria-controls={`${areaId}-box`} onClick={() => { if (!working) setOpen(!open); }}>
        <span className="chev" aria-hidden="true"></span>
        Add several links
      </button>
      <div id={`${areaId}-box`} className="bulk-add-box" hidden={!shown}>
        {shown ? (
          <>
            <div className="fgroup">
              <label htmlFor={areaId}>Job links, one on each line (up to {BULK_ADD_MAX})</label>
              <textarea id={areaId} name="job_links" rows={5} spellCheck={false} autoCapitalize="off" autoComplete="off" value={text}
                        disabled={working} aria-describedby={`${areaId}-status`} onChange={(e) => setText(e.target.value)} />
            </div>
            {error ? <Notice tone="err">{error}</Notice> : null}
            <div className="row">
              <button type="button" className="quiet" ref={addButton} onClick={start} disabled={working}>Add these</button>
              {running ? <button type="button" ref={stopButton} onClick={stop}>Stop</button> : null}
            </div>
            <p className="small muted bulk-add-progress" id={`${areaId}-status`} role="status">
              {running ? `Adding ${running.done} of ${running.total}` : summary}
            </p>
            {results.length ? (
              <ul className="bulk-add-results">
                {results.map((r, i) => (
                  <li key={i} className={`bulk-add-${r.outcome.status}`}>
                    <span className="bulk-add-link small" title={r.link}>{r.link}</span>
                    <span className="small">{lineStatus(r)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

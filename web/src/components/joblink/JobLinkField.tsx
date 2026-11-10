import type { KeyboardEvent } from "react";
import { MAX_PASTE_CHARS } from "../../db/limits";
import type { JobLinkFill } from "./useJobLink";
import "./joblink.css";

/**
 * "Paste a job link" for the add form: a link field with a quiet Fill in button, a collapsed "paste the text instead",
 * and one plain line saying what happened. It owns no form state: `link` comes from useJobLink. Everything the library
 * returns reaches the page as React text, never HTML.
 */
export function JobLinkField({ link }: { link: JobLinkFill }) {
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    // Enter here reads the link. It must not submit the form: the person has not finished.
    e.preventDefault();
    link.fillFromLink();
  };
  return (
    <div className="joblink">
      <div className="fgroup">
        <label htmlFor="add-link">Paste a job link</label>
        <div className="joblink-row">
          <input id="add-link" name="job_link" type="text" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false}
                 value={link.linkText} aria-describedby="add-link-result add-link-checking"
                 onChange={(e) => link.onLinkChange(e.target.value)} onPaste={link.onLinkPaste} onKeyDown={onKey} />
          <button type="button" className="quiet" onClick={link.fillFromLink}>Fill in details</button>
        </div>
      </div>
      {/* Both lines are live regions that exist before they have words, so a screen reader announces them when they fill. */}
      <p className="joblink-line small" id="add-link-result" role="status">{link.result}</p>
      <p className="joblink-line small muted" id="add-link-checking" role="status">{link.checking ? "Checking the job board" : ""}</p>
      {link.unreadable ? (
        <p className="joblink-line small muted">
          LinkedIn, Indeed or a company site? Use the Save to Job Tracker bookmarklet under Save jobs from any site, below.
        </p>
      ) : null}
      <button type="button" className="joblink-toggle" aria-expanded={link.pasteOpen} aria-controls="add-paste-box" onClick={() => link.setPasteOpen(!link.pasteOpen)}>
        <span className="chev" aria-hidden="true"></span>
        Or paste the job text instead
      </button>
      <div id="add-paste-box" className="paste-box" hidden={!link.pasteOpen}>
        {link.pasteOpen ? (
          <div className="fgroup">
            <label htmlFor="add-paste">Paste the job posting text</label>
            <textarea id="add-paste" name="job_text" rows={6} maxLength={MAX_PASTE_CHARS} value={link.pasteText} onChange={(e) => link.setPasteText(e.target.value)} />
            <div className="row">
              <button type="button" className="quiet" onClick={link.readPastedText}>Read the text</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

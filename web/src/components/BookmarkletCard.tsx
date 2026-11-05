import { useEffect, useMemo, useRef, useState } from "react";
import { buildBookmarkletSource } from "../jobs/bookmarklet";
import "./bookmarkletcard.css";

/**
 * Settings section for the "Save to Job Tracker" bookmarklet. The link is for dragging to the bookmarks bar; the Copy
 * button is the keyboard path. React refuses javascript: URLs in href, so the attribute is set on the element directly.
 * Clicking the link inside this page does nothing (the page's own CSP blocks it), so click is cancelled.
 */
export function BookmarkletCard() {
  const source = useMemo(() => buildBookmarkletSource(window.location.origin + import.meta.env.BASE_URL), []);
  const link = useRef<HTMLAnchorElement>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    link.current?.setAttribute("href", source);
  }, [source]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(source);
      setStatus("Copied. Paste it as the address of a new bookmark.");
    } catch {
      setStatus("Couldn't copy. Drag the link to your bookmarks bar instead.");
    }
  }

  return (
    <section className="card" id="bookmarklet" aria-labelledby="h-bookmarklet">
      <h2 className="sec" id="h-bookmarklet">Save jobs from any site</h2>
      <p>Add a bookmark to your browser. Choose it on any job posting to open Job Tracker with the details filled in.</p>
      <div className="row field-block">
        <a ref={link} className="btn bookmarklet-link" draggable="true" aria-describedby="bookmarklet-drag" onClick={(e) => e.preventDefault()}>
          Save to Job Tracker
        </a>
        <button type="button" onClick={() => void copy()}>Copy bookmarklet</button>
      </div>
      <p className="help" id="bookmarklet-drag">Drag this to your bookmarks bar. Choosing it here does nothing.</p>
      <p className="help" role="status">{status}</p>
      <h3 className="bookmarklet-sub">Or make the bookmark by hand</h3>
      <p className="help">You need this on Safari and on a phone.</p>
      <ol className="bookmarklet-steps">
        <li>Create a new bookmark named Save to Job Tracker.</li>
        <li>Choose Copy bookmarklet, then paste it as the bookmark's address.</li>
        <li>Open a job posting and choose the bookmark.</li>
      </ol>
      <p className="help">Your browser may ask to allow pop-ups the first time.</p>
    </section>
  );
}

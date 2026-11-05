import { extract, launch } from "./extract";

export { draftFromHash } from "./draft";
export { extract, launch } from "./extract";
export type { Extracted } from "./extract";

/** esbuild emits one statement per line with semicolons and no comments, so trimming each line and joining them is safe. */
const squeeze = (fn: Function): string => fn.toString().split("\n").map((x) => x.trim()).join("");

/**
 * Makes source text safe to live in a javascript: URL. "%" is decoded by the browser (so write %25), "#" would start a
 * fragment (so write \x23, valid inside the string and regex literals it can only appear in), and non-ASCII is escaped
 * so the URL survives copy and paste. A minifier may fold String.fromCharCode(35) back into a literal "#", so the
 * escaping happens here, on the finished text, rather than in the extractor.
 */
const safe = (code: string): string =>
  code.replace(/%/g, "%25").replace(/#/g, "\\x23").replace(/[^\u0000-\u007f]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));

/**
 * The `javascript:` source to drag to the bookmarks bar. Runs on the job page, reads it there and opens
 * `appUrl#/?add=1&c=..&r=..&l=..&u=..&s=bm` in a new tab. `appUrl` is the app's own address, e.g. https://x.github.io/job-tracker/.
 */
export function buildBookmarkletSource(appUrl: string): string {
  return composeBookmarklet(launch, extract, appUrl);
}

/** Exported for tests, which also build the bookmarklet from the production-minified versions of the two functions. */
export function composeBookmarklet(launchFn: Function, extractFn: Function, appUrl: string): string {
  const base = JSON.stringify(appUrl + "#/?").replace(/</g, "\\u003c");
  return "javascript:" + safe("void(" + squeeze(launchFn) + ")(" + squeeze(extractFn) + ",document,window,location.href," + base + ")");
}

// Reads a schema.org JobPosting out of JSON-LD in a page or in pasted HTML. Parsing is done on a detached document.
import type { JobDraft } from "./types";
import { MAX_COMPANY_CHARS, MAX_LOCATION_CHARS, MAX_ROLE_DISPLAY_CHARS, cleanJobUrl, sanitizeText } from "./url";

const MAX_HTML_CHARS = 2_000_000;
const MAX_NODES = 5000;
const MAX_DEPTH = 10;

type Json = unknown;
type Obj = Record<string, unknown>;

const isObj = (v: Json): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The first complete JSON value in the text, tolerating junk before and after it and raw line breaks inside strings.
 * Returns the parsed value or undefined.
 */
export function parseLenientJson(text: string): Json | undefined {
  try {
    return JSON.parse(text);
  } catch {
    // fall through to the scanner
  }
  const start = text.search(/[{[]/);
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let out = "";
  for (let i = start; i < text.length; i++) {
    let ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      else if (ch < " ") ch = " ";
    } else if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    out += ch;
    if (!inString && depth === 0) break;
  }
  try {
    return JSON.parse(out);
  } catch {
    return undefined;
  }
}

function typeIncludes(node: Obj, name: string): boolean {
  const t = node["@type"];
  const list = Array.isArray(t) ? t : [t];
  return list.some((x) => typeof x === "string" && (x === name || x.endsWith("/" + name) || x.endsWith(":" + name)));
}

/** The first JobPosting in document order, looking through arrays, @graph and nested lists. */
export function findJobPosting(root: Json): Obj | null {
  let seen = 0;
  const walk = (node: Json, depth: number): Obj | null => {
    if (depth > MAX_DEPTH || seen++ > MAX_NODES) return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = walk(item, depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    if (!isObj(node)) return null;
    if (typeIncludes(node, "JobPosting")) return node;
    for (const key of Object.keys(node)) {
      if (key === "@context") continue;
      const hit = walk(node[key], depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root, 0);
}

const asList = (v: Json): Json[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const text = (v: Json, limit: number) => sanitizeText(v, limit);

function nameOf(v: Json, limit: number): string {
  if (typeof v === "string") return text(v, limit);
  return isObj(v) ? text(v.name, limit) : "";
}

function placeText(place: Json): string {
  if (typeof place === "string") return text(place, MAX_LOCATION_CHARS);
  if (!isObj(place)) return "";
  const addr = place.address ?? place;
  if (typeof addr === "string") return text(addr, MAX_LOCATION_CHARS);
  if (!isObj(addr)) return nameOf(place, MAX_LOCATION_CHARS);
  const parts = [addr.addressLocality, addr.addressRegion, isObj(addr.addressCountry) ? addr.addressCountry.name : addr.addressCountry]
    .map((p) => text(p, MAX_LOCATION_CHARS))
    .filter(Boolean);
  return parts.length ? [...new Set(parts)].join(", ") : text(place.name, MAX_LOCATION_CHARS);
}

function locationOf(job: Obj): string {
  const physical = asList(job.jobLocation).map(placeText).filter(Boolean);
  const applicant = asList(job.applicantLocationRequirements).map((p) => nameOf(p, MAX_LOCATION_CHARS)).filter(Boolean);
  const places = [...new Set(physical.length ? physical : applicant)].slice(0, 3);
  const remote = asList(job.jobLocationType).some((t) => typeof t === "string" && t.toUpperCase() === "TELECOMMUTE");
  const joined = places.join("; ");
  if (remote) return text(joined ? `Remote (${joined})` : "Remote", MAX_LOCATION_CHARS);
  return text(joined, MAX_LOCATION_CHARS);
}

/** A draft from a JobPosting object, or null when it names neither a title nor an employer. */
export function draftFromJobPosting(job: Obj, source: JobDraft["source"], fallbackUrl = ""): JobDraft | null {
  const role = text(job.title ?? job.name, MAX_ROLE_DISPLAY_CHARS);
  const company = nameOf(job.hiringOrganization, MAX_COMPANY_CHARS);
  if (!role && !company) return null;
  const url = typeof job.url === "string" ? cleanJobUrl(job.url) : "";
  return {
    company,
    role,
    location: locationOf(job),
    url: url || cleanJobUrl(fallbackUrl),
    source,
    guessed: { company: false, role: false },
  };
}

/** A draft from JSON text (a JSON-LD block, or a raw JobPosting pasted on its own). */
export function draftFromJsonText(raw: string, source: JobDraft["source"], fallbackUrl = ""): JobDraft | null {
  const value = parseLenientJson(raw.trim().replace(/^<!--|-->$/g, "").replace(/^\s*\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>\s*$/g, ""));
  const job = value === undefined ? null : findJobPosting(value);
  return job ? draftFromJobPosting(job, source, fallbackUrl) : null;
}

function isDocument(v: unknown): v is Document {
  return typeof v === "object" && v !== null && typeof (v as Document).querySelectorAll === "function";
}

/**
 * Finds the first JobPosting in the page's JSON-LD. A string is parsed as HTML on a detached document (scripts never run);
 * a Document is read as is. Returns null when there is none.
 */
export function extractJobPostingFromJsonLd(documentOrHtml: Document | string, fallbackUrl = ""): JobDraft | null {
  try {
    let doc: Document;
    let source: JobDraft["source"];
    if (typeof documentOrHtml === "string") {
      if (typeof DOMParser === "undefined") return null;
      doc = new DOMParser().parseFromString(documentOrHtml.slice(0, MAX_HTML_CHARS), "text/html");
      source = "paste";
    } else if (isDocument(documentOrHtml)) {
      doc = documentOrHtml;
      source = "bookmarklet";
    } else {
      return null;
    }
    for (const script of Array.from(doc.querySelectorAll("script"))) {
      if (!/ld\+json/i.test(script.getAttribute("type") ?? "")) continue;
      const draft = draftFromJsonText(script.textContent ?? "", source, fallbackUrl);
      if (draft) return draft;
    }
    return null;
  } catch {
    return null;
  }
}

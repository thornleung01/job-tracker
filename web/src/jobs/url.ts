// Offline reading of a job link: clean the URL, then work out company and role from the host and path.
// Everything derived from a slug or a domain is a guess, so the draft marks it as one.
import { GUESS_COMPANY_CHARS, GUESS_ROLE_CHARS } from "../db/limits";
import { MAX_ROLE_CHARS, MAX_ROLE_WORDS, cleanRole, cleanValue } from "../pipeline/extract";
import type { JobDraft } from "./types";

/** The longest pasted link read at all (a posting link is only saved up to MAX_URL_CHARS in db/limits). */
const MAX_LINK_INPUT_CHARS = 8000;

/** Strips markup and control characters from text that came from outside, then trims and caps it. */
export function sanitizeText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  let t = value.length > limit * 20 ? value.slice(0, limit * 20) : value;
  t = t
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[\u00ad\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "")
    .replace(/<[^>]*>?/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&(?:#39|apos);/gi, "'")
    .replace(/&amp;/gi, "&");
  return cleanValue(t, limit);
}

// ---------------------------------------------------------------- names from slugs

// "an" is left out: in a slug it is as likely to be part of a name ("lgs-an-ibm-company") as a connecting word.
const SMALL_WORDS = new Set(["a", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
const ROLE_ACRONYMS: Record<string, string> = {
  qa: "QA", ui: "UI", ux: "UX", sre: "SRE", sdet: "SDET", aws: "AWS", gcp: "GCP", sql: "SQL", seo: "SEO", hr: "HR",
  cto: "CTO", ceo: "CEO", cfo: "CFO", coo: "COO", cpo: "CPO", vp: "VP", ml: "ML", ai: "AI", api: "API", sap: "SAP",
  crm: "CRM", erp: "ERP", etl: "ETL", sdr: "SDR", bdr: "BDR", ii: "II", iii: "III", iv: "IV", ios: "iOS", devops: "DevOps",
};

/** Percent-decodes text from a URL. Never throws; control characters and path separators become spaces and invisible or direction-changing characters are dropped. */
function decodeSegment(s: string): string {
  let out: string;
  try {
    out = decodeURIComponent(s);
  } catch {
    // A malformed sequence somewhere: decode the well-formed runs and leave the rest as typed.
    out = s.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
  }
  return out === s ? s : out.replace(/[\u0000-\u001f\u007f-\u009f/\\]/g, " ").replace(/[\u00ad\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "");
}

function deslug(slug: string): string[] {
  return decodeSegment(slug)
    .replace(/\.(?:html?|php|aspx?|jsp)$/i, "")
    .replace(/\+/g, " ")
    .split(/[-_\s]+/)
    .filter(Boolean);
}

/** "my-company" becomes "My Company". Existing capitals are kept; nothing is expanded or invented. */
export function slugToName(slug: string, kind: "company" | "role" = "company"): string {
  const hasLetters = /[a-z]/i.test(slug);
  const shouting = hasLetters && slug === slug.toUpperCase();
  const words = deslug(slug).map((tok, i) => {
    const t = shouting ? tok.toLowerCase() : tok;
    if (kind === "role") {
      const acronym = ROLE_ACRONYMS[t.toLowerCase()];
      if (acronym) return acronym;
    }
    if (/[A-Z]/.test(t)) return t;
    if (i > 0 && SMALL_WORDS.has(t)) return t;
    return t.charAt(0).toUpperCase() + t.slice(1);
  });
  return cleanValue(words.join(" "), kind === "company" ? GUESS_COMPANY_CHARS : GUESS_ROLE_CHARS);
}

// What an id looks like at the end (or start) of a title slug, so "senior-analyst-4829301" reads as "Senior Analyst":
// a UUID; or a separator then an optional "req"/"jr"/"job" prefix then 3+ digits, or 8+ hex characters that contain a digit
// (the lookahead is what stops a plain word such as "decade" from being taken for an id).
const UUID_TAIL = /[-_]?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_TAIL = /[-_](?:(?:req|jr|r|id|job)[-_]?)?(?:\d{3,}|(?=[a-z]*\d)[0-9a-f]{8,})$/i;
const ID_HEAD = /^(?:\d{3,}|(?=[a-z]*\d)[0-9a-f]{8,})[-_]/i;

const GENERIC_WORDS = new Set([
  "about", "us", "contact", "careers", "career", "jobs", "job", "search", "benefits", "culture", "privacy", "terms",
  "blog", "news", "home", "index", "login", "signin", "sign", "in", "apply", "openings", "open", "positions", "listings",
  "results", "en", "fr", "locations", "all", "view", "details", "posting", "postings", "requisition", "page", "overview",
]);

/** A display title from a path segment, or "" when the segment does not read like a job title. */
export function roleFromSlug(slug: string): string {
  let s = decodeSegment(slug).replace(/\.(?:html?|php|aspx?|jsp)$/i, "");
  for (let i = 0; i < 4; i++) {
    const next = s.replace(UUID_TAIL, "").replace(ID_TAIL, "").replace(ID_HEAD, "");
    if (next === s) break;
    s = next;
  }
  const words = deslug(s);
  const lettered = words.filter((w) => /[a-z]/i.test(w));
  if (lettered.length < 2 || lettered.length < words.length * 0.7) return "";
  if (words.length > MAX_ROLE_WORDS) return "";
  if (lettered.every((w) => GENERIC_WORDS.has(w.toLowerCase()))) return "";
  const title = slugToName(words.join("-"), "role");
  if (title.length > MAX_ROLE_CHARS) return "";
  return cleanRole(title);
}

// ---------------------------------------------------------------- URL normalising and cleaning

const SLUG_RE = /^[A-Za-z0-9._-]{1,80}$/;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/** True for a board slug that is safe to put in an API path: no separators, no dot-only segments. */
export function isSafeSlug(s: string): boolean {
  return SLUG_RE.test(s) && !/^\.+$/.test(s);
}

export function isSafeId(s: string): boolean {
  return ID_RE.test(s);
}

const TRACKING_KEYS = new Set([
  "gclid", "dclid", "gbraid", "wbraid", "fbclid", "msclkid", "yclid", "twclid", "ttclid", "li_fat_id", "mc_cid", "mc_eid",
  "_hsenc", "_hsmi", "hsctatracking", "trk", "trkinfo", "trkemail", "trackingid", "refid", "ref", "referrer", "referral",
  "lipi", "lici", "src", "source", "s_cid", "lever-source", "lever-origin", "lever-via", "gh_src", "jr_src", "_ga", "_gl",
  "ittk", "midtoken", "midsig", "ebp", "otptoken", "recommendedflavor", "originalsubdomain", "alternatechannel", "mkt_tok",
  "vero_id", "igshid", "ck_subscriber_id", "wt.mc_id", "campaign", "adgroup", "keyword", "matchtype", "network", "device",
]);

// Sites whose job id lives in a known parameter, with a lot of tracking beside it: keep only the id.
const KEEP_ONLY: Record<string, ReadonlySet<string>> = {
  linkedin: new Set(["currentjobid"]),
  indeed: new Set(["jk", "vjk"]),
  glassdoor: new Set(["jl", "joblistingid"]),
};

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "or", "ne", "go", "gob", "ltd", "plc", "sch", "mil", "nom"]);

/** The registrable label of a host ("jobs.acme.co.uk" gives "acme") and how many labels the registrable domain spans. */
export function registrable(host: string): { label: string; depth: number } {
  const labels = host.split(".");
  const n = labels.length;
  // a two-letter country code after a generic second level ("co.uk", "com.au") makes the registrable domain three labels long
  if (n >= 3 && labels[n - 1].length === 2 && SECOND_LEVEL.has(labels[n - 2])) return { label: labels[n - 3], depth: 3 };
  if (n >= 2) return { label: labels[n - 2], depth: 2 };
  return { label: labels[0] ?? "", depth: 1 };
}

/** Parses what the user pasted into a URL, or null if it is not a plain http(s) link without credentials. */
export function normalizeUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/^[<"'`]+|[>"'`]+$/g, "");
  if (!s || s.length > MAX_LINK_INPUT_CHARS || /[\s\u0000-\u001f\u007f]/.test(s)) return null;
  if (s.startsWith("//")) s = "https:" + s;
  else if (!/^https?:\/\//i.test(s)) {
    // "acme.com:8080/jobs" has a colon but is a host; "javascript:..." and "file:..." are not. (A scheme, then no host:port, is refused.)
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^/?#:]+:\d+(?:[/?#]|$)/.test(s)) return null;
    s = "https://" + s;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname;
  // a real name: a dot in it, no IPv6 or raw IPv4 address, and a top-level domain of letters (or a punycode one)
  if (!host.includes(".") || host.includes(":") || /^\d+(?:\.\d+){3}$/.test(host)) return null;
  if (!/^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(host.split(".").pop() ?? "")) return null;
  return u;
}

function keepParam(key: string, brand: string): boolean {
  const k = key.toLowerCase().replace(/\[\]$/, "");
  const only = KEEP_ONLY[brand];
  if (only) return only.has(k);
  return !k.startsWith("utm_") && !k.startsWith("rx_") && !TRACKING_KEYS.has(k);
}

function pathOf(u: URL, brand: string): string {
  let p = u.pathname.replace(/\/+$/, "");
  // Apply pages point at the same posting.
  if (brand === "lever") p = p.replace(/\/apply$/, "");
  if (brand === "ashbyhq") p = p.replace(/\/application$/, "");
  return p;
}

function buildUrl(u: URL): string {
  const brand = registrable(u.hostname.toLowerCase()).label;
  const kept = u.search
    .slice(1)
    .split("&")
    .filter((pair) => pair && keepParam(decodeSegment(pair.split("=")[0]), brand));
  return `${u.protocol}//${u.host}${pathOf(u, brand)}${kept.length ? "?" + kept.join("&") : ""}`;
}

/** The link without tracking parameters and fragment, or "" if it is not an http(s) link. */
export function cleanJobUrl(raw: unknown): string {
  const u = normalizeUrl(raw);
  return u ? buildUrl(u) : "";
}

// ---------------------------------------------------------------- boards the enrichment step can ask

export type BoardId = "greenhouse" | "lever" | "ashby" | "smartrecruiters";

export interface BoardRef {
  board: BoardId;
  slug: string;
  id: string;
  /** Lever's EU region has its own API host. */
  eu?: boolean;
}

const GREENHOUSE_HOSTS = new Set(["boards.greenhouse.io", "job-boards.greenhouse.io", "boards.eu.greenhouse.io", "job-boards.eu.greenhouse.io"]);
const NOT_A_BOARD_LABEL = new Set(["linkedin", "indeed", "glassdoor", "google", "greenhouse", "lever", "ashbyhq", "smartrecruiters", "workable", "myworkdayjobs"]);

function rawSegments(u: URL): string[] {
  return u.pathname.split("/").filter(Boolean);
}

/** Recognises the four boards with a public API. Slugs and ids must be safe to interpolate or nothing is returned. */
export function detectBoard(rawUrl: string): BoardRef | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const segs = rawSegments(u);
  const ok = (board: BoardId, slug: string | undefined, id: string | undefined, eu?: boolean): BoardRef | null =>
    slug && id && isSafeSlug(slug) && isSafeId(id) ? { board, slug, id, ...(eu ? { eu } : {}) } : null;

  if (GREENHOUSE_HOSTS.has(host)) {
    if (segs[0] === "embed" && segs[1] === "job_app") return ok("greenhouse", u.searchParams.get("for") ?? undefined, u.searchParams.get("token") ?? undefined);
    return segs[1] === "jobs" ? ok("greenhouse", segs[0], segs[2]) : null;
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") return ok("lever", segs[0], segs[1], host === "jobs.eu.lever.co");
  if (host === "jobs.ashbyhq.com") return ok("ashby", segs[0], segs[1]);
  if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") {
    if (segs[0] === "oneclick-ui" && segs[1] === "company" && segs[3] === "publication") return ok("smartrecruiters", segs[2], segs[4]);
    const m = /^(\d{6,})(?:-.*)?$/.exec(segs[1] ?? "");
    return ok("smartrecruiters", segs[0], m ? m[1] : segs[1]);
  }
  // A company career page that embeds Greenhouse: the board slug is usually the company's own name.
  const jid = u.searchParams.get("gh_jid");
  if (jid && /^\d{1,20}$/.test(jid)) {
    const { label } = registrable(host);
    if (!NOT_A_BOARD_LABEL.has(label)) return ok("greenhouse", label, jid);
  }
  return null;
}

// ---------------------------------------------------------------- deriving company and role

interface Derived {
  company?: string;
  role?: string;
}

interface Ctx {
  host: string;
  segs: string[];
  params: URLSearchParams;
  depth: number;
}

const idSlug = (seg: string | undefined, idPattern: RegExp): string => {
  const m = seg ? idPattern.exec(seg) : null;
  return m ? roleFromSlug(m[1]) : "";
};

const name = (slug: string | undefined): string => (slug ? slugToName(slug) : "");

/** The first label of the host when it is a tenant name rather than a service name. */
function tenant(c: Ctx): string {
  const labels = c.host.split(".");
  const first = labels.length > c.depth ? labels[0] : "";
  return first && !["www", "careers", "jobs", "apply", "ats"].includes(first) ? name(first) : "";
}

// -- brand handlers: one per job site whose links carry the title or the employer. Each returns only what the link itself
// says (a path segment or a query value), and nothing at all when the host is not that site's real posting host.

/** LinkedIn: /jobs/view/<title>-at-<company>-<id>, or /company/<company>. */
function linkedin(c: Ctx): Derived {
  const i = c.segs.findIndex((s, k) => s === "view" && /^jobs2?$/.test(c.segs[k - 1] ?? ""));
  if (i < 0) return c.segs[0] === "company" && c.segs[1] ? { company: name(c.segs[1]) } : {};
  const m = /^(.+)-(\d{6,})$/.exec(c.segs[i + 1] ?? "");
  if (!m) return {};
  const base = m[1];
  // the LAST "-at-" splits title from company: a title can say "at" itself ("analyst-at-large-at-acme")
  const at = base.toLowerCase().lastIndexOf("-at-");
  if (at > 0 && at + 4 < base.length) return { role: roleFromSlugLoose(base.slice(0, at)), company: name(base.slice(at + 4)) };
  return { role: roleFromSlugLoose(base) };
}

/** LinkedIn slugs are always a title, so one-word titles are allowed. */
function roleFromSlugLoose(slug: string): string {
  const words = deslug(slug);
  if (words.length === 0 || words.length > MAX_ROLE_WORDS) return "";
  return cleanRole(slugToName(slug, "role"));
}

function indeed(c: Ctx): Derived {
  return c.segs[0] === "cmp" && c.segs[1] ? { company: name(c.segs[1]) } : {};
}

function glassdoor(c: Ctx): Derived {
  const i = c.segs.indexOf("job-listing");
  if (i >= 0 && c.segs[i + 1]) {
    // The file name carries the character ranges of the title (KO) and the employer (KE) in the slug before it.
    const m = /^(.*)-JV_[A-Za-z0-9]+_KO(\d+),(\d+)_KE(\d+),(\d+)\.htm$/i.exec(c.segs[i + 1]);
    if (m) {
      const [, base, a, b, x, y] = m;
      const [ko0, ko1, ke0, ke1] = [a, b, x, y].map(Number);
      if (ko1 <= base.length && ke1 <= base.length && ko0 < ko1 && ke0 < ke1) {
        return { role: roleFromSlugLoose(base.slice(ko0, ko1)), company: name(base.slice(ke0, ke1)) };
      }
    }
    return {};
  }
  const last = c.segs[c.segs.length - 1] ?? "";
  const m = /^Working-at-(.+?)-EI_I[EC]\d+/i.exec(last) ?? /^(.+?)-Reviews-E\d+/i.exec(last);
  return m ? { company: name(m[1]) } : {};
}

function wellfound(c: Ctx): Derived {
  const j = c.segs.indexOf("jobs");
  const role = j >= 0 ? idSlug(c.segs[j + 1], /^\d+-(.+)$/) : "";
  return { company: c.segs[0] === "company" ? name(c.segs[1]) : "", role };
}

function workday(c: Ctx): Derived {
  const company = name(c.host.split(".")[0]);
  const j = c.segs.indexOf("job");
  const after = j >= 0 ? c.segs.slice(j + 1) : [];
  const title = after.find((s) => s.includes("_"));
  if (!title) return { company };
  return { company, role: roleFromSlugLoose(decodeSegment(title).slice(0, decodeSegment(title).lastIndexOf("_"))) };
}

const BRANDS: Record<string, (c: Ctx) => Derived> = {
  linkedin, indeed, glassdoor, wellfound, angel: wellfound,
  greenhouse: (c) => {
    if (!GREENHOUSE_HOSTS.has(c.host)) return {};
    if (c.segs[0] === "embed") return { company: name(c.params.get("for") ?? undefined) };
    return { company: c.segs[0] && isSafeSlug(c.segs[0]) ? name(c.segs[0]) : "" };
  },
  lever: (c) => (c.host.startsWith("jobs.") ? { company: name(c.segs[0]) } : {}),
  ashbyhq: (c) => (c.host === "jobs.ashbyhq.com" ? { company: name(c.segs[0]) } : {}),
  smartrecruiters: (c) => {
    if (c.host !== "jobs.smartrecruiters.com" && c.host !== "careers.smartrecruiters.com") return {};
    if (c.segs[0] === "oneclick-ui" && c.segs[1] === "company") return { company: name(c.segs[2]) };
    return { company: name(c.segs[0]), role: idSlug(c.segs[1], /^\d{6,}-(.+)$/) };
  },
  workable: (c) => (c.host === "apply.workable.com" && c.segs[0] && c.segs[0] !== "j" ? { company: name(c.segs[0]) } : {}),
  myworkdayjobs: workday,
  myworkdaysite: workday,
  bamboohr: (c) => ({ company: tenant(c) }),
  breezy: (c) => ({ company: tenant(c), role: c.segs[0] === "p" ? idSlug(c.segs[1], /^[0-9a-f]{8,}-(.+)$/i) : "" }),
  recruitee: (c) => ({ company: tenant(c), role: c.segs[0] === "o" ? roleFromSlug(c.segs[1] ?? "") : "" }),
  teamtailor: (c) => ({ company: tenant(c), role: c.segs[0] === "jobs" ? idSlug(c.segs[1], /^\d+-(.+)$/) : "" }),
  applytojob: (c) => ({ company: tenant(c), role: c.segs[0] === "apply" ? roleFromSlug(c.segs[2] ?? "") : "" }),
  icims: (c) => {
    const first = c.host.split(".")[0].replace(/^(?:careers?|jobs?)-/, "");
    const role = c.segs[0] === "jobs" && /^\d+$/.test(c.segs[1] ?? "") && c.segs[2] !== "job" ? roleFromSlug(c.segs[2] ?? "") : "";
    return { company: first === "www" ? "" : name(first), role };
  },
  jobvite: (c) => (c.host === "jobs.jobvite.com" ? { company: name(c.segs[0] === "careers" ? c.segs[1] : c.segs[0]) } : {}),
  rippling: (c) => (c.host === "ats.rippling.com" && c.segs[0] ? { company: name(c.segs[0].replace(/-(?:careers?|jobs)$/i, "")) } : {}),
  gem: (c) => (c.host === "jobs.gem.com" ? { company: name(c.segs[0]) } : {}),
  personio: (c) => ({ company: tenant(c) }),
  taleo: (c) => ({ company: tenant(c) }),
};

// Sites that host or aggregate postings: their domain says nothing about the employer.
const GENERIC_LABELS = new Set([
  "google", "ziprecruiter", "monster", "simplyhired", "careerbuilder", "dice", "builtin", "workopolis", "github", "notion",
  "medium", "facebook", "twitter", "x", "youtube", "lnkd", "bit", "tinyurl", "t", "co", "com", "workday", "successfactors",
  "oraclecloud", "ultipro", "paylocity", "paycomonline", "adp", "dayforcehcm", "myworkday", "bing", "duckduckgo", "yahoo",
  "reddit", "instagram", "tiktok", "wordpress", "wixsite", "squarespace", "webflow", "carrd", "linktr", "ee", "jobbank",
  "talent", "usajobs", "remoteok", "weworkremotely", "lever", "workable", "ashby", "indeedassessments", "glassdoor",
]);

function guessCompanyFromHost(host: string): string {
  const { label } = registrable(host);
  if (label.length < 2 || label.startsWith("xn--") || /^\d+$/.test(label) || GENERIC_LABELS.has(label)) return "";
  const trimmed = label.replace(/^(?:careers?|jobs?|join|work)-/, "").replace(/-(?:careers?|jobs?|hiring)$/, "");
  return trimmed ? name(trimmed) : "";
}

function guessRoleFromPath(segs: string[]): string {
  for (const seg of segs.slice(-2).reverse()) {
    const role = roleFromSlug(seg);
    if (role) return role;
  }
  return "";
}

function derive(u: URL): Derived {
  const host = u.hostname.toLowerCase();
  const { label, depth } = registrable(host);
  const ctx: Ctx = { host, segs: rawSegments(u).map(decodeSegment), params: u.searchParams, depth };
  const handler = Object.prototype.hasOwnProperty.call(BRANDS, label) ? BRANDS[label] : undefined;
  if (handler) return handler(ctx);
  return { company: guessCompanyFromHost(host), role: guessRoleFromPath(ctx.segs) };
}

/**
 * Instant, offline reading of a job link. Returns null if the text is not an http(s) link without credentials.
 * Company and role are guesses from the host and path; the cleaned URL is always returned.
 */
export function parseJobUrl(rawUrl: string): JobDraft | null {
  const u = normalizeUrl(rawUrl);
  if (!u) return null;
  const d = derive(u);
  const company = cleanValue(d.company ?? "", GUESS_COMPANY_CHARS);
  const role = d.role ?? "";
  return {
    company,
    role,
    location: "",
    url: buildUrl(u),
    source: "link",
    guessed: { company: company !== "", role: role !== "" },
  };
}

// Confirms a link-derived draft with the job board's public API. Only four boards, only fixed hosts, never throws.
// Ashby is asked through its hosted page's tiny GraphQL endpoint first; the REST listing (large) is the fallback.
import type { EnrichOptions, JobDraft } from "./types";
import { isRecord } from "../db/isRecord";
import { GUESS_COMPANY_CHARS, GUESS_LOCATION_CHARS, GUESS_ROLE_CHARS } from "../db/limits";
import { detectBoard, isSafeId, isSafeSlug, sanitizeText, slugToName } from "./url";
import type { BoardRef } from "./url";

export const DEFAULT_TIMEOUT_MS = 6000;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
/** Ashby's REST board listing carries every job with its description, so big boards are several MB. */
export const MAX_ASHBY_LISTING_BYTES = 4 * 1024 * 1024;

/** The only hosts a request may go to. */
export const API_HOSTS: readonly string[] = [
  "boards-api.greenhouse.io",
  "api.lever.co",
  "api.eu.lever.co",
  "api.ashbyhq.com",
  "jobs.ashbyhq.com",
  "api.smartrecruiters.com",
];

interface Found {
  role: string;
  /** Empty when the API does not name the employer. */
  company: string;
  location: string;
}

type FetchFn = typeof fetch;

const enc = encodeURIComponent;

// Ashby's own hosted pages call this endpoint. URL and query text are constants; the slug and id go in as JSON variables only.
const ASHBY_GRAPHQL = "https://jobs.ashbyhq.com/api/non-user-graphql";
const ASHBY_JOB_OP = "ApiJobPosting";
const ASHBY_JOB_QUERY =
  "query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) { jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) { id title locationName workplaceType employmentType } }";
const ASHBY_ORG_OP = "ApiOrganizationFromHostedJobsPageName";
const ASHBY_ORG_QUERY =
  "query ApiOrganizationFromHostedJobsPageName($organizationHostedJobsPageName: String!, $searchContext: OrganizationSearchContext) { organization: organizationFromHostedJobsPageName(organizationHostedJobsPageName: $organizationHostedJobsPageName, searchContext: $searchContext) { name } }";

// Host and path template are constants; only slug and id (validated again here) are interpolated.
const urls = {
  greenhouseJob: (r: BoardRef) => `https://boards-api.greenhouse.io/v1/boards/${enc(r.slug)}/jobs/${enc(r.id)}`,
  greenhouseBoard: (r: BoardRef) => `https://boards-api.greenhouse.io/v1/boards/${enc(r.slug)}`,
  lever: (r: BoardRef) => `https://${r.eu ? "api.eu.lever.co" : "api.lever.co"}/v0/postings/${enc(r.slug)}/${enc(r.id)}`,
  ashby: (r: BoardRef) => `https://api.ashbyhq.com/posting-api/job-board/${enc(r.slug)}`,
  smartrecruiters: (r: BoardRef) => `https://api.smartrecruiters.com/v1/companies/${enc(r.slug)}/postings/${enc(r.id)}`,
};

async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    return text.length > maxBytes ? null : text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

interface RequestSpec {
  /** A JSON body makes the request a POST. */
  body?: unknown;
  /** The one query string this request may carry (a fixed constant). */
  search?: string;
  maxBytes?: number;
}

/** One request to a fixed API host. Returns parsed JSON, or undefined on any problem. */
async function getJson(fetchFn: FetchFn, url: string, opts: EnrichOptions, spec: RequestSpec = {}): Promise<unknown> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" || !API_HOSTS.includes(parsed.host) || parsed.search !== (spec.search ?? "") || parsed.hash) return undefined;
  if (opts.signal?.aborted) return undefined;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  // A fetch that ignores its signal must not keep us waiting.
  const stopped = new Promise<never>((_, reject) => {
    ctl.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  stopped.catch(() => undefined);
  try {
    const work = (async () => {
      const post = spec.body !== undefined;
      const res = await fetchFn(url, {
        method: post ? "POST" : "GET",
        ...(post ? { headers: { "content-type": "application/json" }, body: JSON.stringify(spec.body) } : {}),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        mode: "cors",
        redirect: "error",
        signal: ctl.signal,
      });
      if (!res || !res.ok) return undefined;
      if (res.url && new URL(res.url).host !== parsed.host) return undefined;
      const text = await readCapped(res, spec.maxBytes ?? MAX_RESPONSE_BYTES);
      return text === null ? undefined : (JSON.parse(text) as unknown);
    })();
    work.catch(() => undefined);
    return await Promise.race([work, stopped]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

const title = (v: unknown) => sanitizeText(v, GUESS_ROLE_CHARS);
const org = (v: unknown) => sanitizeText(v, GUESS_COMPANY_CHARS);
const place = (v: unknown) => sanitizeText(v, GUESS_LOCATION_CHARS);

async function fromGreenhouse(f: FetchFn, ref: BoardRef, opts: EnrichOptions): Promise<Found | null> {
  const job = await getJson(f, urls.greenhouseJob(ref), opts);
  if (!isRecord(job)) return null;
  // An id that does not match means the slug guessed from a company site was the wrong board.
  if (job.id !== undefined && String(job.id) !== ref.id) return null;
  const role = title(job.title);
  if (!role) return null;
  let company = org(job.company_name);
  if (!company) {
    const board = await getJson(f, urls.greenhouseBoard(ref), opts);
    if (isRecord(board)) company = org(board.name);
  }
  const loc = isRecord(job.location) ? place(job.location.name) : "";
  return { role, company, location: loc };
}

/** "Remote" or "Hybrid" from a board's workplace field, only when the location text does not already say so. */
function withWorkplace(location: string, workplace: unknown): string {
  const w = typeof workplace === "string" ? workplace.toLowerCase().replace(/[^a-z]/g, "") : "";
  const label = w === "remote" ? "Remote" : w === "hybrid" ? "Hybrid" : "";
  if (!label || location.toLowerCase().includes(label.toLowerCase())) return location;
  return place(location ? `${location} (${label})` : label);
}

async function fromLever(f: FetchFn, ref: BoardRef, opts: EnrichOptions): Promise<Found | null> {
  const job = await getJson(f, urls.lever(ref), opts);
  if (!isRecord(job)) return null;
  const role = title(job.text);
  if (!role) return null;
  const cats = isRecord(job.categories) ? job.categories : {};
  const extra = Array.isArray(cats.allLocations) ? cats.allLocations : Array.isArray(job.allLocations) ? job.allLocations : [];
  const many = extra.map(place).filter(Boolean).slice(0, 2).join(", ");
  return { role, company: "", location: withWorkplace(place(cats.location) || place(many), job.workplaceType) };
}

async function ashbyGraphql(f: FetchFn, op: string, query: string, variables: Record<string, string>, opts: EnrichOptions): Promise<Record<string, unknown> | null> {
  const res = await getJson(f, `${ASHBY_GRAPHQL}?op=${op}`, opts, { body: { operationName: op, variables, query }, search: `?op=${op}` });
  return isRecord(res) && isRecord(res.data) ? res.data : null;
}

/** Ashby's hosted-page GraphQL: a small job lookup and a company-name lookup, in parallel. */
async function fromAshbyGraphql(f: FetchFn, ref: BoardRef, opts: EnrichOptions): Promise<{ found: Found | null; company: string }> {
  const [jobData, orgData] = await Promise.all([
    ashbyGraphql(f, ASHBY_JOB_OP, ASHBY_JOB_QUERY, { organizationHostedJobsPageName: ref.slug, jobPostingId: ref.id }, opts),
    ashbyGraphql(f, ASHBY_ORG_OP, ASHBY_ORG_QUERY, { organizationHostedJobsPageName: ref.slug, searchContext: "JobBoard" }, opts),
  ]);
  const company = isRecord(orgData?.organization) ? org(orgData.organization.name) : "";
  const job = jobData?.jobPosting;
  if (!isRecord(job) || (typeof job.id === "string" && job.id.toLowerCase() !== ref.id.toLowerCase())) return { found: null, company };
  const role = title(job.title);
  if (!role) return { found: null, company };
  return { found: { role, company, location: withWorkplace(place(job.locationName), job.workplaceType) }, company };
}

/** The REST board listing: every job with its description, so it is large. Used only when the GraphQL answer is missing. */
async function fromAshbyListing(f: FetchFn, ref: BoardRef, opts: EnrichOptions, knownCompany: string): Promise<Found | null> {
  const board = await getJson(f, urls.ashby(ref), opts, { maxBytes: MAX_ASHBY_LISTING_BYTES });
  if (!isRecord(board) || !Array.isArray(board.jobs)) return null;
  const want = ref.id.toLowerCase();
  const job = board.jobs.find((j): j is Record<string, unknown> => isRecord(j) && typeof j.id === "string" && j.id.toLowerCase() === want);
  if (!job) return null;
  const role = title(job.title);
  if (!role) return null;
  const orgName = org(board.organizationName) || (isRecord(board.organization) ? org(board.organization.name) : "") || knownCompany;
  return { role, company: orgName, location: place(job.location) };
}

async function fromAshby(f: FetchFn, ref: BoardRef, opts: EnrichOptions): Promise<Found | null> {
  const { found, company } = await fromAshbyGraphql(f, ref, opts);
  return found ?? (await fromAshbyListing(f, ref, opts, company));
}

/** "Hyderabad, , India" becomes "Hyderabad, India": empty parts dropped, spaces collapsed, a bare country code spelled out. */
function cleanPlaceParts(raw: unknown, isCountry = false): string[] {
  if (typeof raw !== "string") return [];
  // In free text only a lowercase pair is a code ("CA" in "San Francisco, CA" is a state); the country field is always one.
  return raw.split(",").map((p) => countryName(sanitizeText(p, GUESS_LOCATION_CHARS), isCountry)).filter(Boolean);
}

/** A lone two-letter country code ("in") becomes the country's name, or the upper-cased code when the name is unknown. */
function countryName(part: string, anyCase: boolean): string {
  if (!(anyCase ? /^[A-Za-z]{2}$/ : /^[a-z]{2}$/).test(part)) return part;
  const code = part.toUpperCase();
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return name && name !== code && !/^unknown/i.test(name) ? name : code;
  } catch {
    return code;
  }
}

function smartRecruitersLocation(l: Record<string, unknown>): string {
  const city = cleanPlaceParts(l.city).join(" ");
  if (l.remote === true) return place(city ? `Remote (${city})` : "Remote");
  // Never the street address or postal code.
  const full = cleanPlaceParts(l.fullLocation);
  if (full.length > 0) return place(full.join(", "));
  return place([city, ...cleanPlaceParts(l.country, true)].filter(Boolean).join(", "));
}

async function fromSmartRecruiters(f: FetchFn, ref: BoardRef, opts: EnrichOptions): Promise<Found | null> {
  const job = await getJson(f, urls.smartrecruiters(ref), opts);
  if (!isRecord(job)) return null;
  const role = title(job.name);
  if (!role) return null;
  const company = isRecord(job.company) ? org(job.company.name) : "";
  return { role, company, location: isRecord(job.location) ? smartRecruitersLocation(job.location) : "" };
}

const LOOKUPS: Record<BoardRef["board"], (f: FetchFn, ref: BoardRef, opts: EnrichOptions) => Promise<Found | null>> = {
  greenhouse: fromGreenhouse,
  lever: fromLever,
  ashby: fromAshby,
  smartrecruiters: fromSmartRecruiters,
};

function merge(draft: JobDraft, ref: BoardRef, found: Found): JobDraft {
  const fromApi = found.company !== "";
  // Without an employer name from the API, the board slug is still the best (guessed) company.
  const slugName = ref.board === "greenhouse" || fromApi ? "" : slugToName(ref.slug);
  const company = fromApi ? found.company : draft.company || slugName;
  const guessedCompany = fromApi ? false : draft.company ? draft.guessed.company : company !== "";
  return {
    ...draft,
    company,
    role: found.role,
    location: found.location || draft.location,
    source: "api",
    guessed: { company: guessedCompany, role: false },
  };
}

/** Asks the board's public API about a known board link. Any failure returns the draft untouched. */
export async function enrichJobDraft(draft: JobDraft, opts: EnrichOptions = {}): Promise<JobDraft> {
  try {
    const fetchFn = opts.fetch ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined);
    if (!fetchFn || typeof draft?.url !== "string") return draft;
    const ref = detectBoard(draft.url);
    if (!ref || !isSafeSlug(ref.slug) || !isSafeId(ref.id)) return draft;
    const found = await LOOKUPS[ref.board](fetchFn, ref, opts);
    return found ? merge(draft, ref, found) : draft;
  } catch {
    return draft;
  }
}

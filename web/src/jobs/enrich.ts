// Confirms a link-derived draft with the job board's public API. Only four boards, only fixed hosts, never throws.
import type { EnrichOptions, JobDraft } from "./types";
import { MAX_COMPANY_CHARS, MAX_LOCATION_CHARS, MAX_ROLE_DISPLAY_CHARS, detectBoard, isSafeId, isSafeSlug, sanitizeText, slugToName } from "./url";
import type { BoardRef } from "./url";

export const DEFAULT_TIMEOUT_MS = 6000;
export const MAX_RESPONSE_BYTES = 1024 * 1024;

/** The only hosts a request may go to. */
export const API_HOSTS: readonly string[] = [
  "boards-api.greenhouse.io",
  "api.lever.co",
  "api.eu.lever.co",
  "api.ashbyhq.com",
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

// Host and path template are constants; only slug and id (validated again here) are interpolated.
const urls = {
  greenhouseJob: (r: BoardRef) => `https://boards-api.greenhouse.io/v1/boards/${enc(r.slug)}/jobs/${enc(r.id)}`,
  greenhouseBoard: (r: BoardRef) => `https://boards-api.greenhouse.io/v1/boards/${enc(r.slug)}`,
  lever: (r: BoardRef) => `https://${r.eu ? "api.eu.lever.co" : "api.lever.co"}/v0/postings/${enc(r.slug)}/${enc(r.id)}`,
  ashby: (r: BoardRef) => `https://api.ashbyhq.com/posting-api/job-board/${enc(r.slug)}`,
  smartrecruiters: (r: BoardRef) => `https://api.smartrecruiters.com/v1/companies/${enc(r.slug)}/postings/${enc(r.id)}`,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function readCapped(res: Response): Promise<string | null> {
  const declared = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null;
  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    return text.length > MAX_RESPONSE_BYTES ? null : text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
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

/** One GET to a fixed API host. Returns parsed JSON, or undefined on any problem. */
async function getJson(fetchFn: FetchFn, url: string, opts: EnrichOptions): Promise<unknown> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" || !API_HOSTS.includes(parsed.host) || parsed.search || parsed.hash) return undefined;
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
      const res = await fetchFn(url, {
        method: "GET",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        mode: "cors",
        redirect: "error",
        signal: ctl.signal,
      });
      if (!res || !res.ok) return undefined;
      if (res.url && new URL(res.url).host !== parsed.host) return undefined;
      const text = await readCapped(res);
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

const title = (v: unknown) => sanitizeText(v, MAX_ROLE_DISPLAY_CHARS);
const org = (v: unknown) => sanitizeText(v, MAX_COMPANY_CHARS);
const place = (v: unknown) => sanitizeText(v, MAX_LOCATION_CHARS);

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

async function fromLever(f: FetchFn, ref: BoardRef, opts: EnrichOptions): Promise<Found | null> {
  const job = await getJson(f, urls.lever(ref), opts);
  if (!isRecord(job)) return null;
  const role = title(job.text);
  if (!role) return null;
  const cats = isRecord(job.categories) ? job.categories : {};
  const all = Array.isArray(job.allLocations) ? job.allLocations[0] : undefined;
  return { role, company: "", location: place(cats.location) || place(all) };
}

async function fromAshby(f: FetchFn, ref: BoardRef, opts: EnrichOptions): Promise<Found | null> {
  const board = await getJson(f, urls.ashby(ref), opts);
  if (!isRecord(board) || !Array.isArray(board.jobs)) return null;
  const want = ref.id.toLowerCase();
  const job = board.jobs.find((j): j is Record<string, unknown> => isRecord(j) && typeof j.id === "string" && j.id.toLowerCase() === want);
  if (!job) return null;
  const role = title(job.title);
  if (!role) return null;
  const orgName = org(board.organizationName) || (isRecord(board.organization) ? org(board.organization.name) : "");
  return { role, company: orgName, location: place(job.location) };
}

async function fromSmartRecruiters(f: FetchFn, ref: BoardRef, opts: EnrichOptions): Promise<Found | null> {
  const job = await getJson(f, urls.smartrecruiters(ref), opts);
  if (!isRecord(job)) return null;
  const role = title(job.name);
  if (!role) return null;
  const company = isRecord(job.company) ? org(job.company.name) : "";
  let location = "";
  if (isRecord(job.location)) {
    const l = job.location;
    const country = typeof l.country === "string" && l.country.length === 2 ? l.country.toUpperCase() : l.country;
    location = place(l.fullLocation) || [place(l.city), place(country)].filter(Boolean).join(", ");
    if (!location && l.remote === true) location = "Remote";
  }
  return { role, company, location };
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

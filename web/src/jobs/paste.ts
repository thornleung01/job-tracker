// Guesses company, role and location from text copied off a job posting page. Everything here is a guess.
import { draftFromJsonText, extractJobPostingFromJsonLd } from "./jsonld";
import type { JobDraft } from "./types";
import { GUESS_COMPANY_CHARS, GUESS_LOCATION_CHARS, GUESS_ROLE_CHARS, MAX_PASTE_CHARS } from "../db/limits";
import { cleanJobUrl, parseJobUrl, sanitizeText } from "./url";

const HEAD_LINES = 15;
const SCAN_LINES = 40;
/** The most lines read from a paste, how many are searched for a place, and the plausible size of a role, a company and a place. */
const MAX_LINES = 400;
const LOCATION_SCAN_LINES = 25;
const PLAUSIBLE_ROLE_CHARS = 80;
const PLAUSIBLE_ROLE_WORDS = 10;
const PLAUSIBLE_COMPANY_WORDS = 6;
const PLAUSIBLE_LOCATION_CHARS = 60;

const NOISE_LINES = new Set([
  "apply", "apply now", "apply for this job", "apply on company site", "save", "saved", "share", "easy apply", "skip to main content",
  "skip to content", "sign in", "log in", "login", "join now", "sign up", "jobs", "job", "careers", "home", "menu", "back", "back to jobs",
  "report this job", "see more", "show more", "show less", "promoted", "reposted", "actively recruiting", "new", "notify me", "open",
  "full-time", "full time", "part-time", "part time", "contract", "internship", "permanent", "temporary", "description", "overview",
  "job description", "job details", "about the job", "about this job", "more", "close", "search", "search jobs", "view all jobs",
  "about", "about us", "about the company", "about the role", "about the team", "about you", "responsibilities", "requirements",
  "qualifications", "benefits", "what you will do", "what you'll do", "who we are", "who you are", "the role", "the team",
]);

const NOISE_PATTERNS: readonly RegExp[] = [
  /^\d[\d,]*\+?\s+(?:applicants?|applications?|people|views?|clicks?)\b/i,
  /^(?:posted|reposted|updated|closes?|expires?|deadline)\b/i,
  /^\d+\s+(?:minutes?|hours?|days?|weeks?|months?)\s+ago$/i,
  /^over \d+/i,
  /^(?:be an early applicant|promoted by|responses managed|no longer accepting)/i,
  /^(?:sign in|log in|join now|create (?:a )?(?:job )?alert|set (?:a )?(?:job )?alert|skip to)\b/i,
  /^(?:back to|view all|see all|see who)\b/i,
  /^[$\u20ac\u00a3]\s?[\d,.]+/,
  /^[\W_]+$/,
];

const ROLE_WORDS =
  /\b(?:engineer|developer|manager|designer|analyst|scientist|director|lead|specialist|associate|coordinator|architect|consultant|administrator|representative|officer|intern|assistant|executive|recruiter|accountant|technician|producer|strategist|president|marketer|researcher|advisor|owner|head)\b/i;
const VENDOR_PART = /^(?:careers?|jobs?|job openings?|greenhouse|lever|workable|ashby|linkedin|indeed|glassdoor|apply|home|work with us)$/i;
const NOT_A_ROLE_START = /^(?:we|you|our|your|i|join|work|working|life|about|apply|come|welcome|the following)\b/i;
const GENERIC_ROLE_PART = /^(?:careers?|jobs?|life|working|work|join us|join|about us|open roles|openings)$/i;

const REMOTE_RE = /^(?:fully\s+)?(?:remote|hybrid|on-?site|work from home)(?:\b[\s,()/\-\u2013]*[\p{L} ,.'()/-]{0,40})?$/iu;
const CITY_RE =
  /^\p{Lu}[\p{L}.'\u2019 -]{1,30},\s*(?:\p{Lu}{2}|\p{Lu}[\p{L}.'\u2019 -]{2,30})(?:,\s*\p{Lu}[\p{L}.'\u2019 -]{1,30})?(?:\s*\((?:[Rr]emote|[Hh]ybrid|[Oo]n-?[Ss]ite)\))?$/u;

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

function plausibleRole(s: string): boolean {
  if (!s || s.length < 3 || s.length > PLAUSIBLE_ROLE_CHARS || words(s) > PLAUSIBLE_ROLE_WORDS || /[.!?:;,]$/.test(s) || NOT_A_ROLE_START.test(s)) return false;
  return /\p{L}/u.test(s) && !isNoise(s);
}

function plausibleCompany(s: string): boolean {
  if (!s || s.length > GUESS_COMPANY_CHARS || words(s) > PLAUSIBLE_COMPANY_WORDS || /[.!?:;]$/.test(s) || /^\d+$/.test(s)) return false;
  return /\p{L}/u.test(s) && !isNoise(s) && !ROLE_WORDS.test(s) && !isLocation(s);
}

function isNoise(line: string): boolean {
  const l = line.toLowerCase().replace(/[.!:]+$/, "").trim();
  return NOISE_LINES.has(l) || NOISE_PATTERNS.some((re) => re.test(line));
}

function isLocation(line: string): boolean {
  const s = line.trim();
  if (!s || s.length > PLAUSIBLE_LOCATION_CHARS) return false;
  if (REMOTE_RE.test(s)) return true;
  return CITY_RE.test(s) && !ROLE_WORDS.test(s.split(",")[0]);
}

function toLines(input: string): string[] {
  let t = input;
  if (/<\/?(?:p|div|br|li|h\d|span|html|body|ul|a)\b[^>]*>/i.test(t)) {
    t = t.replace(/<\/(?:p|div|li|h\d|ul|tr)>|<br\s*\/?>/gi, "\n").replace(/<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi, " ").replace(/<[^>]*>/g, " ");
  }
  return t
    .split(/\r?\n/)
    .map((l) => l.replace(/[\u0000-\u001f\u007f-\u009f\u00a0]/g, " ").replace(/[\u200b-\u200f\u2060\ufeff]/g, "").replace(/\s+/g, " ").trim())
    .filter((l) => l !== "")
    .slice(0, MAX_LINES);
}

interface PasteFound {
  company: string;
  role: string;
  location: string;
}

function readLines(lines: string[]): PasteFound {
  const out: PasteFound = { company: "", role: "", location: "" };
  const kept = lines.filter((l) => !isNoise(l));
  const head = kept.slice(0, HEAD_LINES);
  let roleIndex = -1;
  const used = new Set<number>();

  // Explicit labels win over everything else.
  for (const line of kept.slice(0, SCAN_LINES)) {
    const m = /^(company|employer|organi[sz]ation|hiring company|job title|title|position|role|location)\s*:\s*(.+)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "location") out.location ||= sanitizeText(m[2], GUESS_LOCATION_CHARS);
    else if (/^(?:job title|title|position|role)$/.test(key)) {
      if (!out.role && plausibleRole(m[2].trim())) out.role = sanitizeText(m[2], GUESS_ROLE_CHARS);
    } else if (!out.company && plausibleCompany(m[2].trim())) out.company = sanitizeText(m[2], GUESS_COMPANY_CHARS);
  }

  head.forEach((line, i) => {
    if (/^(?:company|employer|organi[sz]ation|hiring company|job title|title|position|role|location)\s*:/i.test(line)) return;

    const hiring = /^(.{2,60}?)\s+is\s+(?:now\s+)?hiring(?:\s+(?:an?\s+|for\s+(?:an?\s+)?|our\s+)?(.+))?$/i.exec(line);
    if (hiring) {
      used.add(i);
      if (!out.company && plausibleCompany(hiring[1])) out.company = sanitizeText(hiring[1], GUESS_COMPANY_CHARS);
      const r = hiring[2]?.trim() ?? "";
      if (!out.role && r && plausibleRole(r)) {
        out.role = sanitizeText(r, GUESS_ROLE_CHARS);
        roleIndex = i;
      }
      return;
    }

    if (words(line) <= 14) {
      const at = /^(.{2,90}?)\s+at\s+(.{2,60})$/i.exec(line);
      if (at && (out.role || out.company || i <= 2)) {
        const [, r, c] = at;
        if (GENERIC_ROLE_PART.test(r.trim())) {
          used.add(i);
          if (!out.company && plausibleCompany(c)) out.company = sanitizeText(c, GUESS_COMPANY_CHARS);
          return;
        }
        if (plausibleRole(r) && plausibleCompany(c)) {
          if (!out.role) {
            out.role = sanitizeText(r, GUESS_ROLE_CHARS);
            roleIndex = i;
          }
          out.company ||= sanitizeText(c, GUESS_COMPANY_CHARS);
          return;
        }
      }
    }

    const about = /^about\s+(?!us\b|the\b|this\b|you\b|your\b|our\b|me\b|them\b)(.{2,50})$/i.exec(line);
    if (about) {
      used.add(i);
      if (!out.company && words(about[1]) <= 5 && plausibleCompany(about[1].trim())) out.company = sanitizeText(about[1], GUESS_COMPANY_CHARS);
      return;
    }

    if (i <= 1 && !out.role) {
      const parts = line.split(/\s+[|\-\u2013\u2014\u00b7]\s+/).map((p) => p.trim()).filter((p) => p && !VENDOR_PART.test(p));
      if (parts.length >= 2 && plausibleRole(parts[0]) && plausibleCompany(parts[1])) {
        out.role = sanitizeText(parts[0], GUESS_ROLE_CHARS);
        out.company ||= sanitizeText(parts[1], GUESS_COMPANY_CHARS);
        if (!out.location && parts[2] && isLocation(parts[2])) out.location = sanitizeText(parts[2], GUESS_LOCATION_CHARS);
        roleIndex = i;
        return;
      }
    }
  });

  if (!out.role) {
    const i = head.findIndex((l, k) => !used.has(k) && !isLocation(l) && !/^(?:company|employer|location)\s*:/i.test(l) && plausibleRole(l) && !/\s+is\s+hiring\b/i.test(l));
    if (i >= 0 && i <= 3) {
      out.role = sanitizeText(head[i], GUESS_ROLE_CHARS);
      roleIndex = i;
    }
  }

  // Pages often print the employer on the line under the title ("Acme Corp" then "Toronto, ON").
  if (!out.company && roleIndex >= 0) {
    const next = (head[roleIndex + 1] ?? "").split(/\s+\u00b7\s+/)[0].trim();
    if (next && plausibleCompany(next) && !/^\d/.test(next)) out.company = sanitizeText(next, GUESS_COMPANY_CHARS);
  }

  if (!out.location) {
    for (const [i, line] of kept.slice(0, LOCATION_SCAN_LINES).entries()) {
      if (i === roleIndex) continue;
      const candidate = line.split(/\s+[\u00b7|]\s+/).map((p) => p.trim()).find(isLocation);
      if (candidate) {
        out.location = sanitizeText(candidate, GUESS_LOCATION_CHARS);
        break;
      }
    }
  }
  return out;
}

/**
 * Guesses what the posting is from text the user copied. A JSON-LD JobPosting in the text wins and is trusted; otherwise
 * company, role and location are read from the first lines and flagged as guesses. Null if nothing could be derived.
 */
export function parsePastedText(text: string, url?: string): JobDraft | null {
  const input = typeof text === "string" ? text.slice(0, MAX_PASTE_CHARS) : "";
  const fallbackUrl = typeof url === "string" ? url : "";
  const cleanedUrl = cleanJobUrl(fallbackUrl);
  const link = cleanedUrl ? parseJobUrl(cleanedUrl) : null;

  if (/ld\+json|"@type"\s*:\s*"(?:https?:\/\/schema\.org\/)?JobPosting"/i.test(input)) {
    const structured = /<script/i.test(input) ? extractJobPostingFromJsonLd(input, fallbackUrl) : draftFromJsonText(input, "paste", fallbackUrl);
    if (structured) return { ...structured, source: "paste" };
  }

  const found = readLines(toLines(input));
  const company = found.company || link?.company || "";
  const role = found.role || link?.role || "";
  if (!company && !role && !found.location && !cleanedUrl) return null;
  return {
    company,
    role,
    location: found.location,
    url: cleanedUrl,
    source: "paste",
    guessed: {
      company: company !== "",
      role: role !== "",
    },
  };
}

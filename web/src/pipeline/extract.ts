// Port of jobtracker/extract.py: who the mail is from and which job it is about.
import type { Message } from "../types";
import { isAtsDomain, senderDomain } from "./classify";
import { py, pyFull, match, reEscape, search, sub } from "./pyre";
import { capitalize, casefold, cpHead, cpLen, fold, splitWords, strip } from "./pystr";

export const UNKNOWN_COMPANY = "Unknown company";
export const UNKNOWN_ROLE = "Unknown role";

export const FREE_MAIL: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com",
]);

const R = String.raw;

const NOISE_WORDS_G = py(
  R`\b(?:careers?|recruiting|recruitment|recruiters?|talent|hr|jobs|hiring|team|no-?reply|notifications?|do not reply|applications?|via \w+)\b`,
  "ig",
);
const COMPANY_SUFFIX_SRC = R`\b(?:inc|llc|ltd|limited|corp|corporation|co|company|gmbh|plc)\b\.?`;
const COMPANY_SUFFIX = py(COMPANY_SUFFIX_SRC, "i");
const COMPANY_SUFFIX_G = py(COMPANY_SUFFIX_SRC, "ig");
// Words that make a free-mail display name look like an organization rather than a person.
const ORG_WORDS = py(
  R`\b(?:careers?|recruiting|recruitment|talent|hr|jobs|hiring|team|group|labs?|technologies|solutions|systems|studios?|partners|bank|university|consulting|holdings|software|ventures)\b`,
  "i",
);
// A role is introduced by one of these; it never starts mid-sentence.
const INTRO = R`(?:\bfor (?:the|an?|our)|\bas an?|\bto the|\bof)`;
export const MAX_ROLE_WORDS = 10;
export const MAX_ROLE_CHARS = 80;
// Titles name a team or a place too: "Operations Manager | NAM", "Customer Experience Lead, Business Owner".
const TITLE = R`[^.!\n]+?`;

// Tried in order against the subject, then the body.
const END = R`(?=\s*(?:[!.,:;|\n\u{2014}]|\s-\s|\s\u{2013}\s|\sfor\b|$))`;
const PATTERNS: readonly RegExp[] = [
  R`application (?:to|for) (?:the )?(?P<r>[^|!\n]+?) (?:at|with) (?P<c>[^!.|\n,]+?)${END}`,
  R`(?:applying|applied) (?:for|to) (?:the )?(?P<r>[^.\n,]+?) (?:position|role) (?:at|with) (?P<c>[^.\n,!]+?)${END}`,
  R`(?:position|role) of (?P<r>[^.\n,]+?) (?:at|with) (?P<c>[^.\n,!]+?)${END}`,
  R`${INTRO} (?P<r>${TITLE}) (?:position|role) (?:at|with) (?P<c>[^.\n,!]+?)${END}`,
  R`(?:thank(?:s| you) for applying (?:to|at|with)|application (?:was sent )?to|interest in joining|interest in|applying to) (?P<c>[^!.|\n,]+?)${END}`,
  R`(?:update|status) (?:on|regarding|about) your (?P<c>[^!.|\n]+?) application`,
  R`^(?P<c>[^-|\n]{2,40}?) - (?:thank|thanks|your application|application)`, // "Clio - Thank you for your application"
  R`consider the (?P<r>${TITLE}) (?:position|role) (?:at|with) (?P<c>[^.\n,!]+?)${END}`,
  R`(?:application|candidacy) (?:for|to) (?:the |our )?(?P<r>${TITLE}) (?:position|role)\b`,
  R`for (?:the|our) (?P<r>${TITLE}) (?:position|role)\b`,
  R`(?:position|role) of (?P<r>${TITLE})\s*(?:[.!]|\n|$)`, // "our position of Customer Experience Lead."
  R`next steps for (?:the )?(?P<r>[^|!\n]+?)\s*\|`, // "Next Steps for Senior Associate | Name"
].map((p) => py(p, "i"));

const INVISIBLE = py("[\\u{034f}\\u{200b}-\\u{200f}\\u{2060}\\u{feff}\\u{00ad}]", "g");
const ODD_SPACES = py("[\\u{00a0}\\u{2000}-\\u{200a}\\u{202f}\\u{205f}\\u{3000}]", "g");
const WS_RUN = py(R`\s+`, "g");
const BLANK_RUN = py(R`[ \t]+`, "g");
const ROLE_SUFFIX = py(R`\s+(?:position|role|opening|vacancy|job)$`, "ig");
const ROLE_PUNCT = py(R`[.!?;:]`);
const ROLE_LEAD = py(R`(?:a|an|the|my|your|our)\b`, "iy");
const ROLE_PRONOUN = py(R`\b(?:i|me|my|we|us|our|you|your)\b`, "i");
const NO_REPLY_LOCAL = R`no-?reply|do-?not-?reply|jobs?|careers?|recruiting|notifications?|info|support|hr|talent`;
const NO_REPLY_LOCAL_FULL = pyFull(NO_REPLY_LOCAL, "i");
const CLEAN_CHARS = " \t\"'-\u{2013}:;,.!";

export function cleanValue(value: string | null | undefined, limit: number | null = 60): string {
  if (!value) return "";
  const v = strip(sub(WS_RUN, " ", value), CLEAN_CHARS);
  return limit ? strip(cpHead(v, limit)) : v;
}

export function cleanRole(value: string | null | undefined): string {
  const role = sub(ROLE_SUFFIX, "", cleanValue(value, null));
  // A mangled fragment is worse than no role, so implausible candidates are dropped, not trimmed.
  if (
    cpLen(role) > MAX_ROLE_CHARS ||
    splitWords(role).length > MAX_ROLE_WORDS ||
    search(ROLE_PUNCT, role) ||
    match(ROLE_LEAD, role) || // "the role of a lifetime" is not a job title
    search(ROLE_PRONOUN, role)
  ) {
    return "";
  }
  return role;
}

/** Invisible spacer characters (LinkedIn pads its mail with them) and runs of spaces break phrase matching. */
export function tidy(text: string | null | undefined): string {
  return sub(BLANK_RUN, " ", sub(ODD_SPACES, " ", sub(INVISIBLE, "", text || "")));
}

/** LinkedIn's "your application was sent" mail: the title sits between two mentions of the company. */
export function linkedinRole(msg: Message, body: string, company: string): string {
  const domain = senderDomain(msg);
  if (!company || !(domain === "linkedin.com" || domain.endsWith(".linkedin.com"))) return "";
  // The title may not contain "sent to", so the match starts at the last mention, not the banner at the top.
  const c = reEscape(company);
  const m = search(py(R`sent to ${c}\s+(?P<r>(?:(?!sent to)[^\n\u{b7}])+?)\s+${c}\s*\u{b7}`, "i"), body);
  return m ? cleanRole(m.groups?.r) : "";
}

export function extractCompanyRole(msg: Message): [string, string] {
  let company = "";
  let role = "";
  const body = tidy(msg.body);
  // The last pass flattens line breaks, for titles that mail software broke across lines.
  for (const text of [tidy(msg.subject), body, sub(WS_RUN, " ", body)]) {
    for (const pat of PATTERNS) {
      const m = search(pat, text);
      if (!m) continue;
      const groups = m.groups ?? {};
      company = company || cleanValue(groups.c);
      role = role || cleanRole(groups.r);
    }
    if (company && role) break;
  }
  company = company || senderCompany(msg);
  role = role || linkedinRole(msg, tidy(msg.body), company);
  return [company || UNKNOWN_COMPANY, role || UNKNOWN_ROLE];
}

export const extractCompany = (msg: Message): string => extractCompanyRole(msg)[0];
export const extractRole = (msg: Message): string => extractCompanyRole(msg)[1];

export function senderCompany(msg: Message): string {
  const rawName = msg.senderName || "";
  let name = cleanValue(sub(NOISE_WORDS_G, " ", rawName));
  if (name.includes("@")) name = "";
  const domain = senderDomain(msg);
  if (FREE_MAIL.has(domain)) {
    // Nothing to learn from the domain; only trust a name that reads like an organization.
    return name && (search(ORG_WORDS, rawName) || search(COMPANY_SUFFIX, rawName)) ? name : "";
  }
  if (isAtsDomain(domain)) {
    if (name) return name; // the display name is the employer ("Acme Careers"); the domain is the vendor
    // Some hiring systems send from <employer>@<system>.com with no display name.
    const local = msg.senderEmail.split("@")[0];
    return match(NO_REPLY_LOCAL_FULL, local) ? "" : capitalize(local);
  }
  const parts = domain.split(".");
  const n = parts.length;
  const label =
    n >= 3 && cpLen(parts[n - 1]) === 2 && cpLen(parts[n - 2]) <= 3 ? parts[n - 3] : n >= 2 ? parts[n - 2] : "";
  // A person's name ("Jane Smith <jane@acme.com>") isn't the company; the domain is.
  if (name && label && fold(name).includes(fold(label))) return name;
  return capitalize(label);
}

export function companyKey(company: string): string {
  if (!company || company === UNKNOWN_COMPANY) return "";
  return fold(sub(COMPANY_SUFFIX_G, "", casefold(company)));
}

export function roleKey(role: string): string {
  if (!role || role === UNKNOWN_ROLE) return "";
  return fold(role);
}

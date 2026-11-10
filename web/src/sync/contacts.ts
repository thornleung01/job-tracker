// People you are in touch with, and what they do, worked out from the email threads. Plain rules, no AI
// (jobtracker/contacts.py).
//
// A person turns up in two ways:
// - as a sender: their address and display name, and a title found in their signature;
// - as someone named in a message, usually a calendar invite: "Ben Hallett-Berry (Manager, Strategy & Operations)".
//
// People belong to an application: a person's title is whatever that application's emails say, and your corrections apply
// to that application only. Nothing is stored except those corrections (contactEdits); the list is rebuilt from the saved
// emails each time.
import { isContactKey } from "../db/contactKey";
import { ActionError, MissingRecordError } from "../db/errors";
import { MAX_NAME_CHARS, MAX_TITLE_CHARS } from "../db/limits";
import { UNKNOWN_ROLE } from "../pipeline/extract";
import type { ApplicationRow, ContactEditRow, EmailRow, JobTrackerDB } from "../db/schema";
import { tx } from "../db/schema";
import { byDesc } from "./compare";
import { liveApplications } from "./live";
import { replyLink, recipient, type MailLink } from "./links";
import { pipeline } from "./pipeline";
import type { Suggestion } from "./queries";
import { plural, squeeze } from "./text";

// Words that make a phrase a job title. A title is the capitalised words after a name, up to the last of these.
const TITLE_KEYWORDS = new Set([
  "recruiter", "recruiting", "recruitment", "sourcer", "talent", "acquisition", "coordinator", "manager", "director", "head", "vp",
  "vice", "president", "lead", "partner", "specialist", "associate", "analyst", "engineer", "officer", "founder", "ceo", "cto", "coo",
  "cfo", "hr", "people", "operations", "worker", "representative", "consultant", "executive", "generalist", "principal", "owner",
  "scientist", "designer", "developer", "advisor", "adviser", "administrator", "assistant", "supervisor",
  "gm", "chief", "svp", "evp", "controller", "treasurer", "strategist", "architect",
]);
const TITLE_JOINERS = new Set(["&", "of", "and", "for", "the", "-", "/", ","]);
const STOP_TOKEN = /^(?:[|·•@]|[-–—])$|@|^\d|^https?:/i;
const TEAM_WORDS = new Set([
  "team", "hiring", "recruiting", "careers", "career", "support", "noreply", "no-reply", "hr", "people", "talent", "notifications",
  "jobs", "recruitment", "staffing", "admin", "info", "hello", "linkedin", "indeed", "glassdoor", "do", "not", "reply",
]);
const NAME_TOKEN = /^[A-Z][A-Za-z'’-]+$/;
const NAME_PARTICLE = new Set(["de", "la", "van", "von", "del", "da", "di", "le", "al", "bin", "ibn"]);
const MENTION = /(?<n>[A-Z][A-Za-z'’-]+(?: (?:[a-z]{2,3}|[A-Z][a-z]+))*(?: [A-Z][A-Za-z'’-]+){1,2}) \((?<t>[^()]{3,90})\)/g;
const TEAM_INTRO = /\b(?:I'm|I am|my name is|My name’s|My name's)\s+(?<n>[A-Z][a-z]+)[^.]{0,40}?\b(?:from|part of|on) the (?<t>[A-Z][\w&/ ]{2,40}? team)/i;

export const KIND_LABEL: Readonly<Record<string, string>> = { recruiter: "Recruiter", hiring: "Hiring side", people: "People Ops" };
export const MAX_MAILS = 25;

export type ContactKind = "recruiter" | "hiring" | "people" | "";

export function kindOf(title: string): ContactKind {
  const t = (title || "").toLowerCase();
  if (/recruit|sourcer|talent|coordinator/.test(t)) return "recruiter";
  if (/\bpeople\b|\bhr\b|human resources/.test(t)) return "people";
  if (/manager|director|\bhead\b|\bvp\b|vice president|president|chief|\bceo\b|\bcto\b|\bcoo\b|lead\b|principal|founder|owner/.test(t)) return "hiring";
  return "";
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

/** A display name that is a human name, from an address that takes replies: not "Deel HQ Hiring Team", not a bot. */
export function looksLikeAPerson(name: string, address: string): boolean {
  if (!name || name.toLowerCase() === (address || "").toLowerCase() || name.includes("@")) return false;
  const tokens = name.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 5) return false;
  for (const t of tokens) {
    if (TEAM_WORDS.has(t.toLowerCase())) return false;
    if (!(NAME_TOKEN.test(t) || NAME_PARTICLE.has(t.toLowerCase()))) return false;
  }
  return true;
}

function isKey(token: string): boolean {
  return TITLE_KEYWORDS.has(token.replace(/^[,&.()/-]+|[,&.()/-]+$/g, "").toLowerCase());
}

const isUpper = (ch: string) => ch !== ch.toLowerCase() && ch === ch.toUpperCase();

/** The job title that follows a name in a run of words, or "". */
function titleAfter(tokens: string[], start: number): string {
  const take: string[] = [];
  for (const tok of tokens.slice(start, start + 9)) {
    if (STOP_TOKEN.test(tok)) break;
    take.push(tok);
  }
  let last = -1;
  take.forEach((t, i) => {
    if (isKey(t)) last = i;
  });
  if (last < 0) return "";
  const words = take.slice(0, last + 1);
  // Every word must read like part of a title: capitalised, or a small joining word.
  if (!words.every((w) => isUpper(w[0]) || TITLE_JOINERS.has(w.toLowerCase()) || w[0] === "&") || TITLE_JOINERS.has(words[0].toLowerCase())) return "";
  return words.join(" ").replace(/^[ ,\-/&]+|[ ,\-/&]+$/g, "");
}

/** Looks for `<name> <title>` in flattened message text, trying the full name first, then the first name. */
export function titleInSignature(text: string, names: string[]): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  const low = tokens.map((t) => t.toLowerCase());
  for (const name of names) {
    const want = name.split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());
    if (!want.length) continue;
    for (let i = 0; i < tokens.length - want.length; i++) {
      if (want.every((w, k) => low[i + k] === w)) {
        const title = titleAfter(tokens, i + want.length);
        if (title) return title;
      }
    }
  }
  return "";
}

/** People named with a title in brackets, usually in an interview invite. */
export function titlesInMentions(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of text.matchAll(MENTION)) {
    const name = m.groups!.n;
    const title = m.groups!.t.split(/\s+[-–|]\s+/)[0].trim();
    if (!title.split(/\s+/).some(isKey) || !looksLikeAPerson(name, "")) continue;
    out.push([name, title]);
  }
  return out;
}

/** A stored email's body as one line of readable text. */
function plainText(body: string | null): string {
  const [main, thread, footer] = pipeline().mailParts(body ?? "");
  return [...main, ...thread, ...footer].join(" ").replace(/\s+/g, " ");
}

interface MailRef {
  id: number;
  subject: string;
  when: string;
  how: "from" | "mentions";
}

export interface Contact {
  /** "<applicationId>|<address>" or "<applicationId>|name:<name>"; what edits are keyed by */
  key: string;
  appId: number;
  name: string;
  email: string;
  title: string;
  kind: ContactKind;
  company: string;
  role: string;
  emails: number;
  last: string;
  edited: boolean;
  mentionedOnly: boolean;
  mails: MailRef[];
  mailCount: number;
  latestMail: MailRef | null;
  /** a new message to them, written in the mailbox their latest email reached */
  compose: MailLink | null;
}

interface Person {
  appId: number;
  norm: string;
  name: string;
  email: string;
  titles: Map<string, number>;
  emails: number;
  last: string;
  sender: boolean;
  mails: Map<number, MailRef>;
  lastFrom?: { provider: string; address: string; sender: string | null; subject: string | null; webLink: string | null };
}

function mostCommon(counts: Map<string, number>): string {
  let best = "";
  let bestN = 0;
  for (const [title, n] of counts) {
    if (n > bestN) {
      best = title;
      bestN = n;
    }
  }
  return best;
}

/** What one email says about people, worked out once (the work is the expensive part of building the list). */
interface EmailFacts {
  /** a title found for the sender, or null when the sender is not someone who could be a person here */
  senderTitle: string | null;
  mentions: [string, string][];
}

// A stored email never changes, so what it says about people is kept until the tab closes: opening People again reads the
// table and nothing more. The key holds everything the answer depends on, so another database or an imported file can't hit it.
const factsCache = new Map<string, EmailFacts>();
const FACTS_CACHE_MAX = 20_000;

function factsOf(dbName: string, e: EmailRow, name: string, address: string): EmailFacts {
  const key = `${dbName}\u0000${e.id}\u0000${e.providerMsgId}\u0000${(e.body ?? "").length}\u0000${e.sender}`;
  const known = factsCache.get(key);
  if (known) return known;
  const text = plainText(e.body);
  let senderTitle: string | null = null;
  if (address && recipient(e.sender ?? "") && looksLikeAPerson(name, address)) {
    const localFirst = address.split("@")[0].split(/[._-]/)[0];
    senderTitle = titleInSignature(text, [name, name.split(/\s+/)[0], localFirst.charAt(0).toUpperCase() + localFirst.slice(1).toLowerCase()]);
    if (!senderTitle) {
      // "I'm Nadia, from the People OPS team" says what they do even with no signature
      const m = TEAM_INTRO.exec(text);
      if (m && m.groups!.n.toLowerCase() === name.split(/\s+/)[0].toLowerCase()) senderTitle = m.groups!.t;
    }
  }
  const facts = { senderTitle, mentions: titlesInMentions(text) };
  if (factsCache.size >= FACTS_CACHE_MAX) factsCache.clear();
  factsCache.set(key, facts);
  return facts;
}

type PersonMap = Map<string, Person>; // (application, normalised name): a sender and a mention of them are one person

interface Mention {
  appId: number;
  name: string;
  title: string;
  email: EmailRow;
}

/** The senders: people who wrote to you from an address that takes replies. Returns the mentions found along the way. */
function collectSenders(dbName: string, emails: readonly EmailRow[], accounts: ReadonlyMap<number, { provider: string; address: string }>, people: PersonMap): Mention[] {
  const ownAddresses = new Set([...accounts.values()].map((a) => a.address.toLowerCase()));
  const mentions: Mention[] = [];
  for (const e of emails) {
    const appId = e.applicationId as number;
    const account = accounts.get(e.accountId)!;
    const [name, rawAddress] = pipeline().splitSender(e.sender ?? "");
    const address = rawAddress.toLowerCase();
    const facts = factsOf(dbName, e, name, address);
    if (facts.senderTitle !== null && !ownAddresses.has(address)) {
      const id = `${appId}\u0000${nameKey(name)}`;
      let person = people.get(id);
      if (!person) {
        person = { appId, norm: nameKey(name), name, email: address, titles: new Map(), emails: 0, last: "", sender: true, mails: new Map() };
        people.set(id, person);
      }
      person.emails++;
      if (e.receivedAt > person.last) person.last = e.receivedAt;
      person.mails.set(e.id, { id: e.id, subject: e.subject || "(no subject)", when: e.receivedAt, how: "from" });
      person.lastFrom = { provider: account.provider, address: account.address, sender: e.sender, subject: e.subject, webLink: e.webLink }; // the newest email they sent
      if (facts.senderTitle) person.titles.set(facts.senderTitle, (person.titles.get(facts.senderTitle) ?? 0) + 1);
    }
    for (const [n, t] of facts.mentions) mentions.push({ appId, name: n, title: t, email: e });
  }
  return mentions;
}

/** Adds the people only named in a message (usually an invite), or joins them to the sender they are. */
function mergeMentions(people: PersonMap, mentions: readonly Mention[]): void {
  const senderFirstNames = new Set<string>();
  for (const person of people.values()) if (person.sender) senderFirstNames.add(`${person.appId}\u0000${person.name.split(/\s+/)[0].toLowerCase()}`);
  for (const m of mentions) {
    let name = m.name;
    const words = name.split(" ");
    if (words.length >= 3 && senderFirstNames.has(`${m.appId}\u0000${words[0].toLowerCase()}`) && !NAME_PARTICLE.has(words[0].toLowerCase())) {
      name = words.slice(1).join(" "); // "Jocelyn Katie Ellison (Director)": the first word is the line above (a sender's name)
    }
    const id = `${m.appId}\u0000${nameKey(name)}`;
    let person = people.get(id);
    if (!person) {
      person = { appId: m.appId, norm: nameKey(name), name, email: "", titles: new Map(), emails: 0, last: "", sender: false, mails: new Map() };
      people.set(id, person);
    }
    person.titles.set(m.title, (person.titles.get(m.title) ?? 0) + 1);
    if (m.email.receivedAt > person.last) person.last = m.email.receivedAt;
    if (!person.mails.has(m.email.id)) {
      person.mails.set(m.email.id, { id: m.email.id, subject: m.email.subject || "(no subject)", when: m.email.receivedAt, how: "mentions" });
    }
  }
}

/** The finished list: your corrections applied (a hidden person is left out), newest contact first. */
function toContacts(people: PersonMap, edits: ReadonlyMap<string, ContactEditRow>, apps: ReadonlyMap<number, ApplicationRow>): Contact[] {
  const out: Contact[] = [];
  for (const person of people.values()) {
    const key = `${person.appId}|${person.email || "name:" + person.norm}`;
    const edit = edits.get(key);
    if (edit?.hidden) continue;
    const title = edit && edit.title !== null ? edit.title : mostCommon(person.titles);
    const app = apps.get(person.appId);
    const mails = [...person.mails.values()].sort((a, b) => byDesc<MailRef>((m) => m.when)(a, b) || b.id - a.id);
    const sent = person.lastFrom;
    out.push({
      key, appId: person.appId, name: edit?.name ? edit.name : person.name, email: person.email, title, kind: kindOf(title),
      company: app?.company ?? "", role: app?.role ?? "", emails: person.emails, last: person.last,
      edited: Boolean(edit), mentionedOnly: !person.sender,
      mails: mails.slice(0, MAX_MAILS), mailCount: mails.length, latestMail: mails[0] ?? null,
      compose: sent ? replyLink(sent.provider, sent.address, sent.sender ?? "", sent.subject, sent.webLink) : null,
    });
  }
  return out.sort(byDesc((c) => c.last));
}

/**
 * The people on each application (or on one), worked out from that application's own emails, newest contact first. A person
 * is listed once per application, with the title that application's mail gives them. Each person also carries the emails
 * connected to them (what they sent, and invites that name them) and a link to write to them.
 */
export async function derive(db: JobTrackerDB, appId?: number): Promise<Contact[]> {
  const accounts = new Map((await db.accounts.toArray()).map((a) => [a.id, a]));
  const apps = new Map((await liveApplications(db)).map((a) => [a.id, a]));
  const emails = (appId === undefined ? await db.emails.toArray() : await db.emails.where("applicationId").equals(appId).toArray())
    .filter((e) => e.related && !e.needsReview && e.applicationId != null && apps.has(e.applicationId) && accounts.has(e.accountId))
    .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : a.id - b.id));

  const people: PersonMap = new Map();
  mergeMentions(people, collectSenders(db.name, emails, accounts, people));
  const edits = new Map((await db.contactEdits.toArray()).map((r) => [r.key, r]));
  return toContacts(people, edits, apps);
}

/** Address -> title, from people already worked out. */
export function titleByAddress(people: Contact[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of people) if (c.email && c.title) out[c.email] = c.title;
  return out;
}

/** Address -> title within one application, for showing a title beside a sender's name on that application's emails. */
export async function titles(db: JobTrackerDB, appId: number): Promise<Record<string, string>> {
  return titleByAddress(await derive(db, appId));
}

const NOT_A_PERSON_KEY = "That isn't a person key.";

/** A correction belongs to an application: refuse one for an application that is gone (erased in another tab), or it would sit in the database and in every export with nothing to attach to. */
async function requireKeyedApplication(db: JobTrackerDB, key: string): Promise<void> {
  const appId = Number(key.slice(0, key.indexOf("|")));
  if (!(await db.applications.get(appId))) throw new MissingRecordError(`No application ${appId}`);
}

export async function saveEdit(db: JobTrackerDB, key: string, name: string, title: string): Promise<void> {
  if (!isContactKey(key)) throw new ActionError(NOT_A_PERSON_KEY);
  const cleanName = squeeze(name).slice(0, MAX_NAME_CHARS);
  const cleanTitle = squeeze(title).slice(0, MAX_TITLE_CHARS);
  await tx(db, async () => {
    await requireKeyedApplication(db, key);
    await db.contactEdits.put({ key, name: cleanName || null, title: cleanTitle, hidden: false });
  });
}

const PEOPLE_SUGGESTION_LIMIT = 300;

/**
 * What the People search offers, from people already worked out: the people (with their company), then companies, roles and
 * job titles with how many people they cover. Newest contact first, one pass, no email reads.
 */
export function suggestionsFor(people: readonly Contact[]): Suggestion[] {
  const named = new Map<string, Suggestion>();
  const counted = new Map<Suggestion["kind"], Map<string, Suggestion>>();
  const count = (kind: Suggestion["kind"], text: string) => {
    const key = text.toLocaleLowerCase();
    const group = counted.get(kind) ?? new Map<string, Suggestion>();
    counted.set(kind, group);
    const known = group.get(key);
    if (known) known.n++;
    else group.set(key, { kind, text, n: 1 });
  };
  for (const c of people) {   // newest contact first, so the first of each is the one to show
    const key = c.name.toLocaleLowerCase();
    if (c.name && !named.has(key)) named.set(key, { kind: "Person", text: c.name, n: 1, note: c.company });
    if (c.company) count("Company", c.company);
    if (c.role && c.role !== UNKNOWN_ROLE) count("Role", c.role);
    if (c.title) count("Title", c.title);
  }
  const out = [...named.values()].slice(0, PEOPLE_SUGGESTION_LIMIT);
  for (const kind of ["Company", "Role", "Title"] as const) {
    for (const s of [...(counted.get(kind)?.values() ?? [])].slice(0, PEOPLE_SUGGESTION_LIMIT)) out.push({ ...s, note: plural(s.n, "person", "people") });
  }
  return out;
}

/** The same, from the database. The People page already has the people, so it calls suggestionsFor itself. */
export async function peopleSuggestions(db: JobTrackerDB): Promise<Suggestion[]> {
  return suggestionsFor(await derive(db));
}

export async function hide(db: JobTrackerDB, key: string): Promise<void> {
  if (!isContactKey(key)) throw new ActionError(NOT_A_PERSON_KEY);
  await tx(db, async () => {
    await requireKeyedApplication(db, key);
    const existing = await db.contactEdits.get(key);
    await db.contactEdits.put({ key, name: existing?.name ?? null, title: existing?.title ?? null, hidden: true });
  });
}

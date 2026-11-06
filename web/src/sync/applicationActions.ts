// What an application offers to do outside the app: a follow-up email to write in the person's own mail service, and the
// interview days to put in a calendar. Reads only; nothing is sent and nothing changes.
import type { AccountRow, EmailRow, JobTrackerDB } from "../db/schema";
import { idleDaysSince, localToday } from "../db/time";
import { pipeline } from "./pipeline";
import { byDesc } from "./compare";
import { derive, looksLikeAPerson, type Contact } from "./contacts";
import { draftLink, followUpDraft, type DraftContact } from "./followUpDraft";
import { needsFollowUp, remindsOfInterviews } from "./followUp";
import { groupBy } from "./groupBy";
import { isLive, liveApplications } from "./live";
import type { IcsEvent } from "./ics";
import type { MailLink } from "./links";
import { interviewDays } from "./upcoming";

export interface ApplicationActions {
  /** a new message in the account's own mail service, or null when there is no mail service to open it in */
  draft: MailLink | null;
  /** who the draft is addressed to ("" when nobody); shown only as a tooltip */
  to: string;
  /** the application has gone quiet (see needsFollowUp) */
  needsFollowUp: boolean;
  /** the interview days from today on, earliest first */
  interviews: IcsEvent[];
}

type Mail = Pick<EmailRow, "id" | "accountId" | "sender" | "receivedAt" | "webLink">;

/** The address in a "Name <address>" sender, lowercase. */
const addressOf = (sender: string | null): string => pipeline().splitSender(sender ?? "")[1].toLowerCase();

const REAL_KINDS = new Set(["recruiter", "hiring", "people"]);

/**
 * Who to write to, as a name and an address: the newest person on the application who is known to be a recruiter or on the
 * hiring side and has an address, else the newest person with an address, else the sender of the newest email that takes
 * replies (never one of your own addresses), else nobody. `mails` are newest first.
 */
export function pickRecipient(people: readonly Pick<Contact, "name" | "email" | "kind" | "mentionedOnly">[], mails: readonly Pick<Mail, "sender">[], own: ReadonlySet<string>): DraftContact | null {
  const withAddress = people.filter((c) => c.email && !c.mentionedOnly && !own.has(c.email.toLowerCase()));
  const person = withAddress.find((c) => REAL_KINDS.has(c.kind)) ?? withAddress[0];
  if (person) return { name: person.name, email: person.email };
  for (const m of mails) {
    const [name, address] = pipeline().splitSender(m.sender ?? "");
    if (!address || own.has(address.toLowerCase()) || !pipeline().recipient(m.sender ?? "")) continue;
    return { name: looksLikeAPerson(name, address) ? name : "", email: address };
  }
  return null;
}

/**
 * The mailbox to open the draft in, among the connected ones only (a mailbox you have disconnected is never used): the one
 * that got the person's newest email, else the one that got the newest email, else the first connected one. `mails` are those
 * of connected mailboxes, newest first.
 */
function pickAccount(contact: DraftContact | null, mails: readonly Mail[], accounts: ReadonlyMap<number, AccountRow>): { account: AccountRow; webLink: string | null } | null {
  const theirs = contact ? mails.find((m) => addressOf(m.sender) === contact.email.toLowerCase()) : undefined;
  const chosen = theirs ?? mails[0];
  const account = (chosen && accounts.get(chosen.accountId)) ?? [...accounts.values()].find((a) => a.active);
  return account ? { account, webLink: chosen?.accountId === account.id ? chosen.webLink : null } : null;
}

export async function applicationActions(db: JobTrackerDB, appId: number, now: Date = new Date()): Promise<ApplicationActions | null> {
  const app = await db.applications.get(appId);
  if (!app || !isLive(app)) return null;
  const today = localToday(now);
  const accounts = new Map((await db.accounts.toArray()).map((a) => [a.id, a]));
  const all = (await db.emails.where("applicationId").equals(appId).toArray()).sort((a, b) => byDesc<EmailRow>((e) => e.receivedAt)(a, b) || b.id - a.id);
  const mails = all.filter((e) => accounts.has(e.accountId));
  // Every address you have used is yours, connected or not, so a draft is never addressed to yourself; only a connected one can send it.
  const own = new Set([...accounts.values()].map((a) => a.address.toLowerCase()));
  const connected = new Map([...accounts].filter(([, a]) => a.active));
  const contact = pickRecipient(await derive(db, appId), mails, own);
  const picked = pickAccount(contact, mails.filter((e) => connected.has(e.accountId)), connected);
  const draft = followUpDraft(app, contact, today);
  return {
    draft: picked ? draftLink(picked.account.provider, picked.account.address, draft, picked.webLink) : null,
    to: draft.to,
    needsFollowUp: needsFollowUp(app.stage, idleDaysSince(app.lastActivity, now)),
    interviews: remindsOfInterviews(app.stage) ? interviewEvents(app, all.filter((e) => e.event === "interview"), today) : [],
  };
}

const interviewEvents = (app: { id: number; company: string; role: string; stage: string }, interviewMails: readonly EmailRow[], today: string): IcsEvent[] =>
  interviewDays(interviewMails, today).map((day) => ({ appId: app.id, company: app.company, role: app.role, stage: app.stage, day }));

/** Every upcoming interview day of every application, earliest first. Rejected applications and offers have none. */
export async function upcomingInterviewEvents(db: JobTrackerDB, now: Date = new Date()): Promise<IcsEvent[]> {
  const today = localToday(now);
  const byApp = groupBy((await db.emails.toArray()).filter((e) => e.event === "interview" && e.applicationId != null), (e) => e.applicationId as number);
  const events: IcsEvent[] = [];
  for (const app of await liveApplications(db)) {
    if (remindsOfInterviews(app.stage)) events.push(...interviewEvents(app, byApp.get(app.id) ?? [], today));
  }
  return events.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.company.localeCompare(b.company) || a.appId - b.appId));
}

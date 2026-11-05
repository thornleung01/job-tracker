// What sync needs from the classifier in web/src/pipeline. Only web/src/sync/pipeline.ts imports the real thing,
// so a rename over there is a one-file fix here.
import type { Message } from "../types";
import type { Confidence, EventName } from "../db/stages";

export interface Classification {
  related: boolean;
  event: EventName | null;
  confidence: Confidence;
  reason: string;
}

/** The rules learned from corrections (learn.py's Learned), as the classifier reads them. */
export interface LearnedView {
  readonly blockSenders: ReadonlySet<string>;
  readonly blockDomains: ReadonlySet<string>;
  readonly allowSenders: ReadonlySet<string>;
  readonly distrust: ReadonlySet<string>;
  blocks(sender: string, domain: string): boolean;
}

/** Where findApplication reads from (see MatchStore in pipeline/match.ts). */
export interface MatchStore<Id extends number | string> {
  threadApplication(threadId: string): Id | null | undefined | Promise<Id | null | undefined>;
  applicationsFor(ckey: string): readonly MatchCandidate<Id>[] | Promise<readonly MatchCandidate<Id>[]>;
}

export interface MatchCandidate<Id extends number | string> {
  id: Id;
  role: string;
  roleKey: string;
  stage: string;
}

export interface Match<Id extends number | string> {
  kind: "matched" | "new" | "ambiguous";
  applicationId: Id | null;
}

export interface MailLink {
  label: string;
  url: string;
}

export interface Pipeline {
  classify(msg: Message, learned?: LearnedView | null): Classification;
  /** [company, role]; "Unknown company" / "Unknown role" when nothing was found */
  extractCompanyRole(msg: Message): [string, string];
  companyKey(company: string): string;
  roleKey(role: string): string;
  isAtsDomain(domain: string): boolean;
  /** 'Pat Lee <pat@acme.com>' -> ['Pat Lee', 'pat@acme.com'] */
  splitSender(sender: string | null | undefined): [string, string];
  /** (the message, the earlier thread, the footer), each a list of text blocks (mailtext.parts) */
  mailParts(body: string | null | undefined): [string[], string[], string[]];
  sameRole(aKey: string, bKey: string, aRole?: string, bRole?: string): boolean;
  /** Which application an email belongs to: the one matching algorithm, read through `store`. */
  findApplication<Id extends number | string>(
    store: MatchStore<Id>, threadId: string, ckey: string, rkey: string, event?: string | null, role?: string,
  ): Promise<Match<Id>>;
  /** The learned-rules blocking rule shared with the classifier's own tests. */
  isBlocked(rules: { allowSenders: ReadonlySet<string>; blockSenders: ReadonlySet<string>; blockDomains: Iterable<string> }, sender: string, domain: string): boolean;
  /** Domains that are an inbox anyone can open (Gmail, Outlook.com ...), not an employer. */
  readonly FREE_MAIL: ReadonlySet<string>;
  /** Where a reply to this sender would go, or null when they don't take replies */
  recipient(sender: string): string | null;
  mailboxLink(provider: string, address: string | null, threadId: string | null, webLink: string | null): MailLink | null;
  replyLink(provider: string, account: string | null, sender: string, subject: string | null, webLink?: string | null): MailLink | null;
  readonly UNKNOWN_COMPANY: string;
  readonly UNKNOWN_ROLE: string;
}

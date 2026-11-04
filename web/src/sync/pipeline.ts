// THE ADAPTER: the one file in web/src/sync that imports the classifier (web/src/pipeline). If a name over there
// changes, fix it here and nowhere else. setPipeline() lets a test swap in a stand-in.
import * as real from "../pipeline";
import type { MailLink, Pipeline } from "./pipelineTypes";

const asLink = (l: readonly [string, string] | null): MailLink | null => (l ? { label: l[0], url: l[1] } : null);

const recipient = (sender: string): string | null => {
  const to = real.splitSender(sender)[1];
  return real.isAddress(to || "") && !real.NO_REPLY.test(to.split("@")[0]) ? to : null;
};

const realPipeline: Pipeline = {
  classify: (msg, learned) => real.classify(msg, learned),
  extractCompanyRole: real.extractCompanyRole,
  companyKey: real.companyKey,
  roleKey: real.roleKey,
  isAtsDomain: (domain) => real.isAtsDomain(domain),
  splitSender: real.splitSender,
  mailParts: real.parts,
  sameRole: real.sameRole,
  recipient,
  mailboxLink: (provider, address, threadId, webLink) => asLink(real.mailboxLink(provider, address, threadId, webLink)),
  replyLink: (provider, account, sender, subject, webLink = null) => asLink(real.replyLink(provider, account, sender, subject, webLink)),
  UNKNOWN_COMPANY: real.UNKNOWN_COMPANY,
  UNKNOWN_ROLE: real.UNKNOWN_ROLE,
};

let current: Pipeline = realPipeline;

export function setPipeline(p: Pipeline | null): void {
  current = p ?? realPipeline;
}

export function pipeline(): Pipeline {
  return current;
}

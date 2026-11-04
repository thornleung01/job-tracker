// Job-alert mail from LinkedIn or Indeed (jobtracker/jobs/alerts.py alert_site). The Jobs tab is deferred in the hosted
// edition, so these are only recognised, then remembered like other non-application mail.
import type { Message } from "../types";

function isDomain(domain: string, site: string): boolean {
  return domain === site || domain.endsWith("." + site);
}

export function alertSite(msg: Message): "linkedin" | "indeed" | null {
  const domain = msg.senderEmail.slice(msg.senderEmail.lastIndexOf("@") + 1).toLowerCase();
  const subject = msg.subject.toLowerCase();
  if (isDomain(domain, "linkedin.com") && /job alert|new jobs?|jobs? (?:for|like)|is hiring|recommended/.test(`${subject} ${msg.senderName.toLowerCase()}`)) {
    return "linkedin";
  }
  if (isDomain(domain, "indeed.com") && /new .*jobs?|job alert|jobs? (?:for|in|near)|and \d+ more jobs?/.test(subject)) return "indeed";
  return null;
}

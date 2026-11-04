// Ported from tests/test_classify.py and the classifier parts of tests/test_newsletters.py.
import { describe, expect, it } from "vitest";
import { classify, extractCompanyRole, makeLearned, UNKNOWN_COMPANY, UNKNOWN_ROLE } from "../../src/pipeline";
import { mk } from "./helpers";

describe("events", () => {
  const cases: [string, string, string][] = [
    ["Thank you for applying to Acme", "We have received your application.", "applied"],
    ["Your application was sent to Acme", "", "applied"],
    ["Application received", "We've received your application for the Data Analyst role.", "applied"],
    ["Update on your Acme application", "Unfortunately, we will not be moving forward with your application.", "rejected"],
    ["Your application", "We regret to inform you that the position has been filled.", "rejected"],
    ["Re: Data Analyst", "We decided to move forward with other candidates for this role.", "rejected"],
    ["Interview invitation - Data Analyst", "", "interview"],
    ["Next steps", "We'd like to schedule a call to discuss your application. Please select a time.", "interview"],
    ["Quick chat?", "I'm a recruiter at Acme. Are you free for a phone screen on Tuesday?", "interview"],
    ["Complete your assessment", "Please complete the online assessment within 5 days to continue your application.", "assessment"],
    ["Next step: coding challenge", "Your application moved on. Take the take-home coding challenge on HackerRank.", "assessment"],
    ["Offer of employment", "We are pleased to offer you the Data Analyst position at Acme.", "offer"],
    ["Your offer letter", "Attached is your offer letter for the role. Please sign by Friday.", "offer"],
  ];
  it.each(cases)("%s", (subject, body, event) => {
    const r = classify(mk(subject, body));
    expect(r.related && r.event === event, r.reason).toBe(true);
  });

  it("offer beats applied", () => {
    expect(classify(mk("Congratulations", "Thank you for applying. We are pleased to offer you the role.")).event).toBe("offer");
  });
  it("rejection beats thanks for applying", () => {
    expect(classify(mk("Your application", "Thank you for applying. Unfortunately we will not be moving forward.")).event).toBe("rejected");
  });
});

describe("known traps", () => {
  it("a conditional interview is not an interview", () => {
    const r = classify(mk("Thanks for applying to Acme", "We received your application. We will contact you if selected for an interview."));
    expect(r.event).toBe("applied");
  });
  it("'unable to reply to every applicant' is not a rejection", () => {
    const r = classify(mk("We received your application", "Thank you for applying. Unfortunately we are unable to reply to every applicant, but we will be in touch if your profile is a good match."));
    expect(r.event).toBe("applied");
  });
  it("a special offer is not a job offer", () => {
    const r = classify(mk("Special offer: 40% off", "Limited time offer on career coaching. Apply now.", "Deals <deals@shop.com>"));
    expect(r.related && r.event === "offer").toBe(false);
  });
  it("'unfortunately' alone is not a rejection", () => {
    expect(classify(mk("Order update", "Unfortunately your parcel is delayed.", "Shop <orders@shop.com>")).related).toBe(false);
  });
  it("a negated offer is a rejection, not an offer", () => {
    const r = classify(mk("Your application", "We are unable to extend an offer to you at this time.", "Pat <pat@acme.com>"));
    expect(r.event).toBe("rejected");
  });
  it.each([
    ["New jobs for you: Data Analyst", "LinkedIn <jobalerts-noreply@linkedin.com>"],
    ["Jobs you may like this week", "Indeed <alert@indeed.com>"],
    ["Weekly digest: hiring trends", "Medium <digest@medium.com>"],
  ])("alert or digest is excluded: %s", (subject, sender) => {
    expect(classify(mk(subject, "Software Engineer at Acme, apply now", sender)).related).toBe(false);
  });
  it("unrelated mail is ignored", () => {
    expect(classify(mk("Your receipt", "Thanks for your purchase", "Store <no-reply@store.com>")).related).toBe(false);
  });
  it("a hiring-system sender without a phrase is a medium heard_back", () => {
    const r = classify(mk("A message from Acme", "Hello there.", "Acme <no-reply@us.greenhouse-mail.io>"));
    expect([r.related, r.event, r.confidence]).toEqual([true, "heard_back", "medium"]);
  });
  it("a personal reply without a stage phrase is low confidence", () => {
    const r = classify(mk("Re: your application", "Hi, quick question about your CV.", "Sam <sam@acme.com>"));
    expect([r.event, r.confidence]).toEqual(["heard_back", "low"]);
  });
  it("curly quotes do not hide phrases", () => {
    expect(classify(mk("We\u{2019}ve received your application", "")).event).toBe("applied");
  });
});

describe("newsletters and marketing", () => {
  const strata =
    "Inside: Tesla SQL challenge, ML vs. AI vs. LLM roles, and AI's hype-vs-numbers problem ( https://platform.stratascratch.com/coding?code_type=1&utm_source=newsletter&utm_medium=email&utm_campaign=102026 ) Build confidence in your interview prep. Practice assessment questions. Unsubscribe";
  it.each([
    ["How Ready Are You? StrataScratch Now Scores It", "StrataScratch Team <hello@stratascratch.com>", strata],
    ["Interview Loops for Popular Companies and Industries", "StrataScratch Team <hello@stratascratch.com>", strata],
    ["New Salary Form, SWEs to Manager Ratio, and AI Token Budgets", "Levels.fyi <hello@levels.fyi>", "Levels.fyi Product Update Having trouble viewing? View this email online. See what an offer looks like at top companies."],
    ["Just in at Wealthsimple: This week's employee reviews and more", "Glassdoor <noreply@glassdoor.com>", "Check out recent updates and stay on top of your work game. Apply to open roles. Interview reviews."],
    ["5 Claude Tricks That Give You an Unfair Advantage", "Medium Daily Digest <noreply@medium.com>", "Stories for you. Become a member. Hiring managers love this. Unsubscribe"],
  ])("newsletter is ignored: %s", (subject, sender, body) => {
    expect(classify(mk(subject, body, sender)).related).toBe(false);
  });

  it("an unknown sender is still recognised as marketing by its footer", () => {
    const body = "We would like to schedule an interview prep session! Read more: https://x.io/?utm_medium=email Unsubscribe";
    expect(classify(mk("Your weekly career boost", body, "Career Co <hello@careerco.io>")).related).toBe(false);
  });
  it("the mailing-list header alone is enough", () => {
    const body = "We would like to schedule an interview with you. Please reply with your availability.";
    expect(classify(mk("Next steps", body, "Pat <pat@acme.com>")).related).toBe(true);
    expect(classify(mk("Next steps", body, "Pat <pat@acme.com>", { bulk: true })).related).toBe(false);
  });
  it("bulk mail whose subject is about your application still counts", () => {
    const body = "Thanks for your interest. Manage your preferences or unsubscribe at any time.";
    const r = classify(mk("Your application was sent to Acme Corp", body, "LinkedIn <jobs-noreply@linkedin.com>"));
    expect([r.related, r.event]).toEqual([true, "applied"]);
  });
  it("hiring-system mail with an unsubscribe footer is still job mail", () => {
    const body = "We'd like to invite you to an interview for the Data Analyst role. Unsubscribe from these emails.";
    const r = classify(mk("Interview invitation", body, "Acme Recruiting <no-reply@greenhouse.io>"));
    expect([r.related, r.event, r.confidence]).toEqual([true, "interview", "high"]);
  });
  it("a real reply from a person is untouched", () => {
    const r = classify(mk("Re: your application", "We would like to schedule an interview next week.", "Pat <pat@acme.com>"));
    expect([r.related, r.event]).toEqual([true, "interview"]);
  });
  it("a medium-confidence stage mention is medium", () => {
    const msg = mk("Next steps", "We would like to schedule an interview with you for the analyst role.", "Pat Lee <pat@acme.com>");
    expect(classify(msg).confidence).toBe("medium");
  });
});

describe("learned rules", () => {
  const msg = mk("Thank you for applying to Acme", "We received your application.", "Acme Careers <jobs@acme.com>");
  it("a blocked sender is ignored", () => {
    const r = classify(mk("Our team update", "News from the team.", "Acme <jobs@acme.com>"), makeLearned({ blockSenders: ["jobs@acme.com"] }));
    expect([r.related, r.reason]).toEqual([false, "learned: ignoring jobs@acme.com"]);
  });
  it("a blocked domain covers subdomains", () => {
    const r = classify(mk("x", "y", "A <a@mail.acme.com>"), makeLearned({ blockDomains: ["acme.com"] }));
    expect(r.reason).toBe("learned: ignoring a@mail.acme.com");
  });
  it("a block never hides a subject that is about an application", () => {
    const r = classify(msg, makeLearned({ blockDomains: ["acme.com"] }));
    expect([r.related, r.event, r.confidence, r.reason]).toEqual([true, "applied", "low", "learned block overridden by the subject: applied"]);
  });
  it("an allowed sender is treated like a hiring system", () => {
    const m = mk("A message", "Hello there.", "Pat <pat@acme.com>");
    expect(classify(m).related).toBe(false);
    const r = classify(m, makeLearned({ allowSenders: ["pat@acme.com"] }));
    expect([r.related, r.event, r.confidence]).toEqual([true, "heard_back", "medium"]);
  });
  it("a distrusted wording drops to low confidence unless the sender is a hiring system", () => {
    const base = classify(msg);
    const learned = makeLearned({ distrust: [base.reason] });
    expect(classify(msg, learned)).toEqual({ ...base, confidence: "low" });
    const ats = mk("Thank you for applying to Acme", "x", "Acme <no-reply@greenhouse.io>");
    expect(classify(ats, makeLearned({ distrust: [classify(ats).reason] }))).toEqual(classify(ats));
  });
});

describe("company and role extraction", () => {
  it.each([
    ["Your application to Data Analyst at Globex", "LinkedIn <jobs-noreply@linkedin.com>", "Globex", "Data Analyst"],
    ["Thank you for applying to Initech", "Initech Careers <no-reply@greenhouse.io>", "Initech", UNKNOWN_ROLE],
    ["Update on your Hooli application", "Hooli <no-reply@hooli.com>", "Hooli", UNKNOWN_ROLE],
  ])("subject: %s", (subject, sender, company, role) => {
    expect(extractCompanyRole(mk(subject, "", sender))).toEqual([company, role]);
  });
  it("role and company from the body", () => {
    const m = mk("Application received", "Thanks for applying for the Backend Engineer position at Umbrella Corp. We will review it.", "Recruiting <no-reply@myworkday.com>");
    expect(extractCompanyRole(m)).toEqual(["Umbrella Corp", "Backend Engineer"]);
  });
  it("drops a trailing 'position'", () => {
    const m = mk("Thank you for applying to Northwind", "We have received your application for the Data Engineer position at Northwind.");
    expect(extractCompanyRole(m)).toEqual(["Northwind", "Data Engineer"]);
  });
  it("falls back to the sender name, then the domain", () => {
    expect(extractCompanyRole(mk("Hello", "", "Stark Industries Recruiting <hr@stark.com>"))[0]).toBe("Stark Industries");
    expect(extractCompanyRole(mk("Hello", "", "<hr@wayne.com>"))[0]).toBe("Wayne");
    expect(extractCompanyRole(mk("Hello", "", "<someone@gmail.com>"))[0]).toBe(UNKNOWN_COMPANY);
  });
});

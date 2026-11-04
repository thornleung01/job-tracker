// Ported from tests/test_roles.py: roles named in real application emails.
import { describe, expect, it } from "vitest";
import { companyKey, extractCompanyRole, roleKey, UNKNOWN_ROLE } from "../../src/pipeline";
import { mk } from "./helpers";

const PAD = "\u{034f} ".repeat(40); // LinkedIn pads its mail with invisible characters

describe("roles in real application emails", () => {
  const cases: [string, string, string, string, string][] = [
    ["Your application has been received!",
      "Hi Jordan, Thanks for your interest in joining Deel! We\u{2019}ve received your application for the Operations Manager | NAM position which is now being reviewed.",
      "Deel HQ Hiring Team <no-reply@deel.com>", "Deel", "Operations Manager | NAM"],
    ["Thank you for your interest in Instacart!",
      "Hi Jordan, Thanks! We have received your application for our  Associate Product Operations Manager   role and are working as fast as we can.",
      "no-reply@instacart.com <no-reply@instacart.com>", "Instacart", "Associate Product Operations Manager"],
    ["[Kick] Thanks for your application",
      "Hey Jordan, Appreciate you taking the time to apply for our position of Customer Experience Lead, Business Owner. Choosing a place to work is a massive decision.",
      "Kick <no-reply@ats.rippling.com>", "Kick", "Customer Experience Lead, Business Owner"],
    ["[Availability Request] DoorDash - Next Steps for Senior Associate, New Verticals - Canada Strategy & Operations  | Jordan Lee",
      "Jocelyn Ford has invited you to attend: DoorDash Zoom Interview",
      "Jocelyn Ford <jocelyn.ford@doordash.com>", "Doordash", "Senior Associate, New Verticals - Canada Strategy & Operations"],
    ["Jordan, your application was sent to Empire Life",
      `Your application was sent to Empire Life ${PAD} Your application was sent to Empire Life Process Improvement Leader (new grad) Empire Life \u{b7} Ontario, Canada (Remote) Applied on October 5, 2026 Now, take these next steps`,
      "LinkedIn <jobs-noreply@linkedin.com>", "Empire Life", "Process Improvement Leader (new grad)"],
    ["Jordan, your application was sent to PointClickCare",
      `Your application was sent to PointClickCare ${PAD} Your application was sent to PointClickCare Process Analyst PointClickCare \u{b7} Greater Montreal Metropolitan Area (Remote) Applied on October 13, 2026 View similar jobs`,
      "LinkedIn <jobs-noreply@linkedin.com>", "PointClickCare", "Process Analyst"],
  ];
  it.each(cases)("%s", (subject, body, sender, company, role) => {
    expect(extractCompanyRole(mk(subject, body, sender))).toEqual([company, role]);
  });
});

it("an email that really has no role stays unknown", () => {
  const body = "Thank you for your application to Clio! Hi Jordan Thank you for your interest in Clio! Your application will be reviewed by our Talent Acquisition Team.";
  expect(extractCompanyRole(mk("Thank you for your Application to Clio!", body, "Clio <clio@myworkday.com>"))[1]).toBe(UNKNOWN_ROLE);
});

it.each([
  "We will be in touch if you are a good match for the next stage of our process.",
  "Thanks for applying, we love people who bring energy to the team and the role of a lifetime.",
])("sentences are not mistaken for roles: %s", (sentence) => {
  expect(extractCompanyRole(mk("Update", sentence, "Acme <no-reply@acme.com>"))[1]).toBe(UNKNOWN_ROLE);
});

it.each([
  ["Appreciate you taking the time to apply for our position of Customer Experience Lead, Business Owner. Choosing a place to work is a massive decision.", "Customer Experience Lead, Business Owner"],
  ["We have received your application for our \nAssociate Product Operations Manager\n \nrole and are working as fast as we can.", "Associate Product Operations Manager"],
])("roles survive odd spaces and line breaks", (body, role) => {
  expect(extractCompanyRole(mk("Thanks for your application", body, "Acme <no-reply@acme.com>"))[1]).toBe(role);
});

describe("keys", () => {
  it("role key matches what the Python test stores", () => expect(roleKey("Operations Manager | NAM")).toBe("operationsmanagernam"));
  it("unknown values have no key", () => {
    expect(roleKey("Unknown role")).toBe("");
    expect(companyKey("Unknown company")).toBe("");
    expect(companyKey("")).toBe("");
  });
  it("company suffixes and accents fold away", () => {
    expect(companyKey("Acme, Inc.")).toBe("acme");
    expect(companyKey("Caf\u{e9} Cr\u{e8}me Ltd")).toBe(companyKey("Cafe Creme"));
    expect(companyKey("Stra\u{df}e GmbH")).toBe("strasse");
  });
});

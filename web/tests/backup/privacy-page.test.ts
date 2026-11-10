// The privacy page states what Recently deleted, the backup file and Draft follow-up do. These checks keep its wording tied
// to the behaviour that the tests next to them pin, so a change to one is noticed by the other.
import { describe, expect, it } from "vitest";

const pages = import.meta.glob<string>("../../public/privacy.html", { query: "?raw", import: "default", eager: true });
const page = (pages["../../public/privacy.html"] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

describe("the privacy page", () => {
  it.each([
    ["mail for a deleted application stays with it", "is kept with it until you restore it or it is erased"],
    ["a new 'application received' email starts a new application", "a new email saying your application was received: that starts a new application"],
    ["unsure mail goes to Needs review", "Mail the app isn't sure about goes to Needs review"],
    ["a future deletion time counts from the next start", "a deletion time in the future"],
    ["the backup file is read on the device to count what it holds", "reads it on your device to count the applications an earlier backup holds"],
    ["an empty backup never replaces a good one", "never replaces a good backup with an empty one"],
    ["a smaller backup is asked about first", "asks you first when the file holds more applications than the new copy"],
    ["the backup is written to a temporary file and swapped in", "only replaces your file once it is complete"],
    ["the follow-up draft names the recipient's first name and your own address", "the recipient's first name in the greeting"],
    ["the follow-up draft is never opened in a disconnected account", "never one you have disconnected"],
    ["a resume, a cover letter and the posting text stay on the device", "your resume and its versions, cover letters, the text of a job posting"],
    ["a job board's description is kept as the posting text on the device", "kept on the application as the job posting text, on your device only"],
    ["the export carries resumes and the CSV leaves their text out", "no email text, no resume text and no job posting text"],
    ["a resume file is read on the device and not uploaded", "the app reads it on your device only. The file isn't uploaded"],
    ["the last resume chosen is a session storage note", "jobtracker:lastResume: followed by the name of your database: the id of the resume you last chose"],
    ["AI is sent only when you press Convert, with your own key", "runs only when you add your own Anthropic key in Settings and press Convert, Tailor or Check key, or paste a job posting on the Resume page"],
    ["Tailor sends the company, role, posting and baseline resume lines only", "Tailor sends one request the same way, from the Tailor page or Write my resume and letter on the Resume page: the company, the role (left out when it is unknown), the job posting text, the lines of the resume you chose as the baseline"],
    ["Tailor lines, posting and note go as written and may hold such details", "Those lines, the posting and your note go as written, so they may contain names, email addresses or other details if you wrote them there"],
    ["Tailor never sends the header, emails, contacts or other applications", "Your resume's contact header, your emails, your contacts and your other applications are never sent"],
    ["Convert refuses text over 12,000 characters before sending", "Convert takes up to 12,000 characters of text and refuses longer text before anything is sent"],
    ["a correction keeps the sender and reason, not the subject", "The email's subject is not kept, and a correction stays after the email and the application it came from are erased"],
    ["ignored mail is erased after about 30 days without depending on syncing", "kept for about 30 days so you can bring it back, and then erased"],
    ["the resume editor layout is a local storage note", "jobtracker:resume-editing"],
    ["the re-read dismissal is a session storage note", "jobtracker:reread-dismissed:"],
    ["the bookmarklet is in Add application", "The bookmarklet in Add application on the Applications page"],
    ["the section is called Data", "open Settings, go to Data and choose Delete all my data"],
    ["the Google token goes in a request body, never the address", "in the body of a request, never in the web address"],
    ["only the shown text is sent to Anthropic", "What is sent is the resume text shown in the panel before you send it, including the contact details in it"],
    ["nothing else is sent to Anthropic", "Nothing else is sent: no emails, no contacts and no other application data"],
    ["Check key sends a test message to the cheapest model, with no resume text", "Check key sends one short test message (\"ping\") with your key, always to the cheapest model (Haiku 5.5), and no resume text"],
    ["nothing is sent until Convert or Check key", "Apart from reading a pasted job, nothing is sent until you press Convert, Tailor or Check key"],
    ["a pasted job is read on the device first", "When you paste a job posting on the Resume page, the app reads the company and role on your device first"],
    ["the extract call sends only the posting, and only when the device couldn't read it", "Only the pasted posting text is sent, with your key, when the company and role couldn't be read on your device and your key is unlocked"],
    ["the extract reply is kept only when it appears in the posting", "A company or role in the reply is kept only if it appears in the posting"],
    ["the unsaved Resume page steps are a session storage note", "jobtracker:resume-steps: followed by the name of your database: the job you are tailoring for on the Resume page"],
    ["a small wrapper goes with the text", "with the instructions for the task and a small wrapper around the text"],
    ["the vault entry is described in full", "the encrypted key, its salt and IV, the last 4 characters of the key and the model you chose, plus a format version"],
    ["another page on the shared address can watch a typed passphrase", "Another page on the same address can also open this app in a window and watch what you type, which a passphrase can't prevent, so only type your passphrase on this address"],
    ["the key is locked with a passphrase and never stored in plain text", "the key and the passphrase are never stored in plain text"],
    ["Delete all my data removes the locked key", "Forget key in Settings and Delete all my data both remove it"],
    ["log out locks the key", "logging out locks it again"],
    ["the vault is a local storage item", "jobtracker:ai:vault: followed by the name of your database"],
    ["the offer counts only what you can see but copies the rest", "The offer counts only the applications you haven't deleted"],
  ])("says that %s", (_what, words) => {
    expect(page).toContain(words);
  });

  it("doesn't promise features that aren't built", () => {
    expect(page).not.toContain("later,");
  });
});

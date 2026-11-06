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
    ["AI is sent only when you press Convert, with your own key", "runs only when you add your own Anthropic key in Settings and press Convert"],
    ["only the shown text is sent to Anthropic", "What is sent is the resume text shown in the panel before you send it, including the contact details in it"],
    ["nothing else is sent to Anthropic", "Nothing else is sent: no emails, no contacts and no other application data"],
    ["Check key sends a test message to the cheapest model, with no resume text", "Check key sends one short test message (\"ping\") with your key, always to the cheapest model (Haiku 5.5), and no resume text"],
    ["nothing is sent until Convert or Check key", "Nothing is sent until you press Convert or Check key"],
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
    expect(page).not.toContain("Tailor");
    expect(page).not.toContain("later,");
  });
});

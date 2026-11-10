// The Documents section on the application detail page: the resume sent, the cover letter and the job posting.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, $$, addApp, addMail, button, cleanup, click, freshDb, mountPage, text, type, waitFor } from "../applications/harness";
import DetailPage from "../../../src/pages/detail";
import { MAX_POSTING_CHARS, MAX_RESUME_VERSIONS } from "../../../src/db/limits";
import { upsertAccount } from "../../../src/db/repo";
import type { JobTrackerDB } from "../../../src/db/schema";
import { createVersion, getCoverLetter, saveCoverLetter, saveMaster } from "../../../src/sync/documents";
import { deleteDocument } from "../../../src/sync/documents";

const clipboard = { writeText: vi.fn(async () => undefined) };
beforeEach(() => {
  clipboard.writeText.mockClear();
  localStorage.removeItem("jobtracker:resume-editing");
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
});
afterEach(cleanup);

const resume = [
  { heading: "Experience", items: [{ text: "Built dashboards" }, { text: "Cut reporting time by 40%" }] },
  { heading: "Skills", items: [{ text: "SQL" }] },
];

async function setup(o: { stage?: "Applied" | "Interview"; master?: boolean; recruiter?: boolean } = {}) {
  const db = freshDb();
  const account = await upsertAccount(db, "gmail", "me@gmail.com");
  const id = await addApp(db, "Acme", { role: "Analyst", stage: o.stage ?? "Applied" });
  if (o.recruiter) {
    await addMail(db, account, id, { sender: "Nadia Khan <nadia@acme.com>", body: "Thanks for applying!\nNadia Khan\nSenior Technical Recruiter\nAcme" });
  }
  const master = o.master === false ? undefined : await saveMaster(db, resume, "paste");
  const page = await mountPage(DetailPage, db, `/app/${id}`, { id: String(id) });
  return { db, id, master, ...page };
}

const select = (c: HTMLElement) => $(c, "select[name=resume]") as HTMLSelectElement;
const section = (c: HTMLElement) => $(c, "section.documents") as HTMLElement;
const sheet = (c: HTMLElement) => $(section(c), ".doc-sheet");
/** The editor opens on the page; the list-editor tests switch to the list first. */
async function openList(c: HTMLElement) {
  await waitFor(() => sheet(c) !== null);
  await click(button(section(c), "Edit as list"));
  await waitFor(() => $(section(c), ".doc-editor") !== null);
}
const editor = (c: HTMLElement) => $(c, ".doc-editor") as HTMLElement;
/** The "Add line" button of the editor section with this heading. */
const addLineIn = (c: HTMLElement, heading: string) => button($(editor(c), `section[aria-label="${heading}"]`) as HTMLElement, "Add line");
const link = (c: HTMLElement, label: string) => $$(section(c), "a").find((a) => text(a) === label) as HTMLAnchorElement | undefined;
const row = async (db: JobTrackerDB, id: number) => (await db.applications.get(id))!;
const notice = (c: HTMLElement) => text($(c, ".notice"));

describe("the Documents section", () => {
  it("sits between People and Notes and steps", async () => {
    const { container } = await setup();
    const heads = $$(container, "h2.section").map((h) => text(h));
    expect(heads.indexOf("Documents")).toBe(heads.indexOf("People") + 1);
    expect(heads.indexOf("Notes and steps")).toBe(heads.indexOf("Documents") + 1);
  });

  describe("resume sent", () => {
    it("links to Add your resume when there is no master, and offers no copy", async () => {
      const { container } = await setup({ master: false });
      expect(link(container, "Add your resume")?.getAttribute("href")).toBe("#/resume");
      expect(button(section(container), "Make a copy for this job")).toBeNull();
      expect($$(select(container), "option").map((o) => text(o))).toEqual(["None"]);
    });

    it("lists the master first, then versions, and saves the choice", async () => {
      const { db, id, container, master } = await setup();
      const version = await createVersion(db, { title: "Analyst v2", sections: resume, basedOn: master });
      await waitFor(() => $$(select(container), "option").length === 3);
      expect($$(select(container), "option").map((o) => text(o))).toEqual(["None", "Master resume", "Analyst v2"]);

      await type(select(container), String(version));
      await waitFor(() => select(container).value === String(version));
      expect((await row(db, id)).resumeId).toBe(version);
      expect(notice(container)).toContain("Saved.");

      await type(select(container), "");
      await waitFor(() => select(container).value === "");
      expect((await row(db, id)).resumeId).toBeUndefined();
    });

    it("makes a copy for this job, chooses it and opens it to edit", async () => {
      const { db, id, container } = await setup();
      await click(button(section(container), "Make a copy for this job"));
      await waitFor(() => sheet(container) !== null);
      expect($(section(container), ".doc-editor")).toBeNull();
      await openList(container);
      const resumeId = (await row(db, id)).resumeId!;
      const copy = (await db.documents.get(resumeId))!;
      expect(copy.title).toBe("Resume for Acme, Analyst");
      expect(copy.master).toBe(false);
      expect(copy.source).toBe("copy");
      expect(select(container).value).toBe(String(resumeId));
      expect($$(editor(container), "textarea").map((t) => (t as HTMLTextAreaElement).value)).toEqual(["Built dashboards", "Cut reporting time by 40%", "SQL"]);
    });

    it("edits a line, adds one, removes one and saves", async () => {
      const { db, id, container } = await setup();
      await click(button(section(container), "Make a copy for this job"));
      await openList(container);
      const resumeId = (await row(db, id)).resumeId!;

      await type($(editor(container), "textarea"), "Built 12 dashboards");
      await click(addLineIn(container, "Skills"));
      const fields = $$(editor(container), "textarea");
      await type(fields[fields.length - 1], "Python");
      await click($$(section(container), "button").find((b) => b.getAttribute("aria-label") === "Remove line 2" && b.closest('section[aria-label="Experience"]') !== null)!);
      await click(button(section(container), "Save"));
      await waitFor(() => sheet(container) === null);

      const saved = (await db.documents.get(resumeId))!;
      expect(saved.sections.map((s) => [s.heading, s.items.map((i) => i.text)])).toEqual([["Experience", ["Built 12 dashboards"]], ["Skills", ["SQL", "Python"]]]);
      expect(notice(container)).toContain("Saved.");
    });

    it("leaves the master alone when only the copy is edited", async () => {
      const { db, container, master } = await setup();
      await click(button(section(container), "Make a copy for this job"));
      await openList(container);
      await type($(editor(container), "textarea"), "Changed");
      await click(button(section(container), "Save"));
      await waitFor(() => sheet(container) === null);
      expect((await db.documents.get(master!))!.sections[0].items[0].text).toBe("Built dashboards");
    });

    it("cancel closes the editor without saving", async () => {
      const { db, id, container, master } = await setup();
      await type(select(container), String(master));
      await waitFor(() => select(container).value === String(master));
      await click(button(section(container), "Edit"));
      await openList(container);
      await type($(editor(container), "textarea"), "Nope");
      await click(button(section(container), "Cancel"));
      expect(sheet(container)).toBeNull();
      expect($(section(container), ".doc-editor")).toBeNull();
      expect((await db.documents.get((await row(db, id)).resumeId!))!.sections[0].items[0].text).toBe("Built dashboards");
    });

    it("Edit shows the on-page editor by default, with Save and Cancel under it", async () => {
      const { container, master } = await setup();
      await type(select(container), String(master));
      await waitFor(() => select(container).value === String(master));
      await click(button(section(container), "Edit"));
      await waitFor(() => sheet(container) !== null);
      expect($(section(container), ".doc-editor")).toBeNull();
      expect($(section(container), '[aria-label="Edit resume"]')).not.toBeNull();
      const wrap = $(section(container), ".doc-resume-edit") as HTMLElement;
      expect(wrap.contains(sheet(container))).toBe(true);
      expect(wrap.lastElementChild!.classList.contains("doc-actions")).toBe(true);
      expect(button(wrap, "Save")).not.toBeNull();
      expect(button(wrap, "Cancel")).not.toBeNull();
    });

    it("keeps the draft when switching to the list and back, and saves only on Save", async () => {
      const { db, id, container } = await setup();
      await click(button(section(container), "Make a copy for this job"));
      await openList(container);
      const resumeId = (await row(db, id)).resumeId!;
      await type($(editor(container), "textarea"), "Edited once");
      await click(button(section(container), "Edit on page"));
      await waitFor(() => sheet(container) !== null);
      await click(button(section(container), "Edit as list"));
      await waitFor(() => $(section(container), ".doc-editor") !== null);
      expect(($(editor(container), "textarea") as HTMLTextAreaElement).value).toBe("Edited once");
      expect((await db.documents.get(resumeId))!.sections[0].items[0].text).toBe("Built dashboards");
      await click(button(section(container), "Save"));
      await waitFor(() => sheet(container) === null);
      expect((await db.documents.get(resumeId))!.sections[0].items[0].text).toBe("Edited once");
    });

    it("links Print to the print view of the chosen resume, and only when one is chosen", async () => {
      const { db, id, container, master } = await setup();
      expect(link(container, "Print")).toBeUndefined();
      await type(select(container), String(master));
      await waitFor(() => link(container, "Print") !== undefined);
      expect(link(container, "Print")!.getAttribute("href")).toBe(`#/resume/print/${master}`);
      expect((await row(db, id)).resumeId).toBe(master);
    });

    it("shows (deleted) when the chosen resume was deleted, and everything else still works", async () => {
      const { db, id, container, master } = await setup();
      const version = await createVersion(db, { title: "Analyst v2", sections: resume, basedOn: master });
      await db.applications.update(id, { resumeId: version });
      await waitFor(() => select(container).value === String(version));
      await deleteDocument(db, version);
      await waitFor(() => text(section(container)).includes("Resume sent: (deleted)"));
      expect(select(container).value).toBe("");
      expect(button(section(container), "Edit")).toBeNull();
      await type(select(container), String(master));
      await waitFor(() => !text(section(container)).includes("(deleted)"));
    });

    it("says why a copy can't be made when the versions are used up", async () => {
      const { db, container, master } = await setup();
      for (let i = 0; i < MAX_RESUME_VERSIONS; i++) await createVersion(db, { title: `V${i}`, sections: resume, basedOn: master });
      await click(button(section(container), "Make a copy for this job"));
      await waitFor(() => notice(container).includes("You can keep 5 resume versions"));
    });

    it("shows what you sent in the header for an interview, and not for other stages", async () => {
      const interview = await setup({ stage: "Interview" });
      await type(select(interview.container), String(interview.master));
      await waitFor(() => text($(interview.container, ".detail-facts")).includes("You sent: Master resume"));
      await cleanup();

      const applied = await setup({ stage: "Applied" });
      await type(select(applied.container), String(applied.master));
      await waitFor(() => select(applied.container).value === String(applied.master));
      expect(text($(applied.container, ".detail-facts"))).not.toContain("You sent");
    });
  });

  describe("cover letter", () => {
    const write = async (c: HTMLElement) => {
      await click(button(section(c), "Write a cover letter"));
      return $(section(c), "textarea.doc-letter-text") as HTMLTextAreaElement;
    };

    it("starts with Dear hiring team when nobody is known", async () => {
      const { container } = await setup();
      expect((await write(container)).value).toBe("Dear hiring team,\n\n");
    });

    it("greets a recruiter by first name", async () => {
      const { container } = await setup({ recruiter: true });
      expect((await write(container)).value).toBe("Dear Nadia,\n\n");
    });

    it("saves the letter, paragraph by paragraph, and then shows it read-only", async () => {
      const { db, id, container } = await setup();
      const box = await write(container);
      await type(box, "Dear hiring team,\n\nI like data.\n\nThank you.");
      await click(button(section(container), "Save"));
      await waitFor(() => $(section(container), ".doc-letter") !== null);
      const cover = (await getCoverLetter(db, id))!;
      expect(cover.sections[0].items.map((i) => i.text)).toEqual(["Dear hiring team,", "I like data.", "Thank you."]);
      expect($$(section(container), ".doc-letter p").map((p) => text(p))).toEqual(["Dear hiring team,", "I like data.", "Thank you."]);
      expect($(section(container), "textarea.doc-letter-text")).toBeNull();
      expect(notice(container)).toContain("Saved.");
    });

    it("says what is wrong when the letter is empty", async () => {
      const { db, id, container } = await setup();
      const box = await write(container);
      await type(box, "   ");
      await click(button(section(container), "Save"));
      await waitFor(() => notice(container).includes("Write something first."));
      expect(await getCoverLetter(db, id)).toBeUndefined();
      expect($(section(container), "textarea.doc-letter-text")).not.toBeNull();
    });

    it("edits a saved letter", async () => {
      const { db, id, container } = await setup();
      await saveCoverLetter(db, id, [{ heading: "", items: [{ text: "Dear team," }, { text: "Old line." }] }]);
      await waitFor(() => button(section(container), "Edit") !== null);
      await click(button(section(container), "Edit"));
      const box = $(section(container), "textarea.doc-letter-text") as HTMLTextAreaElement;
      expect(box.value).toBe("Dear team,\n\nOld line.");
      await type(box, "Dear team,\n\nNew line.");
      await click(button(section(container), "Save"));
      await waitFor(() => text(section(container)).includes("New line."));
      expect((await getCoverLetter(db, id))!.sections[0].items.map((i) => i.text)).toEqual(["Dear team,", "New line."]);
    });

    it("copies the text with a blank line between paragraphs and says so quietly", async () => {
      const { db, id, container } = await setup();
      await saveCoverLetter(db, id, [{ heading: "", items: [{ text: "Dear team," }, { text: "Hello." }] }]);
      await waitFor(() => button(section(container), "Copy text") !== null);
      await click(button(section(container), "Copy text"));
      expect(clipboard.writeText).toHaveBeenCalledWith("Dear team,\n\nHello.");
      await waitFor(() => text($(section(container), ".doc-actions [role=status]")) === "Copied");
    });

    it("says so when the clipboard refuses", async () => {
      clipboard.writeText.mockRejectedValueOnce(new Error("denied"));
      const { db, id, container } = await setup();
      await saveCoverLetter(db, id, [{ heading: "", items: [{ text: "Hi." }] }]);
      await waitFor(() => button(section(container), "Copy text") !== null);
      await click(button(section(container), "Copy text"));
      await waitFor(() => text($(section(container), ".doc-actions [role=status]")).startsWith("Couldn't copy"));
    });

    it("links Print and opens a Gmail draft to the recruiter", async () => {
      const { db, id, container } = await setup({ recruiter: true });
      const letterId = await saveCoverLetter(db, id, [{ heading: "", items: [{ text: "Dear Nadia," }, { text: "Hello." }] }]);
      await waitFor(() => link(container, "Draft in Gmail") !== undefined);
      expect(link(container, "Print")!.getAttribute("href")).toBe(`#/resume/print/${letterId}`);
      const draft = link(container, "Draft in Gmail")!;
      const url = new URL(draft.href);
      expect(url.hostname).toBe("mail.google.com");
      expect(url.searchParams.get("to")).toBe("nadia@acme.com");
      expect(url.searchParams.get("su")).toBe("Application for Analyst");
      expect(url.searchParams.get("body")).toBe("Dear Nadia,\n\nHello.");
      expect(draft.target).toBe("_blank");
      expect(draft.rel).toContain("noopener");
      expect(draft.getAttribute("aria-label")).toBe("Draft in Gmail (opens in a new tab)");
    });

    it("has no draft link without a mailbox", async () => {
      const { db, id, container } = await setup();
      await db.accounts.clear();
      await saveCoverLetter(db, id, [{ heading: "", items: [{ text: "Hi." }] }]);
      await waitFor(() => button(section(container), "Copy text") !== null);
      expect($$(section(container), "a").some((a) => /^Draft/.test(text(a)))).toBe(false);
    });

    it("deletes to Recently deleted after a question, and Write comes back", async () => {
      const { db, id, container } = await setup();
      const letterId = await saveCoverLetter(db, id, [{ heading: "", items: [{ text: "Hi." }] }]);
      await waitFor(() => button(section(container), "Delete") !== null);
      await click(button(section(container), "Delete"));
      expect(text(section(container))).toContain("Delete this cover letter?");
      await click(button(section(container), "Cancel"));
      expect(await getCoverLetter(db, id)).toBeDefined();

      await click(button(section(container), "Delete"));
      await click(button(section(container), "Delete cover letter"));
      await waitFor(() => button(section(container), "Write a cover letter") !== null);
      expect((await db.documents.get(letterId))!.deletedAt).toBeTruthy();
      expect(notice(container)).toContain("Cover letter deleted");
    });
  });

  describe("job posting", () => {
    const posting = (c: HTMLElement) => $(section(c), "details.doc-posting") as HTMLDetailsElement;

    it("is closed, and asks for the text when there is none", async () => {
      const { container } = await setup();
      expect(posting(container).open).toBe(false);
      expect(text($(posting(container), "summary"))).toBe("Job posting");
      expect(text($(posting(container), "label"))).toBe("Paste the job posting");
      expect((button(posting(container), "Save") as HTMLButtonElement).disabled).toBe(true);
    });

    it("saves pasted text, then shows it read-only with Edit", async () => {
      const { db, id, container } = await setup();
      await type($(posting(container), "textarea"), "  We need an analyst.\r\nSQL a plus.  ");
      await click(button(posting(container), "Save"));
      await waitFor(() => $(posting(container), ".doc-posting-text") !== null);
      expect((await row(db, id)).postingText).toBe("We need an analyst.\nSQL a plus.");
      expect(text($(posting(container), ".doc-posting-text"))).toBe("We need an analyst. SQL a plus.");
      expect($(posting(container), "textarea")).toBeNull();
    });

    it("edits and clears a saved posting", async () => {
      const { db, id, container } = await setup();
      await db.applications.update(id, { postingText: "Old text" });
      await waitFor(() => $(posting(container), ".doc-posting-text") !== null);
      await click(button(posting(container), "Edit"));
      expect(($(posting(container), "textarea") as HTMLTextAreaElement).value).toBe("Old text");
      await type($(posting(container), "textarea"), "New text");
      await click(button(posting(container), "Save"));
      await waitFor(() => text($(posting(container), ".doc-posting-text")) === "New text");
      expect((await row(db, id)).postingText).toBe("New text");

      await click(button(posting(container), "Edit"));
      await type($(posting(container), "textarea"), "");
      await click(button(posting(container), "Save"));
      await waitFor(() => $(posting(container), "textarea") !== null && (button(posting(container), "Save") as HTMLButtonElement).disabled);
      expect((await row(db, id)).postingText).toBeUndefined();
      expect(notice(container)).toContain("Job posting removed.");
    });

    it("shows the character count only near the limit", async () => {
      const { container } = await setup();
      await type($(posting(container), "textarea"), "short");
      expect($(posting(container), ".doc-note")).toBeNull();
      await type($(posting(container), "textarea"), "x".repeat(Math.ceil(MAX_POSTING_CHARS * 0.95)));
      expect(text($(posting(container), ".doc-note"))).toMatch(/^19,000 of 20,000 characters$/);
      expect(($(posting(container), "textarea") as HTMLTextAreaElement).maxLength).toBe(MAX_POSTING_CHARS);
    });
  });
});

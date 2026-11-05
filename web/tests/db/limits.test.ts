// Saving, importing and filling the form from a link all cut text at the lengths in db/limits.ts.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { GUESS_COMPANY_CHARS, GUESS_LOCATION_CHARS, GUESS_ROLE_CHARS, MAX_COMPANY_CHARS, MAX_LOCATION_CHARS, MAX_NAME_CHARS, MAX_ROLE_CHARS, MAX_TITLE_CHARS } from "../../src/db/limits";
import { draftFromHash } from "../../src/jobs/bookmarklet";
import { safeUrl } from "../../src/jobs/bookmarklet/draft";
import { exportAll, importAll } from "../../src/portability";
import { addApplication, editApplication } from "../../src/sync/actions";
import { saveEdit } from "../../src/sync/contacts";
import { findDuplicates } from "../../src/sync/duplicates";
import { closeAll, freshDb } from "../sync/helpers";

afterEach(closeAll);

describe("one length for a company and a role", () => {
  it("is the same on adding, editing and importing", async () => {
    const db = freshDb();
    const id = await addApplication(db, { company: "C".repeat(150), role: "R".repeat(250) });
    const added = (await db.applications.get(id))!;
    expect([added.company.length, added.role.length]).toEqual([MAX_COMPANY_CHARS, MAX_ROLE_CHARS]);
    await editApplication(db, id, "D".repeat(150), "S".repeat(250));
    const edited = (await db.applications.get(id))!;
    expect([edited.company.length, edited.role.length]).toEqual([MAX_COMPANY_CHARS, MAX_ROLE_CHARS]);

    const file = JSON.parse(JSON.stringify(await exportAll(db)));
    file.data.applications[0].company = "E".repeat(150);
    file.data.applications[0].role = "T".repeat(250);
    const other = freshDb();
    await importAll(other, file);
    const imported = (await other.applications.toArray())[0];
    expect([imported.company.length, imported.role.length]).toEqual([MAX_COMPANY_CHARS, MAX_ROLE_CHARS]);
  });

  it("is what the duplicate check compares, so a long name still finds itself", async () => {
    const db = freshDb();
    const company = "C".repeat(150);
    await addApplication(db, { company, role: "Analyst" });
    expect(await findDuplicates(db, company, "Analyst")).toHaveLength(1);
  });

  it("is the same for a person's name and title", async () => {
    const db = freshDb();
    await saveEdit(db, "1|a@b.co", "N".repeat(150), "T".repeat(250));
    const [edit] = await db.contactEdits.toArray();
    expect([edit.name!.length, edit.title!.length]).toEqual([MAX_NAME_CHARS, MAX_TITLE_CHARS]);
  });
});

describe("a guess from a link", () => {
  it("is never longer than what can be saved, so it saves as it is", () => {
    expect(GUESS_COMPANY_CHARS).toBeLessThanOrEqual(MAX_COMPANY_CHARS);
    expect(GUESS_ROLE_CHARS).toBeLessThanOrEqual(MAX_ROLE_CHARS);
    expect(GUESS_LOCATION_CHARS).toBeLessThanOrEqual(MAX_LOCATION_CHARS);
  });

  it("is cut at those lengths when it arrives in a bookmarklet link", () => {
    const query = new URLSearchParams({ add: "1", c: "C".repeat(300), r: "R".repeat(300), l: "L".repeat(300) });
    const draft = draftFromHash(query)!;
    expect([draft.company.length, draft.role.length, draft.location.length]).toEqual([GUESS_COMPANY_CHARS, GUESS_ROLE_CHARS, GUESS_LOCATION_CHARS]);
  });

  it("gets its web address checked by the rule saving uses", () => {
    expect(safeUrl("https://example.com/job/1#apply")).toBe("https://example.com/job/1"); // a saved link has no fragment
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("https://u:p@example.com/")).toBe("");
    const long = "https://example.com/job?" + "q=1&".repeat(200);
    expect(safeUrl(long)).toBe("https://example.com/job"); // too long: the query string goes first, as before
  });
});

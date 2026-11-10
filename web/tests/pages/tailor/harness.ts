// Shared set-up for the Tailor page tests: a database with a master resume and one application, a fake key vault and a fake model.
import "fake-indexeddb/auto";
import { createElement } from "react";
import { vi } from "vitest";
import type { PageProps } from "../../../src/app/pageProps";
import { DEFAULT_MODEL, type AiDeps, type AiRequest, type Vault, type VaultStatus } from "../../../src/ai";
import type { JobTrackerDB } from "../../../src/db/schema";
import { ActionError } from "../../../src/db/errors";
import type { DocumentsDeps } from "../../../src/components/documents/deps";
import type { JobDraft } from "../../../src/jobs/types";
import TailorPage from "../../../src/pages/tailor";
import { createVersion, saveMaster, setPostingText } from "../../../src/sync/documents";
import { MASTER, goodReply } from "../../ai/tailorFixture";
import { $, $$, addApp, button, freshDb, mountPage, text } from "../applications/harness";

export const POSTING = "Acme needs a data analyst who knows Snowflake and Tableau and can report weekly.";

export type Saved = "none" | "locked" | "unlocked";

/** A vault whose key is `saved`; `unlock` accepts only "right" and then the key is unlocked. */
export function fakeAi(saved: Saved = "unlocked", replies: unknown[] = [goodReply()]) {
  let state: Saved = saved;
  const status = (): VaultStatus => (state === "none" ? { state: "none" } : { state, last4: "test", model: DEFAULT_MODEL } as VaultStatus);
  const unlock = vi.fn(async (_db: string, pass: string) => {
    if (pass !== "right") throw new ActionError("That passphrase did not open the key.");
    state = "unlocked";
  });
  const vault = { status, key: () => (state === "unlocked" ? "sk-ant-test" : null), save: vi.fn(), unlock, lock: vi.fn(), setModel: vi.fn(), forget: vi.fn() } as unknown as Vault;
  const queue = [...replies];
  const complete = vi.fn(async (_k: string, _r: AiRequest, _o?: { signal?: AbortSignal }) => ({ json: queue.length > 1 ? queue.shift() : queue[0], model: "m" }));
  const ai: AiDeps = { vault, complete };
  return { ai, complete, unlock };
}

export interface SetupOptions {
  saved?: Saved;
  replies?: unknown[];
  posting?: string | null;
  master?: boolean;
  postingUrl?: string;
  enrich?: DocumentsDeps["enrichJobDraft"];
  /** titles of resume versions to make first (copies of the master) */
  versions?: string[];
  /** open with ?baseline= set to this version (an index into `versions`) */
  baselineIndex?: number;
  /** runs after the data is made and before the page mounts (a saved copy or letter, a deleted version) */
  prepare?(ctx: { db: JobTrackerDB; id: number; master: number | undefined; versions: number[] }): Promise<void>;
}

export async function setup(o: SetupOptions = {}) {
  const db = freshDb();
  const id = await addApp(db, "Acme", { role: "Data Analyst" });
  if (o.postingUrl) await db.applications.update(id, { postingUrl: o.postingUrl });
  const master = o.master === false ? undefined : await saveMaster(db, MASTER, "paste");
  if (o.posting !== null) await setPostingText(db, id, o.posting ?? POSTING);
  const versions: number[] = [];
  for (const title of o.versions ?? []) versions.push(await createVersion(db, { title, sections: MASTER }));
  await o.prepare?.({ db, id, master, versions });
  const fake = fakeAi(o.saved, o.replies);
  const enrichJobDraft = o.enrich ?? vi.fn(async (d: JobDraft) => d);
  const deps: Partial<DocumentsDeps> = { ai: fake.ai, enrichJobDraft };
  const Page = (props: PageProps) => createElement(TailorPage, { ...props, deps });
  const page = await mountPage(Page, db, `/tailor/${id}${o.baselineIndex !== undefined ? `?baseline=${versions[o.baselineIndex]}` : ""}`, { id: String(id) });
  return { db, id, master, versions, fake, deps, enrichJobDraft, ...page };
}

export const textFields = (c: ParentNode) => $$(c, ".page-editor textarea, .page-editor input") as (HTMLInputElement | HTMLTextAreaElement)[];
export const field = (c: ParentNode, label: string) => $(c, `.page-editor [aria-label="${label}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
export { button, text, $, $$ };

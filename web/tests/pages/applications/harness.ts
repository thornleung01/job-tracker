// Mounts a page the way the router would, over a fresh fake-indexeddb database. Shared by the page tests in this folder tree.
import "fake-indexeddb/auto";
import { act, createElement, useState, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PageProps } from "../../../src/app/pageProps";
import type { AuthUser } from "../../../src/auth/user";
import { createApplication, upsertAccount } from "../../../src/db/repo";
import type { JobTrackerDB } from "../../../src/db/schema";
import { iso } from "../../../src/db/time";
import { openDatabase } from "../../../src/db/schema";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const user: AuthUser = { iss: "https://accounts.google.com", sub: "1", provider: "google", email: "me@example.com" };
const opened: JobTrackerDB[] = [];
const roots: { root: Root; container: HTMLElement }[] = [];
let counter = 0;

export function freshDb(): JobTrackerDB {
  const db = openDatabase(`page-${Date.now()}-${counter++}`);
  opened.push(db);
  return db;
}

export async function cleanup(): Promise<void> {
  for (const { root, container } of roots.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  while (opened.length) opened.pop()!.close();
  document.body.innerHTML = "";
}

export const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);

export interface Mounted {
  container: HTMLElement;
  /** every address the page asked to go to, in order */
  visited: string[];
  /** the address the page is at now: path and query */
  location(): string;
}

function parse(to: string): { path: string; query: URLSearchParams } {
  const [path, qs = ""] = to.split("?");
  return { path, query: new URLSearchParams(qs) };
}

/** Renders `Page` at `to` (like "/?stage=Applied"). `navigate` is recorded and re-renders the page with the new query. */
export async function mountPage(Page: ComponentType<PageProps>, db: JobTrackerDB, to = "/", params: Record<string, string> = {}): Promise<Mounted> {
  const visited: string[] = [];
  let current = to;
  const Host = () => {
    const [loc, setLoc] = useState(() => parse(to));
    const navigate = (next: string) => {
      visited.push(next);
      current = next;
      setLoc(parse(next));
    };
    return createElement(Page, { db, user, params, query: loc.query, navigate });
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push({ root, container });
  await act(async () => root.render(createElement(Host)));
  await settle();
  await settle();
  return { container, visited, location: () => current };
}

/** Lets liveQuery and pending promises finish. */
export async function settle(ms = 40): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

export async function waitFor(check: () => boolean, what = "the page to change"): Promise<void> {
  for (let i = 0; i < 80; i++) {
    if (check()) return;
    await settle(25);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

export async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error("Nothing to click");
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}

/** Types into a field the way a person does, so React sees the change. */
export async function type(el: Element | null, value: string): Promise<void> {
  if (!el) throw new Error("No field to type in");
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

/** Submits a form without the browser's own checks, so the page's own error handling can be seen. */
export async function submitForm(form: Element | null): Promise<void> {
  if (!form) throw new Error("No form to submit");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

export async function key(el: Element | null, name: string): Promise<void> {
  if (!el) throw new Error("No element to press a key in");
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  });
}

export const $ = (root: ParentNode, selector: string) => root.querySelector(selector);
export const $$ = (root: ParentNode, selector: string) => [...root.querySelectorAll(selector)];
export const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
export const button = (root: ParentNode, label: string) => $$(root, "button").find((b) => text(b) === label) ?? null;

// -- seed data ----------------------------------------------------------------------------------------------------

export async function addApp(db: JobTrackerDB, company: string, o: { role?: string; stage?: "Applied" | "Interview" | "Rejected" | "Heard back" | "Offer" | "Assessment"; applied?: number | null; last?: number; locked?: boolean } = {}): Promise<number> {
  const role = o.role ?? "Analyst";
  const id = await createApplication(db, { company, companyKey: company.toLowerCase(), role, roleKey: role.toLowerCase(), stage: o.stage ?? "Applied", when: iso(daysAgo(o.applied ?? 10)) });
  await db.applications.update(id, { lastActivity: iso(daysAgo(o.last ?? 5)), appliedAt: o.applied === null ? null : iso(daysAgo(o.applied ?? 10)), locked: o.locked ?? false });
  return id;
}

let mailN = 0;
export async function addMail(db: JobTrackerDB, accountId: number, appId: number | null, o: {
  sender?: string; subject?: string; body?: string; when?: Date; review?: boolean; event?: "applied" | "interview" | null; threadId?: string | null;
} = {}): Promise<number> {
  return db.emails.add({
    accountId, providerMsgId: `m${mailN++}`, threadId: o.threadId === undefined ? "thread-1" : o.threadId, receivedAt: iso(o.when ?? daysAgo(1)),
    sender: o.sender ?? "Acme Careers <careers@acme.com>", subject: o.subject ?? "We got your application", body: o.body ?? "Thanks for applying.",
    related: true, event: o.event === undefined ? "applied" : o.event, confidence: "high", applicationId: appId, needsReview: o.review ?? false,
    webLink: null, bulk: false, hold: false, reason: null,
  });
}

/** Zeta (Interview, 3 emails, active yesterday), alpha (Rejected, 9 days), Mid (Applied, applied date unknown, 2 emails). */
export async function seedThree(db: JobTrackerDB): Promise<{ account: number; zeta: number; alpha: number; mid: number }> {
  const account = await upsertAccount(db, "gmail", "me@gmail.com");
  const zeta = await addApp(db, "Zeta", { role: "Backend", stage: "Interview", applied: 30, last: 1 });
  const alpha = await addApp(db, "alpha", { role: "Data", stage: "Rejected", applied: 20, last: 9 });
  const mid = await addApp(db, "Mid", { role: "Analyst", stage: "Applied", applied: null, last: 5 });
  for (let i = 0; i < 3; i++) await addMail(db, account, zeta, { subject: `Zeta mail ${i}` });
  await addMail(db, account, alpha);
  for (let i = 0; i < 2; i++) await addMail(db, account, mid, { subject: `Mid mail ${i}` });
  return { account, zeta, alpha, mid };
}

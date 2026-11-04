import "fake-indexeddb/auto";
import { vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "../../src/auth/session";
import type { AuthUser } from "../../src/auth/user";
import type { ShellAuth } from "../../src/app/authApi";
import { openDatabase, type JobTrackerDB } from "../../src/db/schema";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const ada: AuthUser = { iss: "https://accounts.google.com", sub: "111", provider: "google", email: "ada@example.com", name: "Ada Lovelace" };
export const grace: AuthUser = { iss: "https://accounts.google.com", sub: "222", provider: "google", email: "grace@example.com" };

const mounted: { unmount(): void; container: HTMLElement }[] = [];

export async function render(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
    await sleep(0);
  });
  const handle = {
    container,
    rerender: (el: ReactElement) => act(async () => root.render(el)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
  mounted.push(handle);
  return handle;
}

export function cleanupRendered(): void {
  while (mounted.length) mounted.pop()!.unmount();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function settle(ms = 20): Promise<void> {
  await act(async () => {
    await sleep(ms);
  });
}

export async function waitFor<T>(fn: () => T, timeout = 3000): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  let last: unknown;
  for (;;) {
    try {
      const v = fn();
      if (v) return v as NonNullable<T>;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw last ?? new Error("waitFor timed out");
    await settle(10);
  }
}

export async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
    await sleep(25);
  });
}

export const q = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
export const byText = (text: string, sel = "button, a, label", root: ParentNode = document) =>
  Array.from(root.querySelectorAll<HTMLElement>(sel)).find((e) => (e.textContent ?? "").trim() === text) ?? null;

const SIGNED_OUT: Session = { status: "signed-out", user: null, mail: { gmail: false, outlook: false }, error: null, lastProvider: null };

/** A controllable stand-in for the auth module. */
export function fakeAuth(initial: Partial<Session> = {}) {
  let session: Session = { ...SIGNED_OUT, ...initial };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<Session>) =>
    act(async () => {
      session = { ...session, ...patch };
      [...listeners].forEach((l) => l());
      await sleep(0);
    });
  const auth = {
    getSession: () => session,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    signIn: vi.fn(async (p: "google" | "microsoft"): Promise<AuthUser> => {
      await set({ status: "signed-in", user: ada });
      return { ...ada, provider: p };
    }),
    renderGoogleButton: vi.fn(async (el: HTMLElement) => {
      const b = document.createElement("div");
      b.className = "fake-google";
      b.textContent = "Google's button";
      el.appendChild(b);
    }),
    signOut: vi.fn(async () => { await set({ ...SIGNED_OUT }); }),
  } satisfies ShellAuth;
  return { auth, set };
}

let counter = 0;
const opened: JobTrackerDB[] = [];
export const openTestDb = (name: string) => {
  const db = openDatabase(`app-test-${Date.now()}-${counter++}-${name}`);
  opened.push(db);
  return db;
};
export const freshDb = () => openTestDb("fresh");
export function closeDbs(): void {
  while (opened.length) opened.pop()!.close();
}

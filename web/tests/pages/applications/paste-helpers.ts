// What the paste-a-link and bookmarklet-arrival tests share: a page whose job-link library is replaced by fakes.
import { act, createElement } from "react";
import { vi, type Mock } from "vitest";
import { $, button, click, text, type } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";
import { EMPTY_DRAFT, type JobDraft } from "../../../src/jobs/types";
import type { PageProps } from "../../../src/app/pageProps";
import type { JobLinkDeps } from "../../../src/components/joblink/deps";

export const draft = (o: Omit<Partial<JobDraft>, "guessed"> & { guessed?: Partial<JobDraft["guessed"]> } = {}): JobDraft => ({
  ...EMPTY_DRAFT, ...o, guessed: { company: false, role: false, ...o.guessed },
});
export const GUESS = draft({ company: "Stripe", role: "Software Engineer", url: "https://jobs.example.com/p/1", guessed: { company: true, role: true } });

/** The page with the job-link library replaced by fakes. Every fake can be overridden per test. */
interface Fakes {
  parseJobUrl: Mock<JobLinkDeps["parseJobUrl"]>;
  enrichJobDraft: Mock<JobLinkDeps["enrichJobDraft"]>;
  parsePastedText: Mock<JobLinkDeps["parsePastedText"]>;
  draftFromHash: Mock<JobLinkDeps["draftFromHash"]>;
}
export function withFakes(over: Partial<Fakes> = {}) {
  const deps: Fakes = {
    parseJobUrl: vi.fn((_raw: string): JobDraft | null => GUESS),
    enrichJobDraft: vi.fn(async (d: JobDraft) => d),
    parsePastedText: vi.fn((_t: string, _u?: string): JobDraft | null => null),
    draftFromHash: vi.fn((_q: URLSearchParams): JobDraft | null => null),
    ...over,
  };
  const Page = (props: PageProps) => createElement(ApplicationsPage, { ...props, deps });
  return { deps, Page };
}

export const field = (c: HTMLElement, id: string) => $(c, `#${id}`) as HTMLInputElement;
export const result = (c: HTMLElement) => text($(c, "#add-link-result"));
export const paste = async (c: HTMLElement, value: string) => {
  const input = field(c, "add-link");
  await act(async () => {
    input.dispatchEvent(new Event("paste", { bubbles: true }));
  });
  await type(input, value);
};
export const openForm = async (c: HTMLElement) => click(button(c, "Add application"));
export const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

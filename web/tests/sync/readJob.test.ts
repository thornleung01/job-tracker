// readJob: the device reads the paste first; the AI extract runs only when it found neither company nor role and the key is unlocked,
// fills blanks only, and keeps nothing the posting doesn't contain.
import { describe, expect, it, vi } from "vitest";
import { AiError, DEFAULT_MODEL, type AiDeps, type AiRequest, type Vault, type VaultStatus } from "../../src/ai";
import { readJob } from "../../src/sync/readJob";

const UNREADABLE = "we're looking for someone to help us grow at Gringotts Wizarding Bank. you'll own vault reporting as our product analyst.";
const READABLE = "Product Analyst at Gringotts\nLondon, United Kingdom\nYou will own vault reporting.";

function deps(reply: unknown, status: VaultStatus = { state: "unlocked", last4: "test", model: "claude-haiku-5-5" }) {
  const key = status.state === "unlocked" ? "sk-ant-test" : null;
  const vault = { status: vi.fn(() => status), key: vi.fn(() => key), save: vi.fn(), unlock: vi.fn(), lock: vi.fn(), setModel: vi.fn(), forget: vi.fn() } as unknown as Vault;
  const complete = vi.fn(async (_k: string, _r: AiRequest, _o?: { signal?: AbortSignal }) => ({ json: reply, model: "m" }));
  return { ai: { vault, complete } satisfies AiDeps, complete, db: "jt-test", vault };
}

describe("readJob", () => {
  it("uses what the device read and makes no call when it found a company or a role", async () => {
    const d = deps({ company: "Other", role: "Other" });
    expect(await readJob(READABLE, undefined, d)).toMatchObject({ company: "Gringotts", role: "Product Analyst", fromAi: false });
    expect(await readJob("Acme Labs is hiring\nWe build things.", undefined, d)).toMatchObject({ company: "Acme Labs", role: "", fromAi: false });
    expect(d.complete).not.toHaveBeenCalled();
  });

  it("asks AI once when both are empty and the key is unlocked, sending only the posting with the key's model", async () => {
    const d = deps({ company: "Gringotts Wizarding Bank", role: "product analyst" });
    const signal = new AbortController().signal;
    const job = await readJob(UNREADABLE, "https://www.linkedin.com/jobs/view/4012345678/?trk=public_jobs", d, signal);
    expect(job).toEqual({
      company: "Gringotts Wizarding Bank", role: "product analyst", url: "https://www.linkedin.com/jobs/view/4012345678", description: UNREADABLE, fromAi: true,
    });
    expect(d.complete).toHaveBeenCalledOnce();
    const [key, request, options] = d.complete.mock.calls[0];
    expect(key).toBe("sk-ant-test");
    expect(request.model).toBe("claude-haiku-5-5");
    expect(JSON.parse(request.user)).toEqual({ task: "extractJob", posting: UNREADABLE });
    expect(options?.signal).toBe(signal);
    expect(d.vault.key).toHaveBeenCalledWith("jt-test");
  });

  it("never invents a value: one the posting doesn't contain comes back empty", async () => {
    const d = deps({ company: "Evil Corp", role: "product analyst" });
    expect(await readJob(UNREADABLE, undefined, d)).toMatchObject({ company: "", role: "product analyst", fromAi: true });
    const none = deps({ company: "Evil Corp", role: "Chief Wizard" });
    expect(await readJob(UNREADABLE, undefined, none)).toMatchObject({ company: "", role: "", fromAi: false });
  });

  it("makes no call with no deps, no AI, no key, a locked key, or no posting text", async () => {
    expect(await readJob(UNREADABLE, undefined, null)).toMatchObject({ company: "", role: "", fromAi: false });
    expect(await readJob(UNREADABLE, undefined, { db: "jt-test" })).toMatchObject({ fromAi: false });
    const none = deps({ company: "Gringotts" }, { state: "none" });
    const locked = deps({ company: "Gringotts" }, { state: "locked", last4: "abcd", model: DEFAULT_MODEL });
    const blank = deps({ company: "Gringotts" });
    for (const d of [none, locked]) expect(await readJob(UNREADABLE, undefined, d)).toMatchObject({ company: "", fromAi: false });
    expect(await readJob("  ", undefined, blank)).toMatchObject({ description: "", fromAi: false });
    for (const d of [none, locked, blank]) expect(d.complete).not.toHaveBeenCalled();
  });

  it("uses an injected complete instead of the vault's", async () => {
    const d = deps({ ignored: true });
    const own = vi.fn(async () => ({ json: { company: "Gringotts Wizarding Bank", role: "" }, model: "m" }));
    expect(await readJob(UNREADABLE, undefined, { ...d, complete: own })).toMatchObject({ company: "Gringotts Wizarding Bank", fromAi: true });
    expect(own).toHaveBeenCalledOnce();
    expect(d.complete).not.toHaveBeenCalled();
  });

  it("leaves the fields empty when the call fails, and passes an abort through", async () => {
    const failing = deps(null);
    failing.complete.mockRejectedValueOnce(new AiError("rateLimited"));
    expect(await readJob(UNREADABLE, undefined, failing)).toMatchObject({ company: "", role: "", description: UNREADABLE, fromAi: false });
    expect(await readJob(UNREADABLE, undefined, deps("not an object"))).toMatchObject({ company: "", fromAi: false });

    const abort = new DOMException("aborted", "AbortError");
    const aborted = deps(null);
    aborted.complete.mockRejectedValueOnce(abort);
    await expect(readJob(UNREADABLE, undefined, aborted)).rejects.toBe(abort);
  });
});

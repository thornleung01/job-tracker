import { describe, expect, it, vi } from "vitest";
import { ProviderHttpError } from "../../src/providers/backoff";
import { createGraphProvider, getGraphAddress, parseGraphMessage, SKIP_FOLDERS } from "../../src/providers/graph";
import { NotConnected } from "../../src/types";
import { collect, fakeSleep, json, scriptedFetch, token } from "./helpers";

const msg = (id: string, folder = "inbox", extra: object = {}) => ({
  id,
  conversationId: `c-${id}`,
  subject: `Subject ${id}`,
  from: { emailAddress: { name: "Sam", address: "sam@acme.com" } },
  receivedDateTime: "2026-10-05T14:30:00Z",
  body: { contentType: "text", content: `body ${id}` },
  parentFolderId: folder,
  webLink: `https://outlook.office.com/mail/${id}`,
  ...extra,
});

const FOLDERS: Record<string, string> = { junkemail: "F-junk", sentitems: "F-sent", drafts: "F-drafts", deleteditems: "F-deleted" };

/** A fake Graph: folder lookups, then message pages linked by @odata.nextLink. */
function graph(pages: object[][], opts: { missingFolders?: string[]; folderStatus?: Record<string, number> } = {}) {
  return scriptedFetch(({ url }) => {
    if (url.pathname.includes("/me/mailFolders/")) {
      const name = url.pathname.split("/").pop()!;
      if (opts.folderStatus?.[name]) return json({ error: { code: "x" } }, opts.folderStatus[name]);
      return opts.missingFolders?.includes(name) ? json({}, 404) : json({ id: FOLDERS[name] });
    }
    if (url.pathname.endsWith("/me/messages")) {
      const page = Number(url.searchParams.get("page") ?? 0);
      const next = page + 1 < pages.length ? `https://graph.microsoft.com/v1.0/me/messages?page=${page + 1}` : undefined;
      return json({ value: pages[page], "@odata.nextLink": next });
    }
    return json({}, 404);
  });
}
const since = new Date("2026-09-01T00:00:00Z");

describe("parseGraphMessage", () => {
  it("turns an HTML body into text and normalises the time to UTC", () => {
    const m = parseGraphMessage({
      id: "o1",
      conversationId: "c1",
      subject: "Interview invitation",
      from: { emailAddress: { name: "Sam", address: "sam@acme.com" } },
      receivedDateTime: "2026-10-05T14:30:00Z",
      body: { contentType: "html", content: "<div>Please <b>pick</b> a time</div>" },
    });
    expect([m.threadId, m.senderEmail, m.senderName, m.subject]).toEqual(["c1", "sam@acme.com", "Sam", "Interview invitation"]);
    expect(m.receivedAt).toBe("2026-10-05T14:30:00.000Z");
    expect(m.body).toContain("pick");
    expect(m.body).not.toContain("<");
    expect("html" in m).toBe(false); // nothing reads the HTML, so a mailbox of it is not kept in memory
    expect(m.webLink).toBeNull();
  });

  it("keeps a plain-text body as is", () => {
    const m = parseGraphMessage(msg("t") as never);
    expect(m.body).toBe("body t");
    expect(m.webLink).toBe("https://outlook.office.com/mail/t");
  });

  it("drops an \"open in Outlook\" link that doesn't lead to Microsoft's own web mail", () => {
    expect(parseGraphMessage(msg("e", "inbox", { webLink: "https://evil.example/owa" }) as never).webLink).toBeNull();
    expect(parseGraphMessage(msg("j", "inbox", { webLink: "javascript:alert(1)" }) as never).webLink).toBeNull();
  });

  it("decodes non-ASCII HTML entities and text", () => {
    const m = parseGraphMessage(msg("n", "inbox", { body: { contentType: "html", content: "<p>Caf&eacute; &mdash; 面接</p>" } }) as never);
    expect(m.body).toBe("Café — 面接");
  });

  it("falls back to the id for thread, and tolerates missing sender and subject", () => {
    const m = parseGraphMessage({ id: "x", receivedDateTime: "2026-10-05T14:30:00+02:00", from: null, subject: null });
    expect([m.threadId, m.senderEmail, m.subject, m.body]).toEqual(["x", "", "", ""]);
    expect(m.receivedAt).toBe("2026-10-05T12:30:00.000Z");
  });

  it("flags bulk from internet message headers", () => {
    const bulk = (headers: { name: string; value: string }[]) => parseGraphMessage(msg("h", "inbox", { internetMessageHeaders: headers }) as never).bulk;
    expect(bulk([{ name: "List-Unsubscribe", value: "<mailto:x@y>" }])).toBe(true);
    expect(bulk([{ name: "list-id", value: "<l>" }])).toBe(true);
    expect(bulk([{ name: "Precedence", value: "bulk" }])).toBe(true);
    expect(bulk([{ name: "X-Other", value: "1" }])).toBe(false);
    expect(parseGraphMessage(msg("h") as never).bulk).toBe(false);
  });
});

describe("graph provider fetch", () => {
  it("looks up the skip folders, then asks for messages since the date, newest first", async () => {
    const g = graph([[msg("a")]]);
    await collect(createGraphProvider(token, { fetch: g.fetch }).fetch(since, () => false));
    expect(g.calls.slice(0, 4).map((c) => c.url.pathname.split("/").pop())).toEqual(["junkemail", "sentitems", "drafts", "deleteditems"]);
    const list = g.calls[4].url;
    expect(decodeURIComponent(list.search)).toContain("$filter=receivedDateTime ge 2026-09-01T00:00:00Z");
    expect(decodeURIComponent(list.search)).toContain("$orderby=receivedDateTime desc");
    expect(list.searchParams.get("$top")).toBe("50");
    expect(g.calls[4].headers.get("authorization")).toBe("Bearer tok");
    expect(g.calls[4].headers.get("prefer")).toBe('IdType="ImmutableId"');
  });

  it("follows @odata.nextLink across pages", async () => {
    const g = graph([[msg("a"), msg("b")], [msg("c")]]);
    const got = await collect(createGraphProvider(token, { fetch: g.fetch }).fetch(since, () => false));
    expect(got.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("drops mail in Junk, Sent, Drafts and Deleted, and honours skip()", async () => {
    const g = graph([[msg("keep"), msg("junk", "F-junk"), msg("sent", "F-sent"), msg("draft", "F-drafts"), msg("del", "F-deleted"), msg("stored")]]);
    const got = await collect(createGraphProvider(token, { fetch: g.fetch }).fetch(since, (id) => id === "stored"));
    expect(got.map((m) => m.id)).toEqual(["keep"]);
  });

  it("carries on when the account has no such folder (404)", async () => {
    const g = graph([[msg("a"), msg("sent", "F-sent")]], { missingFolders: ["junkemail", "drafts"] });
    const got = await collect(createGraphProvider(token, { fetch: g.fetch }).fetch(since, () => false));
    expect(got.map((m) => m.id)).toEqual(["a"]);
  });

  it.each([403, 429, 503])("fails the sync when a folder lookup answers %s, instead of reading Junk and Sent as job mail", async (status) => {
    const g = graph([[msg("a"), msg("junk", "F-junk")]], { folderStatus: { junkemail: status } });
    const { sleep } = fakeSleep();
    const err = await collect(createGraphProvider(token, { fetch: g.fetch, sleep }).fetch(since, () => false)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect((err as ProviderHttpError).status).toBe(status);
    expect(g.calls.some((c) => c.url.pathname.endsWith("/me/messages"))).toBe(false); // no mail was read at all
  });

  it("fails when a later folder lookup fails too, not only the first", async () => {
    const g = graph([[msg("a")]], { folderStatus: { [SKIP_FOLDERS[3]]: 403 } });
    await expect(collect(createGraphProvider(token, { fetch: g.fetch }).fetch(since, () => false))).rejects.toMatchObject({ status: 403 });
  });

  it("hands out messages page by page: the first one arrives before the next page is requested", async () => {
    const g = graph([[msg("a"), msg("b")], [msg("c"), msg("d")], [msg("e")]]);
    const gen = createGraphProvider(token, { fetch: g.fetch }).fetch(since, () => false);
    const pageRequests = () => g.calls.filter((c) => c.url.pathname.endsWith("/me/messages")).length;
    expect((await gen.next()).value).toMatchObject({ id: "a" });
    expect(pageRequests()).toBe(1);
    await gen.next();
    expect(pageRequests()).toBe(1);
    expect((await gen.next()).value).toMatchObject({ id: "c" });
    expect(pageRequests()).toBe(2);
    await gen.return(undefined);
    expect(pageRequests()).toBe(2); // the rest of the mailbox was never fetched
  });

  it("orders newest first by default and oldest first on request, and asks for the body as it is (no Prefer: text)", async () => {
    const g = graph([[msg("a")]]);
    await collect(createGraphProvider(token, { fetch: g.fetch }).fetch(since, () => false));
    await collect(createGraphProvider(token, { fetch: g.fetch, oldestFirst: true }).fetch(since, () => false));
    const lists = g.calls.filter((c) => c.url.pathname.endsWith("/me/messages"));
    expect(lists.map((c) => c.url.searchParams.get("$orderby"))).toEqual(["receivedDateTime desc", "receivedDateTime asc"]);
    for (const c of lists) expect(c.headers.get("prefer")).toBe('IdType="ImmutableId"');
  });

  it("backs off on 429 using Retry-After", async () => {
    let throttled = false;
    const inner = graph([[msg("a")]]);
    const wrapped = scriptedFetch((call) => {
      if (call.url.pathname.endsWith("/me/messages") && !throttled) {
        throttled = true;
        return json({}, 429, { "Retry-After": "9" });
      }
      return inner.fetch(call.url.toString(), { headers: call.headers });
    });
    const { sleep, waits } = fakeSleep();
    const got = await collect(createGraphProvider(token, { fetch: wrapped.fetch, sleep }).fetch(since, () => false));
    expect(got.map((m) => m.id)).toEqual(["a"]);
    expect(waits).toEqual([9000]);
  });

  it("refreshes once on 401, then NotConnected when it persists", async () => {
    let n = 0;
    const source = vi.fn(async () => `tok${++n}`);
    const ok = graph([[msg("a")]]);
    const first = scriptedFetch((call) => (call.headers.get("authorization") === "Bearer tok1" ? json({}, 401) : ok.fetch(call.url.toString(), { headers: call.headers })));
    const got = await collect(createGraphProvider(source, { fetch: first.fetch }).fetch(since, () => false));
    expect(got.map((m) => m.id)).toEqual(["a"]);

    const bad = scriptedFetch(() => json({}, 401));
    await expect(collect(createGraphProvider(token, { fetch: bad.fetch }).fetch(since, () => false))).rejects.toBeInstanceOf(NotConnected);
  });

  it("refuses a next page that points off Graph", async () => {
    const g = scriptedFetch(({ url }) =>
      url.pathname.includes("/mailFolders/") ? json({ id: "x" }) : json({ value: [], "@odata.nextLink": "https://evil.example/steal" }),
    );
    await expect(collect(createGraphProvider(token, { fetch: g.fetch }).fetch(since, () => false))).rejects.toThrow(/unexpected response/);
    expect(g.calls.some((c) => c.url.host === "evil.example")).toBe(false);
  });

  it("stops when aborted", async () => {
    const g = graph([[msg("a"), msg("b")]]);
    const ctl = new AbortController();
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const m of createGraphProvider(token, { fetch: g.fetch }).fetch(since, () => false, ctl.signal)) {
          seen.push(m.id);
          ctl.abort();
        }
      })(),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual(["a"]);
  });
});

describe("graph address", () => {
  it("prefers mail, falls back to userPrincipalName, and is stored on the provider", async () => {
    const a = scriptedFetch(() => json({ mail: "me@outlook.com", userPrincipalName: "upn@x" }));
    expect(await getGraphAddress(token, { fetch: a.fetch })).toBe("me@outlook.com");
    expect(a.calls[0].url.pathname).toBe("/v1.0/me");
    const b = scriptedFetch(() => json({ mail: null, userPrincipalName: "upn@x.com" }));
    const p = createGraphProvider(token, { fetch: b.fetch });
    await p.resolveAddress();
    expect(p.address).toBe("upn@x.com");
  });
});

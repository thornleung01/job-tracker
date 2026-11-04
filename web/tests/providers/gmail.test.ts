import { describe, expect, it, vi } from "vitest";
import { createGmailProvider, EXCLUDE, getGmailAddress, parseGmailMessage } from "../../src/providers/gmail";
import { NotConnected } from "../../src/types";
import { b64, collect, fakeSleep, json, scriptedFetch, token } from "./helpers";

const raw = (id: string, day: number, extra: object = {}) => ({
  id,
  threadId: `t-${id}`,
  internalDate: String(Date.UTC(2026, 9, day)),
  payload: {
    mimeType: "text/plain",
    headers: [{ name: "From", value: "Acme <jobs@acme.com>" }, { name: "Subject", value: `Thank you for applying ${id}` }],
    body: { data: b64("Hi") },
  },
  ...extra,
});

/** A fake Gmail: list pages (newest first) and per-id message bodies. */
function gmail(pages: string[][], bodies: Record<string, object>, fail: Record<string, Response[]> = {}) {
  return scriptedFetch(({ url }) => {
    if (url.pathname.endsWith("/messages")) {
      const page = Number(url.searchParams.get("pageToken") ?? 0);
      return json({ messages: pages[page].map((id) => ({ id })), nextPageToken: page + 1 < pages.length ? String(page + 1) : undefined });
    }
    const id = decodeURIComponent(url.pathname.split("/").pop()!);
    const queued = fail[id]?.shift();
    return queued ?? json(bodies[id]);
  });
}

describe("parseGmailMessage", () => {
  it("prefers the plain text part of multipart/alternative", () => {
    const m = parseGmailMessage({
      id: "g1",
      threadId: "th1",
      internalDate: "1790000000000",
      payload: {
        mimeType: "multipart/alternative",
        headers: [{ name: "From", value: "Acme Careers <no-reply@greenhouse.io>" }, { name: "Subject", value: "Thank you for applying" }],
        parts: [
          { mimeType: "text/html", body: { data: b64("<p>html version</p>") } },
          { mimeType: "text/plain", body: { data: b64("plain version") } },
        ],
      },
    });
    expect([m.id, m.threadId, m.senderName, m.senderEmail]).toEqual(["g1", "th1", "Acme Careers", "no-reply@greenhouse.io"]);
    expect(m.body).toBe("plain version");
    expect(m.html).toBe("<p>html version</p>");
    expect(m.receivedAt).toBe(new Date(1790000000000).toISOString());
    expect(m.webLink).toBeNull();
  });

  it("falls back to text from the HTML part", () => {
    const m = parseGmailMessage({
      id: "g2",
      internalDate: "1790000000000",
      payload: { mimeType: "text/html", headers: [{ name: "From", value: "a@b.com" }], body: { data: b64("<html><body><p>Hello <b>there</b></p><script>x()</script></body></html>") } },
    });
    expect(m.body).toContain("Hello");
    expect(m.body).toContain("there");
    expect(m.body).not.toContain("x()");
    expect([m.threadId, m.subject, m.senderEmail, m.senderName]).toEqual(["g2", "", "a@b.com", ""]);
  });

  it("falls back to the snippet when there is no body part", () => {
    const m = parseGmailMessage({ id: "g3", internalDate: "1", snippet: "just a snippet", payload: { mimeType: "multipart/mixed", headers: [] } });
    expect(m.body).toBe("just a snippet");
  });

  it("walks nested multiparts and decodes non-ASCII text as UTF-8", () => {
    const m = parseGmailMessage({
      id: "g4",
      internalDate: "1",
      payload: {
        mimeType: "multipart/mixed",
        headers: [{ name: "From", value: "Zoë <zoe@café.example>" }],
        parts: [{ mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64("Café — 面接のご案内 🎉") } }] }, { mimeType: "application/pdf", body: {} }],
      },
    });
    expect(m.body).toBe("Café — 面接のご案内 🎉");
  });

  it("honours a part's declared charset", () => {
    // "é" in latin-1 is a single 0xE9 byte
    const data = btoa(String.fromCharCode(0x63, 0x61, 0x66, 0xe9)).replace(/=+$/, "");
    const m = parseGmailMessage({
      id: "g5",
      internalDate: "1",
      payload: { mimeType: "text/plain", headers: [{ name: "Content-Type", value: 'text/plain; charset="iso-8859-1"' }], body: { data } },
    });
    expect(m.body).toBe("café");
  });

  it("decodes RFC 2047 subjects and sender names, and quoted names", () => {
    const m = parseGmailMessage({
      id: "g6",
      internalDate: "1",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: '"=?UTF-8?B?Sm9zw6k=?=" <jose@x.com>' },
          { name: "Subject", value: "=?UTF-8?Q?Entrevista_=E2=80=93_Caf=C3=A9?=" },
        ],
        body: { data: b64("x") },
      },
    });
    expect(m.senderName).toBe("José");
    expect(m.subject).toBe("Entrevista – Café");
  });

  it("uses the Date header when internalDate is missing, and rejects when neither works", () => {
    const m = parseGmailMessage({ id: "d", payload: { mimeType: "text/plain", headers: [{ name: "Date", value: "Mon, 05 Oct 2026 10:30:00 -0400" }], body: { data: b64("x") } } });
    expect(m.receivedAt).toBe("2026-10-05T14:30:00.000Z");
    expect(() => parseGmailMessage({ id: "e", payload: { headers: [] } })).toThrow(/internalDate/);
  });

  describe("bulk", () => {
    const withHeaders = (headers: Record<string, string>) =>
      parseGmailMessage({ id: "b", internalDate: "1", payload: { mimeType: "text/plain", headers: Object.entries(headers).map(([name, value]) => ({ name, value })), body: { data: b64("x") } } }).bulk;
    it("is true for List-Unsubscribe, List-Id and Precedence bulk/list/junk", () => {
      expect(withHeaders({ "List-Unsubscribe": "<mailto:x@y>" })).toBe(true);
      expect(withHeaders({ "List-ID": "<jobs.list>" })).toBe(true);
      expect(withHeaders({ Precedence: " Bulk " })).toBe(true);
    });
    it("is false for ordinary mail", () => {
      expect(withHeaders({ From: "a@b.com" })).toBe(false);
      expect(withHeaders({ Precedence: "first-class" })).toBe(false);
    });
  });
});

describe("gmail provider fetch", () => {
  const since = new Date("2026-09-01T00:00:00Z");

  it("asks for after:<epoch> with the exclusion rules, via Bearer auth", async () => {
    const g = gmail([["a"]], { a: raw("a", 1) });
    await collect(createGmailProvider(token, { fetch: g.fetch }).fetch(since, () => false));
    const list = g.calls[0];
    expect(list.url.origin + list.url.pathname).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    expect(list.url.searchParams.get("q")).toBe(`after:${since.getTime() / 1000} ${EXCLUDE}`);
    expect(list.url.searchParams.get("maxResults")).toBe("500");
    expect(list.headers.get("authorization")).toBe("Bearer tok");
    expect(g.calls[1].url.searchParams.get("format")).toBe("full");
    for (const label of ["-in:spam", "-in:sent", "-in:drafts", "-category:promotions", "-category:social", "-category:forums"]) expect(EXCLUDE).toContain(label);
  });

  it("pages through nextPageToken and yields newest first", async () => {
    const g = gmail([["new", "mid"], ["old"]], { new: raw("new", 3), mid: raw("mid", 2), old: raw("old", 1) });
    const got = await collect(createGmailProvider(token, { fetch: g.fetch }).fetch(since, () => false));
    expect(got.map((m) => m.id)).toEqual(["new", "mid", "old"]);
    expect(g.calls.filter((c) => c.url.pathname.endsWith("/messages")).map((c) => c.url.searchParams.get("pageToken"))).toEqual([null, "1"]);
  });

  it("can yield oldest first and reports how many bodies are pending", async () => {
    const g = gmail([["new", "mid", "old"]], { new: raw("new", 3), mid: raw("mid", 2), old: raw("old", 1) });
    const onPending = vi.fn();
    const got = await collect(createGmailProvider(token, { fetch: g.fetch, oldestFirst: true, onPending }).fetch(since, (id) => id === "mid"));
    expect(got.map((m) => m.id)).toEqual(["old", "new"]);
    expect(onPending).toHaveBeenCalledWith(2);
  });

  it("does not download bodies for messages skip() says are stored", async () => {
    const g = gmail([["a", "b"]], { a: raw("a", 1), b: raw("b", 2) });
    await collect(createGmailProvider(token, { fetch: g.fetch }).fetch(since, (id) => id === "a"));
    const gets = g.calls.filter((c) => !c.url.pathname.endsWith("/messages")).map((c) => c.url.pathname.split("/").pop());
    expect(gets).toEqual(["b"]);
  });

  it("absorbs a rate limit mid-download without losing a message", async () => {
    const g = gmail([["new", "mid", "old"]], { new: raw("new", 3), mid: raw("mid", 2), old: raw("old", 1) }, {
      mid: [json({ error: { errors: [{ reason: "rateLimitExceeded" }] } }, 403)],
    });
    const { sleep, waits } = fakeSleep();
    const got = await collect(createGmailProvider(token, { fetch: g.fetch, sleep }).fetch(since, () => false));
    expect(got.map((m) => m.id)).toEqual(["new", "mid", "old"]);
    expect(waits).toEqual([5000]);
  });

  it("skips a message deleted between listing and download, and a malformed one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = gmail([["gone", "bad", "ok"]], { bad: { id: "bad", payload: { headers: [] } }, ok: raw("ok", 1) }, { gone: [json({}, 404)] });
    const got = await collect(createGmailProvider(token, { fetch: g.fetch }).fetch(since, () => false));
    expect(got.map((m) => m.id)).toEqual(["ok"]);
    warn.mockRestore();
  });

  it("on 401 refreshes the token once and retries the same request", async () => {
    let n = 0;
    const source = vi.fn(async () => `tok${++n}`);
    const g = scriptedFetch(({ headers, url }) => {
      if (headers.get("authorization") === "Bearer tok1") return json({}, 401);
      return url.pathname.endsWith("/messages") ? json({ messages: [{ id: "a" }] }) : json(raw("a", 1));
    });
    const got = await collect(createGmailProvider(source, { fetch: g.fetch }).fetch(since, () => false));
    expect(got.map((m) => m.id)).toEqual(["a"]);
    expect(g.calls[0].headers.get("authorization")).toBe("Bearer tok1");
    expect(g.calls[1].headers.get("authorization")).toBe("Bearer tok2");
  });

  it("throws NotConnected when 401 persists", async () => {
    const g = scriptedFetch(() => json({}, 401));
    await expect(collect(createGmailProvider(token, { fetch: g.fetch }).fetch(since, () => false))).rejects.toBeInstanceOf(NotConnected);
  });

  it("stops when aborted between messages", async () => {
    const g = gmail([["a", "b", "c"]], { a: raw("a", 3), b: raw("b", 2), c: raw("c", 1) });
    const ctl = new AbortController();
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const m of createGmailProvider(token, { fetch: g.fetch }).fetch(since, () => false, ctl.signal)) {
          seen.push(m.id);
          ctl.abort();
        }
      })(),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual(["a"]);
  });
});

describe("gmail address", () => {
  it("reads users/me/profile and stores it on the provider", async () => {
    const g = scriptedFetch(() => json({ emailAddress: "me@gmail.com" }));
    expect(await getGmailAddress(token, { fetch: g.fetch })).toBe("me@gmail.com");
    expect(g.calls[0].url.pathname).toBe("/gmail/v1/users/me/profile");
    const p = createGmailProvider(token, { fetch: g.fetch });
    expect(p.address).toBeNull();
    await p.resolveAddress();
    expect(p.address).toBe("me@gmail.com");
  });
});


// The path the other banner tests fake: button, token source, the real provider factory, a scripted network, and the
// pipeline that turns mail into applications. Only the network and the login are stand-ins.
import "fake-indexeddb/auto";
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncBanner } from "../../../src/components/SyncBanner";
import { upsertAccount } from "../../../src/db/repo";
import { forgetConnections } from "../../../src/pages/settings/actions";
import type { ProviderName } from "../../../src/types";
import { b64, json, scriptedFetch } from "../../providers/helpers";
import { ada, byText, click, cleanupRendered, closeDbs, fakeAuth, freshDb, q, render, settle, waitFor } from "../../app/helpers";

beforeEach(forgetConnections);
afterEach(() => {
  cleanupRendered();
  closeDbs();
});

const gmailMessage = (id: string, subject: string, from: string) => ({
  id,
  threadId: `t-${id}`,
  internalDate: String(Date.now() - 3_600_000),
  payload: { mimeType: "text/plain", headers: [{ name: "From", value: from }, { name: "Subject", value: subject }], body: { data: b64("We received your application.") } },
});

async function mountWith(provider: ProviderName, address: string) {
  const db = freshDb();
  await upsertAccount(db, provider, address);
  const fake = fakeAuth({ status: "signed-in", user: ada });
  const tokenSource = vi.fn(async () => "tok");
  const connectMail = vi.fn(async (p: ProviderName) => {
    await fake.set({ mail: { ...fake.auth.getSession().mail, [p]: true } });
  });
  const deps = { auth: { getSession: fake.auth.getSession, subscribe: fake.auth.subscribe, connectMail, tokenSource, takePendingSync: fake.auth.takePendingSync } };
  await render(h(SyncBanner, { db, user: ada, deps }));
  await settle(40);
  return { db, tokenSource };
}

describe("SyncBanner with the real providers", () => {
  it("reads Gmail through the token source and files the confirmation as an application", async () => {
    const net = scriptedFetch(({ url }) => {
      if (url.pathname.endsWith("/users/me/profile")) return json({ emailAddress: "me@gmail.com" });
      if (url.pathname.endsWith("/users/me/messages")) return json({ messages: [{ id: "g1" }, { id: "g2" }] });
      const id = decodeURIComponent(url.pathname.split("/").pop()!);
      return json(id === "g1" ? gmailMessage("g1", "Thank you for applying to Acme", "Acme Careers <no-reply@greenhouse.io>") : gmailMessage("g2", "Your weekly digest", "News <news@example.org>"));
    });
    vi.stubGlobal("fetch", net.fetch);
    const { db, tokenSource } = await mountWith("gmail", "me@gmail.com");
    await click(byText("Reconnect and sync", "button")!);
    await waitFor(() => /Synced/.test(q(".sync-banner")?.textContent ?? ""));

    expect((await db.applications.toArray()).map((a) => [a.company, a.stage])).toEqual([["Acme", "Applied"]]);
    expect(await db.emails.count()).toBe(2);
    // Every request carried the token the login handed over, and went only to Gmail.
    expect(tokenSource).toHaveBeenCalled();
    expect(net.calls.length).toBeGreaterThan(2);
    for (const c of net.calls) {
      expect(c.url.origin).toBe("https://gmail.googleapis.com");
      expect(c.headers.get("authorization")).toBe("Bearer tok");
    }
  });

  it("reads Outlook through the same banner", async () => {
    const net = scriptedFetch(({ url }) => {
      if (url.pathname.includes("/me/mailFolders/")) return json({ id: `F-${url.pathname.split("/").pop()}` });
      if (url.pathname.endsWith("/me/messages")) {
        return json({
          value: [{
            id: "o1", conversationId: "c1", subject: "Thank you for applying to Initech", from: { emailAddress: { name: "Initech Careers", address: "no-reply@lever.co" } },
            receivedDateTime: new Date(Date.now() - 3_600_000).toISOString(), body: { contentType: "text", content: "We received your application." }, parentFolderId: "inbox",
          }],
        });
      }
      return json({ mail: "me@outlook.com" });
    });
    vi.stubGlobal("fetch", net.fetch);
    const { db } = await mountWith("outlook", "me@outlook.com");
    await click(byText("Reconnect and sync", "button")!);
    await waitFor(() => /Synced/.test(q(".sync-banner")?.textContent ?? ""));

    expect((await db.applications.toArray()).map((a) => [a.company, a.stage])).toEqual([["Initech", "Applied"]]);
    for (const c of net.calls) expect(c.url.origin).toBe("https://graph.microsoft.com");
  });
});

import { describe, expect, it } from "vitest";
import { POPUP_HINT, createGoogleAuth, type GisApi } from "../../src/auth/google";
import { NotConnected } from "../../src/types";
import { CLIENT_ID, NOW } from "./helpers";

const MAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
type TokenConfig = Parameters<GisApi["accounts"]["oauth2"]["initTokenClient"]>[0];

function authWith(respond: (cfg: TokenConfig) => void) {
  const api = {
    accounts: {
      id: { initialize: () => undefined, prompt: () => undefined, renderButton: () => undefined, disableAutoSelect: () => undefined, cancel: () => undefined },
      oauth2: { initTokenClient: (cfg: TokenConfig) => ({ requestAccessToken: () => respond(cfg) }), revoke: () => undefined },
    },
  } as GisApi;
  return createGoogleAuth({ clientId: CLIENT_ID, mailScope: MAIL_SCOPE, loadGis: async () => api, now: () => NOW });
}

const rejection = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as Error;

describe("the Google NotConnected hint", () => {
  it("is plain text a person can act on", () => {
    expect(POPUP_HINT).toBe("Your browser may have blocked the Google login window. Allow pop-ups for this site and try again.");
    expect(POPUP_HINT).not.toMatch(/[–—]/);
  });

  it("is the message when the browser blocks the window", async () => {
    const err = await rejection(authWith((c) => c.error_callback?.({ type: "popup_failed_to_open" })).requestMailToken());
    expect(err).toBeInstanceOf(NotConnected);
    expect(err.message).toBe(POPUP_HINT);
  });

  it("is the message when the silent request fails", async () => {
    const err = await rejection(authWith((c) => c.callback({ error: "interaction_required" })).requestMailToken());
    expect(err).toBeInstanceOf(NotConnected);
    expect(err.message).toBe(POPUP_HINT);
  });

  it("is not used when the person closed the window or refused access", async () => {
    const closed = await rejection(authWith((c) => c.error_callback?.({ type: "popup_closed" })).requestMailToken());
    expect(closed).toBeInstanceOf(NotConnected);
    expect(closed.message).not.toBe(POPUP_HINT);
    const denied = await rejection(authWith((c) => c.callback({ error: "access_denied" })).requestMailToken());
    expect(denied).toBeInstanceOf(NotConnected);
    expect(denied.message).not.toBe(POPUP_HINT);
  });
});

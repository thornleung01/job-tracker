// Signing out forgets which address was connected in this tab, so the next person to log in on this tab starts clean.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ signOut: vi.fn<() => Promise<void>>() }));
vi.mock("../../src/auth", async (original) => ({ ...(await original<typeof import("../../src/auth")>()), signOut: auth.signOut }));

import { defaultAuth } from "../../src/app/authApi";
import { defaultDeps } from "../../src/pages/settings/deps";
import { connectedAddress, forgetConnections, registerMailbox } from "../../src/sync/mailbox";
import { ada, closeDbs, freshDb } from "../app/helpers";

afterEach(() => {
  forgetConnections();
  auth.signOut.mockReset();
  closeDbs();
});

async function connect() {
  await registerMailbox(freshDb(), ada, "gmail", { tokenSource: vi.fn(), getAddress: async () => "me@gmail.com" });
  expect(connectedAddress(ada, "gmail")).toBe("me@gmail.com");
}

describe("signing out", () => {
  it("forgets the connected addresses from the shell's log out", async () => {
    auth.signOut.mockResolvedValue(undefined);
    await connect();
    await defaultAuth.signOut();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(connectedAddress(ada, "gmail")).toBeNull();
  });

  it("forgets them from Settings' log out too, and also when revoking the tokens fails", async () => {
    auth.signOut.mockRejectedValue(new Error("offline"));
    await connect();
    await expect(defaultDeps.auth.signOut()).rejects.toThrow("offline");
    expect(connectedAddress(ada, "gmail")).toBeNull();
  });
});

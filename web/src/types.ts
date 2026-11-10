// Shared contract between providers, pipeline and UI. Mirrors jobtracker/models.py and providers/base.py.

export const BODY_LIMIT = 4096;

/** Provider-neutral email, as returned by every mail provider. Mirrors `Message` in jobtracker/models.py. */
export interface Message {
  id: string;
  threadId: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  /** ISO-8601 UTC, e.g. 2026-11-03T14:05:00.000Z */
  receivedAt: string;
  /** plain text */
  body: string;
  /** direct link to the message in the provider's web mail, if it gives one */
  webLink?: string | null;
  /** the sender marked it as a mailing list / newsletter (List-Unsubscribe and similar headers) */
  bulk?: boolean;
}

export type ProviderName = "gmail" | "outlook";

/** How a mailbox is named to a person. Here, the lowest layer, so auth and sync say it the same way. */
export const PROVIDER_LABEL: Record<ProviderName, string> = { gmail: "Gmail", outlook: "Outlook" };

/** Mirrors the `Provider` protocol in jobtracker/providers/base.py, minus the Python-only connect/disconnect. */
export interface MailProvider {
  name: ProviderName;
  /** The account's email address, known once connected. */
  address: string | null;
  /**
   * Yield messages received at or after `since`, newest first.
   * `skip(id)` is true for messages already stored, so bodies are not downloaded again.
   */
  fetch(since: Date, skip: (id: string) => boolean, signal?: AbortSignal): AsyncGenerator<Message>;
}

/** Thrown when a provider has no usable access token; the UI should ask the user to connect or re-consent. */
export class NotConnected extends Error {
  constructor(message = "Not connected") {
    super(message);
    this.name = "NotConnected";
  }
}

/**
 * Supplies a currently valid access token for a provider, refreshing silently when it can.
 * Implemented by web/src/auth; consumed by web/src/providers. Must throw NotConnected when no token can be had.
 */
/**
 * Gives the access token for a mailbox. `rejected` is passed when the provider answered 401 to `token`: the source must not hand that
 * token out again (it asks for a fresh one), and with `final` (a fresh token was rejected too) it marks the mailbox disconnected.
 */
export type TokenSource = (provider: ProviderName, signal?: AbortSignal, rejected?: { token: string; final: boolean }) => Promise<string>;

// Reading mail into applications (jobtracker/sync.py): classify, match, create, and keep unrelated mail out of storage.
import type { MailProvider, Message, ProviderName } from "../types";
import { BODY_LIMIT, NotConnected } from "../types";
import Dexie from "dexie";
import type { AccountRow, JobTrackerDB } from "../db/schema";
import { tx } from "../db/schema";
import { ProviderHttpError } from "../providers/backoff";
import { safeWebLink } from "../db/mailLink";
import { emailSeen } from "../db/repo";
import { addDays, iso } from "../db/time";
import { decide, rememberIgnored, rememberUnrelated } from "./decide";
import { PROVIDER_LABEL } from "./accountLabel";
import { alertSite } from "./alerts";
import { byAsc } from "./compare";
import { loadLearned } from "./learn";
import type { Classification, LearnedView } from "./pipelineTypes";
import { pipeline } from "./pipeline";
import { settleReview } from "./recheck";
import { loadSettings } from "./settings";
import { plural, truncate } from "./text";

/** The next scan starts this long before the last one ended, so nothing slips between two syncs. */
export const OVERLAP_DAYS = 1;
export const BATCH = 25;

export type Outcome = "duplicate" | "job-alert" | "ignored" | "applied-to-application" | "review";
export type Counts = Partial<Record<Outcome | "error" | "retry", number>>;

function add(total: Counts, more: Counts): void {
  for (const [k, n] of Object.entries(more) as [keyof Counts, number][]) total[k] = (total[k] ?? 0) + n;
}

/** Classify one email and update applications. Safe to re-run on the same email. */
export async function processMessage(db: JobTrackerDB, accountId: number, msg: Message, learned?: LearnedView, now: Date = new Date()): Promise<Outcome> {
  if (await emailSeen(db, accountId, msg.id)) return "duplicate";

  const when = iso(msg.receivedAt);
  const views = learned ?? (await loadLearned(db));
  let cls: Classification | null; // null for a job alert
  try {
    cls = alertSite(msg) ? null : pipeline().classify(msg, views);
  } catch (err) {
    throw new UnreadableMessage(err);
  }
  if (!cls) {
    // A LinkedIn/Indeed job alert: the Jobs tab is not in the hosted edition, and it never becomes an application.
    return tx(db, async (): Promise<Outcome> => {
      if (await emailSeen(db, accountId, msg.id)) return "duplicate"; // a second tab can have saved it since the check above
      await rememberUnrelated(db, accountId, msg.id, when);
      return "job-alert";
    });
  }

  return tx(db, async (): Promise<Outcome> => {
    // Looked at again inside the transaction: a second tab can have saved this email since the check above.
    if (await emailSeen(db, accountId, msg.id)) return "duplicate";
    if (!cls.related) {
      await rememberUnrelated(db, accountId, msg.id, when);
      if (cls.reason.startsWith("learned:")) await rememberIgnored(db, accountId, msg, when, cls.reason, now);
      return "ignored";
    }
    const { appId, needsReview } = await decide(db, accountId, msg, cls, when);
    await db.emails.add({
      accountId,
      providerMsgId: msg.id,
      threadId: msg.threadId,
      receivedAt: when,
      sender: `${msg.senderName} <${msg.senderEmail}>`,
      subject: msg.subject,
      body: truncate(msg.body, BODY_LIMIT),
      related: true,
      event: cls.event,
      confidence: cls.confidence,
      applicationId: appId,
      needsReview,
      webLink: safeWebLink(msg.webLink),
      bulk: Boolean(msg.bulk),
      hold: false,
      reason: cls.reason,
    });
    return needsReview ? "review" : "applied-to-application";
  });
}

/** Reading the email itself (finding out whether it is an alert, judging it) threw: it would fail the same way every time. */
class UnreadableMessage extends Error {
  constructor(cause: unknown) {
    super("This email could not be read.", { cause });
    this.name = "UnreadableMessage";
  }
}

/** How many times an email may fail for a reason that is not storage trouble before it is given up on. */
export const MAX_FAILURES = 3;
export const FAILURES_KEY = "emailFailures";

/** Errors from the browser's storage that can clear up by themselves (a full disk, a closed or busy database). */
const TRANSIENT_NAMES = new Set([
  "QuotaExceededError", "DatabaseClosedError", "OpenFailedError", "AbortError", "TimeoutError", "UnknownError",
  "InvalidStateError", "TransactionInactiveError", "VersionError", "BlockedError",
]);

function isTransient(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 4; depth++) {
    if (e instanceof Error && TRANSIENT_NAMES.has(e.name)) return true;
    e = (e as { inner?: unknown } | null)?.inner ?? (e as { cause?: unknown } | null)?.cause;
  }
  return false;
}

async function loadFailures(db: JobTrackerDB): Promise<Record<string, number>> {
  try {
    const v = (await db.settings.get(FAILURES_KEY))?.value;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === "number" && Number.isFinite(n))) as Record<string, number>;
    }
  } catch {
    // storage is unwell: start from none
  }
  return {};
}

async function saveFailures(db: JobTrackerDB, failures: Record<string, number>): Promise<void> {
  try {
    if (Object.keys(failures).length) await db.settings.put({ key: FAILURES_KEY, value: failures });
    else await db.settings.delete(FAILURES_KEY);
  } catch {
    // the count is a convenience: losing it only means more retries
  }
}

/** Process oldest-first so stages progress in the order things happened. */
export async function processMessages(db: JobTrackerDB, accountId: number, messages: Message[], now: Date = new Date()): Promise<Counts> {
  const counts: Counts = {};
  const learned = await loadLearned(db);
  const ordered = messages
    .map((msg) => ({ msg, when: iso(msg.receivedAt) }))
    .sort(byAsc((m) => m.when));
  const failures = await loadFailures(db);
  let failuresChanged = false;
  for (const { msg } of ordered) {
    let result: Outcome | "error" | "retry";
    const key = `${accountId}:${msg.id}`;
    try {
      result = await processMessage(db, accountId, msg, learned, now);
      if (failures[key] !== undefined) {
        delete failures[key];
        failuresChanged = true;
      }
    } catch (err) {
      let giveUp = err instanceof UnreadableMessage;
      if (!giveUp && !isTransient(err)) {
        // Not a storage hiccup: a bug in how this one email is filed would fail every time and pin the sync window for good.
        // It gets MAX_FAILURES tries across syncs (the next one may carry a fix), then is treated as unreadable.
        failures[key] = (failures[key] ?? 0) + 1;
        failuresChanged = true;
        giveUp = failures[key] >= MAX_FAILURES;
        if (giveUp) console.error(`Giving up on one email after ${MAX_FAILURES} failed attempts`, err);
      }
      if (!giveUp) {
        // Storage trouble (full disk, a closed or busy database, a second tab) may go away, and marking the email seen would
        // blank it for good, so it is left for the next sync.
        result = "retry";
      } else {
        // A message that can't be read at all would fail every time, so mark it seen and move on.
        result = "error";
        try {
          await tx(db, () => rememberUnrelated(db, accountId, msg.id, iso(msg.receivedAt)));
          if (failures[key] !== undefined) {
            delete failures[key]; // kept until it is marked seen, so a failed marking is not given a fresh three tries
            failuresChanged = true;
          }
        } catch {
          // already marked, or storage is unwell: nothing more to do
        }
      }
    }
    counts[result] = (counts[result] ?? 0) + 1;
  }
  if (failuresChanged) await saveFailures(db, failures);
  return counts;
}

export interface SyncProgress {
  phase: "finding" | "reading";
  done: number;
  total: number | null;
  note: string;
}

export interface SyncOptions {
  /** Read this many days back (a rescan). Omit for "new mail since the last sync" (or the lookback setting on a first sync). */
  days?: number;
  progress?: (p: SyncProgress) => void;
  /** How many bodies the provider will download, once it knows (for the progress bar). */
  total?: () => number | null;
  /**
   * Save as you go. Set this only when the provider yields oldest first (`oldestFirst: true` for Gmail and Outlook): a sync
   * that stops part-way then keeps what it read, and memory stays flat. Otherwise everything is collected and processed
   * together, so stages still progress in date order. lastSync moves only when the whole run finishes cleanly, either way.
   */
  incremental?: boolean;
  signal?: AbortSignal;
  now?: Date;
}

export const isAbort = (err: unknown): boolean => err instanceof DOMException && err.name === "AbortError";

/** What to tell the person when an account's sync failed: a plain sentence with what to do next, never a status code or class name. */
export function syncFailureText(err: unknown, provider: ProviderName): string {
  const name = PROVIDER_LABEL[provider];
  if (err instanceof NotConnected) return err.message;
  if (isAbort(err)) return "Sync stopped.";
  if (err instanceof ProviderHttpError) {
    if (err.status === 401 || err.status === 403) return `${name} refused access to your mailbox. Reconnect and try again.`;
    if (err.status === 429 || err.status >= 500) return `${name} is busy right now. Try again in a few minutes.`;
    return `${name} couldn't read your emails. Try again.`;
  }
  // fetch() reports a network failure as a TypeError; any other TypeError is a bug and gets the general sentence below
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) return `Couldn't reach ${name}. Check your connection and try again.`;
  return "Sync stopped because something went wrong. Try again.";
}

/** Fetches and processes one account. Records the outcome on the account row. Throws if the provider fails. */
export async function syncAccount(
  db: JobTrackerDB, account: AccountRow | number, provider: MailProvider, opts: SyncOptions = {},
): Promise<Counts> {
  const row = typeof account === "number" ? await db.accounts.get(account) : account;
  if (!row) throw new Error(`No account ${String(account)}`);
  const report = opts.progress ?? (() => undefined);
  const now = opts.now ?? new Date();
  const fresh = await db.accounts.get(row.id);
  const lastSync = fresh?.lastSync ?? row.lastSync;

  let since: Date;
  if (opts.days !== undefined && opts.days !== 0) {
    since = addDays(now, -opts.days);
  } else if (!lastSync) {
    since = addDays(now, -(await loadSettings(db)).sync.lookbackDays);
  } else {
    since = addDays(new Date(lastSync), -OVERLAP_DAYS);
  }

  const counts: Counts = {};
  try {
    // The provider asks synchronously whether it has an email already, so read the stored ids up front.
    const stored = await db.emails
      .where("[accountId+providerMsgId]")
      .between([row.id, Dexie.minKey], [row.id, Dexie.maxKey])
      .keys();
    const seen = new Set<string>(stored.map((k) => (k as unknown as [number, string])[1]));

    report({ phase: "finding", done: 0, total: null, note: "" });
    const found = provider.fetch(since, (id) => seen.has(id), opts.signal);
    let n = 0;
    const read = async function* (): AsyncGenerator<Message> {
      for await (const msg of found) {
        n++;
        seen.add(msg.id);
        report({ phase: "reading", done: n, total: opts.total?.() ?? null, note: "" });
        yield msg;
      }
    };

    if (opts.incremental) {
      // Save as we go, so a sync that stops part-way (a rate limit, a lost connection) keeps what it read and the next one
      // carries on from there. Memory stays flat on a big first scan, too.
      let batch: Message[] = [];
      try {
        for await (const msg of read()) {
          batch.push(msg);
          if (batch.length >= BATCH) {
            add(counts, await processMessages(db, row.id, batch, now));
            batch = [];
          }
        }
      } finally {
        add(counts, await processMessages(db, row.id, batch, now)); // also the part-batch when the fetch fails
      }
    } else {
      const all: Message[] = [];
      for await (const msg of read()) all.push(msg);
      add(counts, await processMessages(db, row.id, all, now));
    }
  } catch (err) {
    // One broken account must not stop the others. The person sees a plain sentence, so the real error goes to the console.
    // Pressing Stop is not a failure: nothing is logged and no error is left on the account.
    if (!isAbort(err)) {
      console.error(err);
      try {
        await db.accounts.update(row.id, { lastError: syncFailureText(err, row.provider) });
      } catch {
        // the database is closing (signing out): the provider's error below is the one worth reporting
      }
    }
    throw err;
  }

  // New mail may be what an older, unsure email was waiting for; with none, it is judged again only if the rules or applications changed.
  await settleReview(db, { skipIfUnchanged: !(counts.review || counts["applied-to-application"]) });
  const skipped = counts.error ?? 0;
  const note = skipped ? `Skipped ${plural(skipped, "unreadable email")}.` : null;
  if (counts.retry) {
    // Keep the old window start so the emails that hit a database error are fetched again next time.
    await db.accounts.update(row.id, { lastError: `${plural(counts.retry, "email")} couldn't be saved. The next sync will try again.` });
    return counts;
  }
  await db.accounts.update(row.id, { lastSync: iso(now), lastError: note });
  return counts;
}

// Everything that can go wrong when the app talks to Anthropic with the person's own key, as a sentence that is safe to show. An AiError is an
// ActionError, so a page's notice shows its words (see components/useAction.ts). Nothing here ever holds or prints a key.
import { ActionError } from "../db/errors";

export const AI_MESSAGES = {
  noKey: "Add your Anthropic key in Settings first.",
  locked: "Unlock your key in Settings first.",
  wrongPassphrase: "That passphrase didn't unlock your key.",
  badKey: "That key was refused. Check it in Settings.",
  orgBlocked: "Your Anthropic organization doesn't allow use from a browser.",
  workspaceKey: "That key isn't tied to a workspace. Create one inside a workspace in the Anthropic console.",
  needsCredit: "Your Anthropic account needs credit.",
  rateLimited: "Too many requests right now. Try again in a minute.",
  spendLimit: "Your Anthropic spending limit is reached.",
  busy: "Anthropic is busy. Try again.",
  offline: "Couldn't reach Anthropic.",
  timeout: "That took too long. Try again.",
  cutOff: "That came back cut off. Try again.",
  refused: "Anthropic declined to answer that.",
  badReply: "That came back in a shape the app can't read. Try again.",
  tooLong: "That's too long to send. Shorten it and try again.",
} as const;

export type AiErrorCode = keyof typeof AI_MESSAGES;

export class AiError extends ActionError {
  readonly code: AiErrorCode;
  constructor(code: AiErrorCode) {
    super(AI_MESSAGES[code]);
    this.name = "AiError";
    this.code = code;
  }
}

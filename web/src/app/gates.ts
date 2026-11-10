// One sentence, and where to fix it, for each thing a feature can be missing. Pure: the screens that gate on one render GATES[key]
// (components/Gate.tsx). ai/errors.ts keeps its own plain sentences, which stay link-free: the screen that shows one adds the link from here.
export type GateKey = "mailbox" | "resume" | "aiKey" | "aiLocked" | "posting";

/** The muted line where a Draft in Gmail or Outlook button would be, when there is no mailbox to open it in. */
export const DRAFT_NEEDS_MAILBOX = "Connect your mailbox to draft this in Gmail or Outlook.";

export const GATES: Record<GateKey, { text: string; href: string | null }> = {
  mailbox: { text: "Connect your mailbox in Settings.", href: "#/settings/mail" },
  resume: { text: "Add your resume first.", href: "#/resume" },
  aiKey: { text: "Add your Anthropic key in Settings.", href: "#/settings/ai" },
  aiLocked: { text: "Unlock your key to use AI.", href: null },
  posting: { text: "Paste the job description first.", href: null },
};

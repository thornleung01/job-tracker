import type { Message } from "../../src/types";

/** The `mk` helper the Python tests use: "Name <addr>" or a bare address; received on 2026-10-<day>. */
export function mk(
  subject: string,
  body = "",
  sender = "Acme Careers <jobs@acme.com>",
  opts: { id?: string; thread?: string; day?: number; bulk?: boolean; html?: string } = {},
): Message {
  const lt = sender.indexOf("<");
  const name = lt < 0 ? sender : sender.slice(0, lt);
  const addr = lt < 0 ? "" : sender.slice(lt + 1).replace(/>+$/, "");
  return {
    id: opts.id ?? "m1",
    threadId: opts.thread ?? "t1",
    senderName: name.trim(),
    senderEmail: (addr || name).trim(),
    subject,
    receivedAt: `2026-10-${String(opts.day ?? 1).padStart(2, "0")}T12:00:00.000Z`,
    body,
    bulk: opts.bulk ?? false,
    html: opts.html ?? "",
  };
}

export const textOf = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

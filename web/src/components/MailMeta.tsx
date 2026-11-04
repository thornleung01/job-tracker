import type { ReactNode } from "react";
import { splitSender } from "../pipeline";

/**
 * The line under an email's subject: a bold sender name, what they do on this application, their address, then `children`
 * (the date and account) on their own line.
 */
export function MailMeta({ sender, titles, children }: { sender: string | null; titles?: Record<string, string>; children?: ReactNode }) {
  const [name, address] = splitSender(sender ?? "");
  const title = address ? titles?.[address.toLowerCase()] : undefined;
  return (
    <p className="mail-meta">
      <span className="who">{name || address}</span>
      {title ? <span className="role">{title}</span> : null}
      {name && address ? <span className="addr">{address}</span> : null}
      <span className="when">{children}</span>
    </p>
  );
}

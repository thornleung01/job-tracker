import type { ReactNode } from "react";

/**
 * The base.css notice. Errors are role=alert and read out at once; everything else is role=status.
 * A notice is a live region, so show it with the message already inside.
 */
export function Notice({ tone = "info", children, className }: { tone?: "info" | "err"; children: ReactNode; className?: string }) {
  const classes = ["notice", tone === "err" ? "err" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={classes} role={tone === "err" ? "alert" : "status"} tabIndex={-1}>
      <div>{children}</div>
    </div>
  );
}

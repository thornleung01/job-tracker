import { GATES, type GateKey } from "../app/gates";

/** The standard sentence for something that is missing: the whole sentence is the link when it has a place to go. */
export function Gate({ gate }: { gate: GateKey }) {
  const { text, href } = GATES[gate];
  return href ? <a href={href}>{text}</a> : <>{text}</>;
}

// urllib.parse.urlparse(url).hostname, including the ValueError cases Python raises for malformed hosts.
import { partition, rpartition } from "./pystr";

export class UrlValueError extends Error {}

const HEX4 = /^[0-9a-fA-F]{1,4}$/;
const IPV_FUTURE = /^v[a-fA-F0-9]+\..+$/;

function validIPv4(s: string): boolean {
  const octets = s.split(".");
  return (
    octets.length === 4 &&
    octets.every((o) => /^[0-9]{1,3}$/.test(o) && !(o.length > 1 && o.startsWith("0")) && Number(o) <= 255)
  );
}

// ipaddress.IPv6Address(text), with an optional %scope id.
function validIPv6(text: string): boolean {
  const [addr, sep, scope] = partition(text, "%");
  if (sep && (!scope || scope.includes("%"))) return false;
  if (addr.includes("/")) return false;
  const parts = addr.split(":");
  if (parts.length < 3) return false;
  const last = parts[parts.length - 1];
  if (last.includes(".")) {
    if (!validIPv4(last)) return false;
    parts.pop();
    parts.push("0", "0");
  }
  if (parts.length > 9) return false;
  let skip: number | null = null;
  for (let i = 1; i < parts.length - 1; i++) {
    if (parts[i] === "") {
      if (skip !== null) return false;
      skip = i;
    }
  }
  let hi: number;
  let lo: number;
  if (skip !== null) {
    hi = skip;
    lo = parts.length - skip - 1;
    if (!parts[0]) {
      hi--;
      if (hi) return false;
    }
    if (!parts[parts.length - 1]) {
      lo--;
      if (lo) return false;
    }
    if (8 - (hi + lo) < 1) return false;
  } else {
    if (parts.length !== 8 || !parts[0] || !parts[parts.length - 1]) return false;
    hi = parts.length;
    lo = 0;
  }
  const hextets = [...parts.slice(0, hi), ...(lo ? parts.slice(parts.length - lo) : [])];
  return hextets.every((h) => HEX4.test(h));
}

function checkBracketedHost(host: string): void {
  if (host.startsWith("v")) {
    if (!IPV_FUTURE.test(host)) throw new UrlValueError("IPvFuture address is invalid");
  } else if (!validIPv6(host)) {
    // Not an IPv6 address (an IPv4 address in brackets is an error too).
    throw new UrlValueError("invalid bracketed host");
  }
}

function checkBracketedNetloc(netloc: string): void {
  const hostAndPort = rpartition(netloc, "@")[2];
  const [before, open, bracketed] = partition(hostAndPort, "[");
  let hostname: string;
  if (open) {
    if (before) throw new UrlValueError("Invalid IPv6 URL");
    const [h, , port] = partition(bracketed, "]");
    hostname = h;
    if (port && !port.startsWith(":")) throw new UrlValueError("Invalid IPv6 URL");
  } else {
    hostname = partition(hostAndPort, ":")[0];
  }
  checkBracketedHost(hostname);
}

function checkNetloc(netloc: string): void {
  if (!netloc || /^[\x00-\x7f]*$/.test(netloc)) return;
  const n = netloc.replaceAll("@", "").replaceAll(":", "").replaceAll("#", "").replaceAll("?", "");
  const netloc2 = n.normalize("NFKC");
  if (n === netloc2) return;
  for (const c of "/?#@:") if (netloc2.includes(c)) throw new UrlValueError("netloc contains invalid characters under NFKC normalization");
}

/** The hostname Python would report for an http(s) URL, or null when it is empty. Throws UrlValueError where Python raises ValueError. */
export function urlHostname(rawUrl: string): string | null {
  // Only absolute http(s) URLs reach here (see the URL pattern in mailtext), so the scheme is "http" or "https".
  let url = rawUrl.replace(/^[\x00-\x20]+/, "").replace(/[\t\r\n]/g, "");
  const colon = url.indexOf(":");
  if (colon > 0 && /^[A-Za-z][A-Za-z0-9+\-.]*$/.test(url.slice(0, colon))) url = url.slice(colon + 1);
  let netloc = "";
  if (url.startsWith("//")) {
    let delim = url.length;
    for (const c of "/?#") {
      const w = url.indexOf(c, 2);
      if (w >= 0) delim = Math.min(delim, w);
    }
    netloc = url.slice(2, delim);
    if ((netloc.includes("[") && !netloc.includes("]")) || (netloc.includes("]") && !netloc.includes("["))) {
      throw new UrlValueError("Invalid IPv6 URL");
    }
    if (netloc.includes("[") && netloc.includes("]")) checkBracketedNetloc(netloc);
  }
  checkNetloc(netloc);

  const hostinfo = rpartition(netloc, "@")[2];
  const [, open, bracketed] = partition(hostinfo, "[");
  const hostname = open ? partition(bracketed, "]")[0] : partition(hostinfo, ":")[0];
  if (!hostname) return null;
  const [host, percent, zone] = partition(hostname, "%");
  return host.toLowerCase() + percent + zone;
}

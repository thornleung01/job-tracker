// Small header helpers standing in for Python's email.utils.parseaddr and RFC 2047 decoding.

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset.split("*")[0] || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Decode =?charset?B|Q?...?= words; a no-op on text that is already decoded. */
export function decodeMimeWords(value: string): string {
  return value
    .replace(/(\?=)\s+(=\?)/g, "$1$2")
    .replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, (all, charset: string, enc: string, text: string) => {
      try {
        if (enc.toLowerCase() === "b") return decodeBytes(base64ToBytes(text), charset);
        const bytes: number[] = [];
        for (let i = 0; i < text.length; i++) {
          const c = text[i];
          if (c === "_") bytes.push(0x20);
          else if (c === "=" && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 1, i + 3))) {
            bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
            i += 2;
          } else bytes.push(c.charCodeAt(0) & 0xff);
        }
        return decodeBytes(Uint8Array.from(bytes), charset);
      } catch {
        return all;
      }
    });
}

/** Base64 or base64url text to bytes, tolerant of missing padding. */
export function base64ToBytes(data: string): Uint8Array {
  const std = data.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const bin = atob(std + "=".repeat((4 - (std.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** First address of a From-style header: `Name <a@b>`, `"Name" <a@b>`, `a@b`, `a@b (Name)`. */
export function parseAddress(value: string): { name: string; email: string } {
  let inQuote = false;
  let lt = -1;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "\\" && inQuote) i++;
    else if (c === '"') inQuote = !inQuote;
    else if (c === "<" && !inQuote) {
      lt = i;
      break;
    }
  }
  let name: string;
  let email: string;
  if (lt >= 0) {
    const gt = value.indexOf(">", lt);
    email = value.slice(lt + 1, gt < 0 ? undefined : gt).trim();
    name = value.slice(0, lt).trim();
  } else {
    const comment = /\(([^)]*)\)/.exec(value);
    name = comment ? comment[1].trim() : "";
    email = value.replace(/\([^)]*\)/g, "").split(",")[0].trim();
  }
  if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) name = name.slice(1, -1).replace(/\\(.)/g, "$1");
  return { name: decodeMimeWords(name).trim(), email };
}

/** The sender marked it as a mailing list or newsletter: List-Unsubscribe, List-Id, or Precedence bulk/list/junk. `headers` has lowercase names. */
export function isBulk(headers: Record<string, string>): boolean {
  return Boolean(
    headers["list-unsubscribe"] || headers["list-id"] || ["bulk", "list", "junk"].includes((headers["precedence"] ?? "").trim().toLowerCase()),
  );
}

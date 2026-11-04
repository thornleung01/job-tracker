import { useMemo, type ReactNode } from "react";
import { blocksToHtml, parts } from "../pipeline";
import "./components.css";

/**
 * Turns the pipeline's escaped paragraph markup into React elements. Only p, ul, li and span.url survive; anything else is
 * reduced to its text, and attributes are never copied except the class on a sign-off and the title on a link's domain.
 * Emails are untrusted, so nothing here is ever set as HTML, and links are shown as their domain and never clickable.
 */
function toNodes(html: string): ReactNode[] {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html");
  let key = 0;
  const walk = (node: Node): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof Element)) return null;
    const kids = Array.from(node.childNodes).map(walk);
    const tag = node.tagName.toLowerCase();
    const k = key++;
    if (tag === "p") return <p key={k} className={node.classList.contains("sig") ? "sig" : undefined}>{kids}</p>;
    if (tag === "ul") return <ul key={k}>{kids}</ul>;
    if (tag === "li") return <li key={k}>{kids}</li>;
    if (tag === "span" && node.classList.contains("url")) return <span key={k} className="url" title={node.getAttribute("title") ?? undefined}>{kids}</span>;
    return <span key={k}>{kids}</span>;
  };
  return Array.from(doc.body.childNodes).map(walk);
}

function Blocks({ blocks }: { blocks: string[] }) {
  const nodes = useMemo(() => toNodes(blocksToHtml(blocks)), [blocks]);
  return <>{nodes}</>;
}

/** The cleaned text of a stored email: repaired paragraphs and lists, with the reply chain and the footer folded away. */
export function EmailText({ body }: { body: string | null | undefined }) {
  const [main, thread, footer] = useMemo(() => parts(body), [body]);
  if (!(main.length || thread.length || footer.length)) {
    return <div className="mail-text"><p className="mail-empty">No text was stored for this email.</p></div>;
  }
  return (
    <div className="mail-text">
      {main.length ? <Blocks blocks={main} /> : <p className="mail-empty">Only quoted or footer text was stored for this email.</p>}
      {thread.length ? (
        <details className="mail-fold">
          <summary>Earlier in this thread</summary>
          <Blocks blocks={thread} />
        </details>
      ) : null}
      {footer.length ? (
        <details className="mail-fold">
          <summary>Footer and links</summary>
          <Blocks blocks={footer} />
        </details>
      ) : null}
    </div>
  );
}

import { useRef, useState } from "react";
import { Notice } from "../../components/Notice";
import type { DocSection } from "../../db/schema";
import { MESSAGES, ReadError, extractText, normalizeText, readPastedSections, splitSections } from "../../documents/read";

/** What was read: the sections the simple converter made, and the plain text they came from (the text an AI conversion would send). */
export type Incoming = { sections: DocSection[]; text: string; source: "upload" | "paste" };

interface Props {
  /** the text of the file button: "Upload a file" or "Replace with a file" */
  fileLabel: string;
  onRead(incoming: Incoming): void;
  /** the file button is the primary one (the empty state), or an ordinary one beside other actions */
  primary?: boolean;
}

const messageOf = (e: unknown) => (e instanceof ReadError ? e.message : MESSAGES.unreadable);

/** The two ways to bring a resume in: a PDF, Word or text file, or pasted text. It only reads. What it reads goes to onRead to be checked, and nothing is saved here. */
export function Importer({ fileLabel, onRead, primary = true }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const chosen = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setReading(true);
    try {
      const read = await extractText(file);
      onRead({ sections: splitSections(read), text: read, source: "upload" });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";   // so choosing the same file again still counts
    }
  };
  const usePasted = () => {
    setError(null);
    try {
      const sections = readPastedSections(text);   // throws on empty text
      onRead({ sections, text: normalizeText(text), source: "paste" });
      setPasting(false);
      setText("");
    } catch (e) {
      setError(messageOf(e));
    }
  };

  return (
    <div className="importer">
      <div className="row">
        <button type="button" className={primary ? "primary" : undefined} onClick={() => input.current?.click()} disabled={reading} aria-busy={reading || undefined}>{fileLabel}</button>
        <button type="button" aria-expanded={pasting} onClick={() => setPasting((p) => !p)}>Paste text</button>
        <input ref={input} type="file" className="sr" tabIndex={-1} aria-label="Resume file" accept=".pdf,.docx,.txt" onChange={(e) => void chosen(e.target.files?.[0])} />
      </div>
      {pasting ? (
        <div className="importer-paste">
          <label className="field" htmlFor="resume-paste">Resume text</label>
          <textarea id="resume-paste" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row">
            <button type="button" className="primary" onClick={usePasted}>Use this text</button>
            <button type="button" onClick={() => { setPasting(false); setError(null); }}>Cancel</button>
          </div>
        </div>
      ) : null}
      {error ? <Notice tone="err">{error}</Notice> : null}
    </div>
  );
}

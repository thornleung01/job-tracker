import { Check, Minus } from "lucide-react";
import { useMemo } from "react";
import type { DocSection } from "../../db/schema";
import { postingTerms } from "../../documents/postingTerms";

interface Props {
  posting: string;
  /** the resume the terms are looked for in (the tailored copy as it is being edited) */
  sections: readonly DocSection[];
  company?: string;
}

/** "Words from the posting": its skill-like terms, each marked as in the copy or not. Worked out on the device, nothing is sent. */
export function PostingTerms({ posting, sections, company }: Props) {
  const terms = useMemo(() => postingTerms(posting, sections, { company }), [posting, sections, company]);
  if (!terms.length) return null;
  return (
    <section className="posting-terms" aria-labelledby="posting-terms-h">
      <h3 id="posting-terms-h" className="doc-h">Words from the posting</h3>
      <ul className="posting-terms-list">
        {terms.map((t) => (
          <li key={t.term} className={t.found ? "in" : "out"}>
            {t.found ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : <Minus size={16} strokeWidth={3} aria-hidden="true" />}
            <span>{t.term}</span>
            <span className="sr">{t.found ? ", in your copy" : ", not in your copy"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

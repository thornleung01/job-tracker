// The skill-like words in a job posting, each marked as in a resume or not. Worked out on the device from the text alone: no network, no AI.
// It looks for technical tokens (SQL, C++, Node.js, PowerBI), capitalised names (Tableau, Google Analytics) and the lists that follow
// "experience with", and leaves out ordinary words, headings and the company's own name.
import { sectionsToText } from "../db/documentShape";
import type { DocSection } from "../db/schema";

export interface PostingTerm {
  term: string;
  found: boolean;
}

const DEFAULT_MAX = 20;

/** Capitalised words that are not skills: sentence openers, headings, calendar words, legal suffixes. Lower case. */
const STOP = new Set((
  "a an the and or but if so as at by for from in into of on to with without we you your our us they their it its he she his her this that these those there here " +
  "about above across after all also any are be been being both can could do does each every get gets have has how i is just may might more most must new no not now " +
  "only other out over per plus should some such than then through up use using via was were what when where which while who will would yes " +
  "responsibilities requirements qualifications benefits experience skills role roles job jobs position team teams company work working years year " +
  "summary overview description duties nice must-have preferred required bonus apply application applications candidate candidates employer employers " +
  "equal opportunity opportunities location salary compensation perks culture mission values join please thank thanks hiring remote hybrid onsite " +
  "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december " +
  "inc ltd llc corp corporation co limited plc gmbh senior junior lead principal staff manager director analyst engineer developer specialist associate intern " +
  "canada usa toronto vancouver montreal ontario york london eeo us uk hr pm am asap faq cv pdf ceo cto cfo vp fte etc ie eg"
).split(/\s+/));

/** Words that end a "experience with ..." capture: what follows is not part of the list. */
const LIST_END = /\s+(?:in|to|for|on|at|as|that|who|which|when|where|within|across|from|by|is|are|will|you|and\/or)\s+/i;
const CUE = /\b(?:experience|proficien\w+|knowledge|familiarity|skilled|expertise|background|fluency|fluent|comfortable)\s+(?:with|in|of|using)\s+([^.\n;:]+)/gi;
const LEAD = /^(?:strong|solid|hands-on|working|deep|proven|good|excellent|some|prior|practical|advanced|basic|the|our|your|any|and|or|using|with|of|in)\s+/i;
const DETERMINER = /^(?:a|an|the|our|your|their|this|that|these|those|its|any|all|some|each|every|many|more|other)$/i;

const stripEdge = (token: string): string => token.replace(/^[^\w.+#]+/, "").replace(/[^\w+#]+$/, "").replace(/^\.(?![A-Za-z])/, "");
const isStop = (word: string): boolean => STOP.has(word.toLowerCase());
/** A technical token: SQL, KPIs, JavaScript, C++, C#, Node.js, .NET, S3. */
const isTech = (t: string): boolean =>
  t.length >= 2 && !isStop(t) &&
  (/^[A-Z]{2,}[A-Za-z0-9]*$/.test(t) || /^[A-Za-z][a-z]+[A-Z]\w*$/.test(t) || /^[A-Za-z]+[+#]+$/.test(t) || /^[A-Za-z]+\d+$/.test(t) || /^\.?[A-Za-z]+\.(?:js|net)$/i.test(t) || /^\.net$/i.test(t));
const isCapWord = (t: string): boolean => /^[A-Z][a-z]{2,}$/.test(t) && !isStop(t);

interface Candidate {
  term: string;
  /** index of the first sighting in the posting, to order ties */
  at: number;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whether `term` is in `text` as a whole word or phrase, ignoring case. */
const contains = (text: string, term: string): boolean => new RegExp(`(?<![A-Za-z0-9])${escape(term)}(?![A-Za-z0-9])`, "i").test(text);

/** The words of the company's name: a term made of them is the employer, not a skill. */
function companyWords(company: string | undefined): Set<string> {
  return new Set((company ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
}

export function postingTerms(posting: string, sections: readonly DocSection[], opts: { company?: string; max?: number } = {}): PostingTerm[] {
  const max = opts.max ?? DEFAULT_MAX;
  const text = posting.replace(/\r\n?/g, "\n");
  if (!text.trim() || max <= 0) return [];
  const own = companyWords(opts.company);
  const found = new Map<string, Candidate>();
  const count = new Map<string, number>();
  const see = (term: string, at: number): void => {
    const key = term.toLowerCase();
    count.set(key, (count.get(key) ?? 0) + 1);
    if (!found.has(key)) found.set(key, { term, at });
  };

  // Capitalised and technical words, sentence by sentence (a line break also starts a sentence).
  let offset = 0;
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const start = text.indexOf(sentence, offset);
    offset = start < 0 ? offset : start + sentence.length;
    sentence.split(/[,;:()—–|]/).forEach((chunk, c) => {
      const tokens = chunk.split(/\s+/).map(stripEdge).filter(Boolean);
      let run: string[] = [];
      let runFrom = 0;
      const flush = (): void => {
        // a lone capitalised word that opens the sentence is just a capital letter, not a name
        if (run.length > 1 || (run.length === 1 && !(c === 0 && runFrom === 0))) see(run.join(" "), Math.max(0, start));
        run = [];
      };
      tokens.forEach((token, i) => {
        if (isTech(token)) {
          flush();
          see(token, Math.max(0, start));
        } else if (isCapWord(token)) {
          if (!run.length) runFrom = i;
          run.push(token);
        } else flush();
      });
      flush();
    });
  }

  // Lists after "experience with ...": "SQL, dashboards and stakeholder reporting".
  for (const m of text.matchAll(CUE)) {
    const tail = m[1].split(LIST_END)[0];
    for (const part of tail.split(/,|\band\b|\bor\b|\/|&/i)) {
      let item = part.trim();
      while (LEAD.test(item)) item = item.replace(LEAD, "");
      const ws = item.split(/\s+/).filter(Boolean).map(stripEdge).filter(Boolean);
      if (!ws.length || ws.length > 3 || DETERMINER.test(ws[0]) || ws.some((w) => w.length < 2 && !/^[A-Z]$/.test(w)) || isStop(ws[0]) || isStop(ws[ws.length - 1])) continue;
      see(ws.join(" "), (m.index ?? 0) + 1);
    }
  }

  const terms = [...found.entries()]
    .filter(([key, c]) => {
      const parts = key.split(/[^a-z0-9+#.]+/).filter(Boolean);
      return !parts.some((w) => own.has(w)) && c.term.length >= 2;
    })
    .sort(([ka, a], [kb, b]) => (count.get(kb) ?? 0) - (count.get(ka) ?? 0) || a.at - b.at)
    .slice(0, max);

  const resume = sectionsToText(sections);
  return terms.map(([, c]) => ({ term: c.term, found: contains(resume, c.term) }));
}

import { useMemo, useState } from "react";
import type { DocSection } from "../../db/schema";
import { withScaffold } from "../../documents/blankResume";
import { PageEditor } from "./PageEditor";
import { SectionsEditor } from "./SectionsEditor";
import "./pageeditor.css";

type Mode = "page" | "list";
const STORAGE_KEY = "jobtracker:resume-editing";

/** The remembered choice, "page" when there is none (or storage is unavailable). */
function readMode(): Mode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "list" ? "list" : "page";
  } catch {
    return "page";
  }
}
function rememberMode(mode: Mode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // private browsing or no storage: the choice lasts until the page is left
  }
}

interface Props {
  sections: DocSection[];
  onChange(next: DocSection[]): void;
  /** names the editing group for screen readers, like "Master resume" */
  label: string;
  /** the resume's title, the name's fallback when it has no header */
  title: string;
  /** for an empty or blank template draft: the page shows every field of the template, and the first edit hands the whole list to `onChange` */
  scaffold?: boolean;
  /** the page sheet is scaled to its column (see PageEditor) */
  fit?: boolean;
}

/**
 * Editing a resume: on the page (the sheet itself, typed into where it is) or as a list of fields. Exactly one editor is mounted, the choice is
 * remembered, and the editor is controlled: the caller keeps the draft and saves it.
 */
export function ResumeEditing({ sections, onChange, label, title, scaffold = false, fit = false }: Props) {
  const [mode, setMode] = useState<Mode>(readMode);
  // The scaffold only fills in the template until the first edit: after that the list is the caller's, so a section you remove stays removed.
  const [touched, setTouched] = useState(false);
  const scaffolded = useMemo(() => (scaffold && !touched ? withScaffold(sections) : sections), [scaffold, touched, sections]);

  /** Every edit, on the page or in the list, hands the draft over and ends the scaffolding. */
  const edited = (next: DocSection[]) => {
    setTouched(true);
    onChange(next);
  };

  const choose = (next: Mode) => {
    setMode(next);
    rememberMode(next);
  };

  return (
    <div className="resume-editing">
      <div className="doc-switch" role="group" aria-label="How to edit">
        <button type="button" aria-pressed={mode === "page"} onClick={() => choose("page")}>Edit on page</button>
        <button type="button" aria-pressed={mode === "list"} onClick={() => choose("list")}>Edit as list</button>
      </div>
      {mode === "page" ? (
        <PageEditor
          sections={scaffolded} label={label} title={title}
          onChange={edited} fit={fit}
        />
      ) : (
        <SectionsEditor sections={sections} onChange={edited} label={label} />
      )}
    </div>
  );
}

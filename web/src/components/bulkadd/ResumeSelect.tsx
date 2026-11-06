import type { ResumeChoice } from "../bulk/BulkBar";

/** What the select says for "go and add your resume": picking it opens the Resume page instead of setting a value. */
export const ADD_RESUME = "add";

interface Props {
  id: string;
  /** the versions you can choose, master first; none at all means there is no master resume yet */
  resumes: readonly ResumeChoice[];
  /** a version's id as text, or "" for none */
  value: string;
  /** called with "" or a version's id; for "Add your resume" the select calls `onAdd` instead */
  onChange(value: string): void;
  onAdd(): void;
}

/**
 * "Resume sent" for the Add forms. With no master resume there is nothing to choose, so the select holds only "None" and
 * "Add your resume", which goes to the Resume page.
 */
export function ResumeSelect({ id, resumes, value, onChange, onAdd }: Props) {
  return (
    <select id={id} name="resume" value={value} onChange={(e) => (e.target.value === ADD_RESUME ? onAdd() : onChange(e.target.value))}>
      <option value="">None</option>
      {resumes.length ? resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>) : <option value={ADD_RESUME}>Add your resume</option>}
    </select>
  );
}

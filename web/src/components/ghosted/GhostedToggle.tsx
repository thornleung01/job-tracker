import "./ghosted.css";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** The filter card's "No reply" checkbox, next to "Needs follow-up". Like the other filters it takes effect on Apply filters. */
export function GhostedToggle({ checked, onChange }: Props) {
  return (
    <div className="fgroup ghosted-field">
      <label className="ghosted-toggle" htmlFor="f-ghosted">
        <input id="f-ghosted" name="ghosted" type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        No reply
      </label>
    </div>
  );
}

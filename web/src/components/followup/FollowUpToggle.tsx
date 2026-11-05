import "./followup.css";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** The filter card's "Needs follow-up" checkbox. Like the other filters, it takes effect on Apply filters. */
export function FollowUpToggle({ checked, onChange }: Props) {
  return (
    <div className="fgroup followup-field">
      <label className="followup-toggle" htmlFor="f-followup">
        <input id="f-followup" name="followUp" type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        Needs follow-up
      </label>
    </div>
  );
}

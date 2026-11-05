// "Appearance": theme, accent, density, corners, list columns and the Flow page's default period. Every change is
// saved the moment it is made, and the app restyles itself from the saved value (app/appearance.tsx).
import { useEffect, useRef, type CSSProperties } from "react";
import { ACCENT_COLORS } from "../../app/accents";
import type { JobTrackerDB } from "../../db/schema";
import {
  ACCENTS, COLUMNS, CORNERS, DENSITIES, FLOW_PERIODS, PERIODS, THEMES, saveSettings, type AppearanceSettings, type ColumnId,
} from "../../sync/settings";
import type { Reporter } from "./notice";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Segmented<T extends string>({ id, label, name, options, value, onChange }: {
  id: string; label: string; name: string; options: readonly T[]; value: T; onChange(v: T): void;
}) {
  return (
    <div className="field-block">
      <div className="field" id={id}>{label}</div>
      <div className="seg" role="radiogroup" aria-labelledby={id}>
        {options.map((o) => (
          <label key={o}>
            <input type="radio" name={name} value={o} checked={value === o} onChange={() => onChange(o)} />
            <span>{capitalize(o)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

interface Props {
  db: JobTrackerDB;
  /** undefined while loading */
  appearance: AppearanceSettings | undefined;
  report: Reporter;
}

export function AppearanceSection({ db, appearance, report }: Props) {
  // The whole group is written each time, so two quick changes (two columns ticked) would otherwise both start from
  // the same stored value and the second would undo the first. This holds the newest value until the page catches up.
  const latest = useRef<AppearanceSettings | undefined>(undefined);
  useEffect(() => {
    latest.current = undefined;
  }, [appearance]);

  if (!appearance) {
    return (
      <section className="card" id="appearance" aria-labelledby="h-appearance">
        <h2 className="sec" id="h-appearance" tabIndex={-1}>Appearance</h2>
      </section>
    );
  }

  const shown: AppearanceSettings = appearance;

  async function save(patch: Partial<AppearanceSettings>) {
    const next = { ...(latest.current ?? shown), ...patch };
    latest.current = next;
    try {
      await saveSettings(db, "appearance", next);
      report.announce("Appearance saved");
    } catch (e) {
      console.error(e);
      latest.current = undefined;
      report.say("err", "Couldn't save your appearance settings. Try again.");
    }
  }

  function toggleColumn(id: ColumnId, on: boolean) {
    const chosen = new Set((latest.current ?? shown).columns);
    if (on) chosen.add(id);
    else chosen.delete(id);
    void save({ columns: (Object.keys(COLUMNS) as ColumnId[]).filter((c) => chosen.has(c)) });
  }

  return (
    <section className="card" id="appearance" aria-labelledby="h-appearance">
      <h2 className="sec" id="h-appearance" tabIndex={-1}>Appearance</h2>
      <Segmented id="l-theme" label="Theme" name="theme" options={THEMES} value={shown.theme} onChange={(theme) => void save({ theme })} />
      <div className="field-block">
        <div className="field" id="l-accent">Accent colour</div>
        <div className="swatches" role="radiogroup" aria-labelledby="l-accent">
          {ACCENTS.map((name) => (
            <label key={name}>
              <input type="radio" name="accent" value={name} checked={shown.accent === name} onChange={() => void save({ accent: name })} />
              <i style={{ "--l": ACCENT_COLORS[name].light, "--d": ACCENT_COLORS[name].dark } as CSSProperties} />
              <span>{capitalize(name)}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="row pair">
        <Segmented id="l-density" label="Density" name="density" options={DENSITIES} value={shown.density} onChange={(density) => void save({ density })} />
        <Segmented id="l-corners" label="Corners" name="corners" options={CORNERS} value={shown.corners} onChange={(corners) => void save({ corners })} />
      </div>
      <div className="field-block">
        <div className="field" id="l-cols">Columns in the applications list</div>
        <p className="help">Company and Stage always show.</p>
        <div className="checks" role="group" aria-labelledby="l-cols">
          {(Object.keys(COLUMNS) as ColumnId[]).map((id) => {
            const fixed = id === "company" || id === "stage";
            return (
              <label key={id}>
                <input type="checkbox" checked={fixed || shown.columns.includes(id)} disabled={fixed} onChange={(e) => toggleColumn(id, e.target.checked)} />
                {COLUMNS[id]}
              </label>
            );
          })}
        </div>
      </div>
      <div className="field-block">
        <label className="field" htmlFor="flow_days">Default period on the Flow page</label>
        <select id="flow_days" value={shown.flowDays} onChange={(e) => void save({ flowDays: Number(e.target.value) })}>
          {PERIODS.filter((p) => (FLOW_PERIODS as readonly number[]).includes(p.days)).map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
        </select>
      </div>
    </section>
  );
}

// The progress bar both sync screens draw: a filled bar when the percentage is known, a sliding stripe when it is not.
import "./syncbar.css";

export function SyncBar({ percent }: { percent: number | null }) {
  return (
    <div className={`bar${percent === null ? " indet" : ""}`} role="progressbar" aria-label="Sync progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
      <i style={percent !== null ? { width: `${percent}%` } : undefined} />
    </div>
  );
}

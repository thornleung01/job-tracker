import { Fragment } from "react";
import type { DuplicateMatch } from "../../sync/duplicates";
import "./duplicates.css";

/** "Acme · Analyst" */
const label = (m: DuplicateMatch) => `${m.company} · ${m.role}`;

/**
 * A quiet line under the add form's fields when what is typed matches applications you already have. It links to each one and
 * never blocks the save. Empty (and hidden) until there is something to say.
 */
export function DuplicateNotice({ matches }: { matches: DuplicateMatch[] }) {
  // The live region is always on the page and fills when there is something to say: screen readers miss one that arrives with its text.
  return (
    <p className="dup-note" role="status">
      {matches.length ? (
        <>
          You already have{" "}
          {matches.map((m, i) => (
            <Fragment key={m.id}>
              {i === 0 ? "" : i === matches.length - 1 ? " and " : ", "}
              <a href={`#/app/${m.id}`}>{label(m)}</a> ({m.stage})
            </Fragment>
          ))}
          . Add it anyway?
        </>
      ) : null}
    </p>
  );
}

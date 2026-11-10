import { useMemo, useState } from "react";
import { useQuery } from "../../app/useQuery";
import { StageBadge } from "../../components/StageBadge";
import type { JobTrackerDB } from "../../db/schema";
import { liveTailored } from "../../sync/documents";
import { liveApplications } from "../../sync/live";
import { foldText } from "../../sync/search";

interface Props {
  db: JobTrackerDB;
  /** a version chosen on the Resume page ("Tailor with this"): carried to the workspace as the baseline */
  baseline: number | null;
  navigate(to: string): void;
}

/** The applications you can tailor for, newest first, each with what is already there. */
export function Picker({ db, baseline, navigate }: Props) {
  const [search, setSearch] = useState("");
  const rows = useQuery(async () => {
    const tailored = new Set((await liveTailored(db)).map((d) => d.applicationId));
    const apps = (await liveApplications(db)).sort((a, b) => b.id - a.id);
    return apps.map((a) => ({ app: a, hasPosting: Boolean(a.postingText?.trim()), tailored: tailored.has(a.id) }));
  }, [db]);

  const shown = useMemo(() => {
    const words = foldText(search).split(/\s+/).filter(Boolean);
    return (rows ?? []).filter(({ app }) => {
      const hay = foldText(`${app.company} ${app.role}`);
      return words.every((w) => hay.includes(w));
    });
  }, [rows, search]);

  const open = (id: number) => navigate(`/tailor/${id}${baseline ? `?baseline=${baseline}` : ""}`);

  return (
    <>
      <h1 className="page">Tailor for a job</h1>
      {rows && !rows.length ? (
        <p className="tailor-empty">No applications to tailor for yet. <a href="#/">Add application</a> first.</p>
      ) : (
        <>
          <div className="tailor-search">
            <label className="sr" htmlFor="tailor-search">Search applications</label>
            <input id="tailor-search" type="search" placeholder="Search by company or role" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {rows && !shown.length ? <p className="muted tailor-empty">No applications match that search.</p> : null}
          <ul className="tailor-picker" aria-label="Applications">
            {shown.map(({ app, hasPosting, tailored }) => {
              const name = [app.company, app.role].filter(Boolean).join(", ");
              return (
                <li key={app.id} className="card tailor-pick">
                  <div className="tailor-pick-text">
                    <span className="tailor-pick-title">{name}</span>
                    <p className="small muted tailor-pick-facts">
                      <StageBadge stage={app.stage} />
                      <span>{hasPosting ? "Posting saved" : "No posting"}</span>
                      {tailored ? <span>Tailored</span> : null}
                    </p>
                  </div>
                  <button type="button" className={tailored ? undefined : "primary"} onClick={() => open(app.id)} aria-label={`${tailored ? "Open" : "Tailor"} ${name}`}>
                    {tailored ? "Open" : "Tailor"}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

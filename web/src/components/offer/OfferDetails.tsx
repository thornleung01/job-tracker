import { useEffect, useRef, useState, type FormEvent } from "react";
import { OFFER_SALARY_MAX } from "../../db/offer";
import type { ApplicationRow, JobTrackerDB } from "../../db/schema";
import { setOfferDetails } from "../../sync/actions";
import { useAction } from "../useAction";
import "./offer.css";

type OfferFields = Pick<ApplicationRow, "id" | "stage" | "offerSalary" | "offerDeadline">;

/** Whether any offer details are saved. */
const hasSavedOffer = (app: OfferFields): boolean => Boolean(app.offerSalary || app.offerDeadline);

/** The Offer section shows at the Offer stage, and stays once there are details to see. */
export const showsOffer = (app: OfferFields): boolean => app.stage === "Offer" || hasSavedOffer(app);

/** What the offer pays and the day to decide by, on the detail page. */
export function OfferDetails({ db, app }: { db: JobTrackerDB; app: OfferFields }) {
  const act = useAction();
  const [salary, setSalary] = useState(app.offerSalary ?? "");
  const [deadline, setDeadline] = useState(app.offerDeadline ?? "");
  const salaryInput = useRef<HTMLInputElement>(null);
  // Show what is saved, and again when it changes under the form (a merge, an import). A change from outside replaces what you were typing.
  useEffect(() => {
    setSalary(app.offerSalary ?? "");
    setDeadline(app.offerDeadline ?? "");
  }, [app.id, app.offerSalary, app.offerDeadline]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    void act.run("offer", async () => {
      await setOfferDetails(db, app.id, { salary, deadline });
      return "Offer details saved.";
    });
  };
  const clear = () => {
    void act.run("offer-clear", async () => {
      await setOfferDetails(db, app.id, { salary: "", deadline: "" });
      setSalary("");
      setDeadline("");
      // The Clear button goes once nothing is saved, so focus moves to the first field instead of being lost.
      salaryInput.current?.focus();
      return "Offer details cleared.";
    });
  };

  return (
    <section className="offer" aria-labelledby={`offer-${app.id}-h`}>
      <h2 className="offer-title" id={`offer-${app.id}-h`}>Offer</h2>
      <form className="offer-form" onSubmit={save}>
        <div className="fgroup">
          <label htmlFor={`offer-${app.id}-salary`}>Salary</label>
          <input ref={salaryInput} id={`offer-${app.id}-salary`} name="salary" type="text" value={salary} maxLength={OFFER_SALARY_MAX} autoComplete="off"
                 placeholder="$120,000 + equity" onChange={(e) => setSalary(e.target.value)} />
        </div>
        <div className="fgroup">
          <label htmlFor={`offer-${app.id}-deadline`}>Decision deadline</label>
          <input id={`offer-${app.id}-deadline`} name="deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        <div className="row offer-actions">
          <button type="submit" {...act.button("offer")}>Save offer details</button>
          {hasSavedOffer(app) ? <button type="button" onClick={clear} {...act.button("offer-clear")}>Clear offer details</button> : null}
        </div>
      </form>
      {act.error ? <p className="small offer-error" role="alert">{act.error}</p> : null}
      {act.status ? <p className="small muted offer-status" role="status">{act.status}</p> : null}
    </section>
  );
}

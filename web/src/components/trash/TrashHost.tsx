import { useEffect } from "react";
import { tx, type JobTrackerDB } from "../../db/schema";
import { purgeOncePerSession, restoreApplication } from "../../sync/trash";
import { Notice } from "../Notice";
import { messageFor, useAction } from "../useAction";
import { useNoticeFocus } from "../useNoticeFocus";
import { announce, dismissNotice, useDeletedNotice } from "./deletedNotice";
import "./trash.css";

/**
 * Mounted once in the signed-in shell. It erases what has waited 30 days in Recently deleted (once per session), and shows the
 * line with Restore for a few seconds after something is deleted.
 */
export function TrashHost({ db }: { db: JobTrackerDB }) {
  const notice = useDeletedNotice();
  const act = useAction();
  const result = useNoticeFocus();
  useEffect(() => {
    void purgeOncePerSession(db);
  }, [db]);
  // The line belongs to this account's database: its Restore must not outlive it and run against whichever one opens next.
  useEffect(() => () => dismissNotice(), [db]);

  if (!notice) return null;
  // Everything is brought back in one transaction (all or none), and one that was erased meanwhile says so. The line is replaced by
  // the result, which takes focus (the button that had it is gone).
  const restore = () =>
    act.run("restore", async () => {
      try {
        const back = await tx(db, async () => {
          let n = 0;
          for (const id of notice.ids) if (await restoreApplication(db, id)) n++;
          return n;
        });
        announce(back ? `Restored ${notice.name}.` : "It was already restored.");
      } catch (e) {
        announce(messageFor(e));
      }
      result.focus();
    });
  return (
    <div className="trash-notice" ref={result.box}>
      <Notice>{notice.text}</Notice>
      {notice.ids.length ? <button type="button" className="small trash-restore" {...act.button("restore")} onClick={() => void restore()}>Restore</button> : null}
    </div>
  );
}

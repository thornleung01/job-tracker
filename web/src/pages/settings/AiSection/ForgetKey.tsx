import { useState } from "react";
import { InlineConfirm } from "../../../components/InlineConfirm";
import type { ActionRunner } from "../../../components/useAction";

/** The Forget key button and, once it is pressed, the question under it. Cancel puts focus back on the button. */
export function ForgetKey({ act, onForget }: { act: ActionRunner; onForget(): void }) {
  // The button that was pressed doubles as "the question is open", so no ref is read while rendering.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button" className="danger" disabled={act.busy !== null} onClick={(e) => setOpener(e.currentTarget)}>Forget key</button>
      {opener ? (
        <InlineConfirm
          title="Forget your key on this device?"
          help="You'll need to enter it again to use AI."
          confirmLabel="Forget key"
          act={act}
          actionKey="forget"
          opener={opener}
          onConfirm={onForget}
          onCancel={() => setOpener(null)}
        />
      ) : null}
    </>
  );
}
